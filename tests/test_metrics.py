"""Metrics: the API's request and outcome numbers, and the database numbers read for Prometheus."""

import threading
import time

import psycopg
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

from app import db, db_metrics, metrics
from app.main import app
from conftest import make_session, new_key

client = TestClient(app)


def sample(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0


def requests_answered(route, status, method="POST"):
    return sample("swimsync_http_request_duration_seconds_count", method=method, route=route, status=status)


def outcomes(action, outcome):
    return sample("swimsync_booking_outcomes_total", action=action, outcome=outcome)


def book(session_id, swimmer, key=None):
    return client.post(
        f"/sessions/{session_id}/bookings", headers={"X-Swimmer-Id": swimmer, "Idempotency-Key": key or new_key()}
    )


def collect():
    """One scrape of the database collector, as {metric: {labels: value}}."""
    scraped = {}
    for family in db_metrics.DatabaseCollector().collect():
        scraped[family.name] = {tuple(s.labels.values()): s.value for s in family.samples}
    return scraped


def test_metrics_are_not_served_on_the_api_port():
    # nginx forwards /api/ to this port, so a /metrics route here would be public.
    assert client.get("/metrics").status_code == 404


def test_requests_are_labelled_by_route_pattern_not_raw_path():
    session = make_session(capacity=3)
    route = "/sessions/{session_id}/bookings"
    before = requests_answered(route, "201")

    assert book(session, "alice").status_code == 201

    assert requests_answered(route, "201") == before + 1
    raw = f"/sessions/{session}/bookings"
    assert requests_answered(raw, "201") == 0


def test_unmatched_paths_share_one_label():
    before = requests_answered("unmatched", "404", method="GET")

    client.get("/no/such/path/123")
    client.get("/no/such/path/456")

    assert requests_answered("unmatched", "404", method="GET") == before + 2


def test_booking_and_cancel_outcomes_are_counted():
    session = make_session(capacity=1)
    names = [("book", "booked"), ("book", "replayed"), ("book", "refused"),
             ("cancel", "cancelled"), ("cancel", "already_cancelled")]
    before = {n: outcomes(*n) for n in names}

    key = new_key()
    made = book(session, "alice", key).json()
    book(session, "alice", key)  # a retry with the same key gets the stored answer
    book(session, "bob")  # the one place is taken
    client.post(f"/bookings/{made['booking_id']}/cancel", headers={"X-Swimmer-Id": "alice"})
    client.post(f"/bookings/{made['booking_id']}/cancel", headers={"X-Swimmer-Id": "alice"})

    assert {n: outcomes(*n) - before[n] for n in names} == {n: 1 for n in names}


def test_the_two_503s_keep_their_own_names():
    assert metrics.outcome("book", 503, {"error": "database_unavailable", "booked": False}) == "database_unavailable"
    assert metrics.outcome("book", 503, {"error": "outcome_unknown"}) == "outcome_unknown"
    assert metrics.outcome("cancel", 503, {"error": "outcome_unknown"}) == "outcome_unknown"
    assert metrics.outcome("book", 422, {}) == "key_reused"
    assert metrics.outcome("cancel", 404, {}) == "not_found"


def test_outbox_backlog_is_read_from_the_table():
    session = make_session(capacity=3)
    book(session, "alice")  # queues one confirmation notice

    assert collect()["swimsync_outbox_notices"][("pending",)] == 1

    with db.connect() as conn:
        conn.execute("UPDATE outbox SET created_at = now() - interval '2 minutes'")
    assert collect()["swimsync_outbox_oldest_pending_seconds"][()] >= 120

    with db.connect() as conn:
        conn.execute("UPDATE outbox SET status = 'delivered', delivered_at = now()")
    scraped = collect()
    assert scraped["swimsync_outbox_notices"] == {("pending",): 0, ("delivered",): 1, ("failed",): 0}
    assert scraped["swimsync_outbox_oldest_pending_seconds"][()] == 0


def test_a_booking_queued_behind_a_row_lock_shows_as_a_lock_wait():
    session = make_session(capacity=3)
    holder = db.connect()
    holder.execute("SELECT id FROM sessions WHERE id = %s FOR UPDATE", (session,))  # held until rollback

    def wait_for_the_lock():
        # Its own connection with a 5 s lock timeout, so it waits instead of giving up at 500 ms.
        with psycopg.connect(db.url(), options="-c lock_timeout=5000") as waiter:
            waiter.execute("SELECT id FROM sessions WHERE id = %s FOR UPDATE", (session,))

    thread = threading.Thread(target=wait_for_the_lock)
    thread.start()
    try:
        deadline = time.time() + 3
        while collect()["swimsync_db_lock_waits"][()] < 1 and time.time() < deadline:
            time.sleep(0.05)
        assert collect()["swimsync_db_lock_waits"][()] == 1
    finally:
        holder.rollback()
        holder.close()
        thread.join()
    assert collect()["swimsync_db_lock_waits"][()] == 0


def test_an_unreadable_database_is_reported_not_hidden(monkeypatch):
    def refuse():
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(db, "connect", refuse)

    assert collect() == {"swimsync_db_reachable": {(): 0}}
