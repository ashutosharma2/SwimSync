"""Operator capacity changes and closures (invariant 11: handled explicitly and audited)."""

import threading

from fastapi.testclient import TestClient

from app import booking, db, operator
from app.main import app
from conftest import count_bookings, make_session, new_key

client = TestClient(app)
TOKEN = "test-operator-token"


def book(session_id, swimmer):
    with db.connect() as conn:
        return booking.book(conn, session_id, swimmer, new_key())


def set_capacity(session_id, capacity):
    with db.connect() as conn:
        return operator.set_capacity(conn, session_id, capacity, "lifeguard off sick", "operator")


def close(session_id):
    with db.connect() as conn:
        return operator.close_session(conn, session_id, "pool maintenance", "operator")


def query(sql, *args):
    with db.connect() as conn:
        return conn.execute(sql, args).fetchall()


# Lowering capacity below the bookings: the most recent bookings lose their place first.

def test_cut_cancels_the_newest_bookings_and_tells_them():
    session = make_session(capacity=5, name="Evening family swim")
    ids = [book(session, s)[1]["booking_id"] for s in ["ana", "ben", "cai", "dev", "eva"]]

    status, body = set_capacity(session, 3)

    assert status == 200
    assert body["cancelled_booking_ids"] == [ids[4], ids[3]]  # eva then dev: last in, first out
    assert count_bookings(session) == 3
    lost = query("SELECT swimmer_id, cancel_reason FROM bookings WHERE status = 'cancelled' ORDER BY id")
    assert [(r["swimmer_id"], r["cancel_reason"]) for r in lost] == [("dev", "capacity_reduced"), ("eva", "capacity_reduced")]
    notices = query("SELECT swimmer_id, message FROM outbox WHERE kind = 'booking_cancelled_by_pool' ORDER BY swimmer_id")
    assert [n["swimmer_id"] for n in notices] == ["dev", "eva"]
    assert "pool reduced capacity" in notices[0]["message"]


def test_cut_is_audited_with_before_after_and_who_was_affected():
    session = make_session(capacity=4)
    ids = [book(session, s)[1]["booking_id"] for s in ["ana", "ben", "cai", "dev"]]

    set_capacity(session, 2)

    rows = query("SELECT actor, action, reason, before, after, affected_booking_ids FROM audit_log")
    assert len(rows) == 1
    row = rows[0]
    assert (row["actor"], row["action"], row["reason"]) == ("operator", "capacity_changed", "lifeguard off sick")
    assert row["before"] == {"capacity": 4, "booked": 4}
    assert row["after"] == {"capacity": 2, "booked": 2}
    assert row["affected_booking_ids"] == [ids[3], ids[2]]


def test_cut_above_the_bookings_cancels_nobody():
    session = make_session(capacity=10)
    book(session, "ana")

    status, body = set_capacity(session, 5)

    assert (status, body["cancelled_booking_ids"]) == (200, [])
    assert count_bookings(session) == 1


def test_same_capacity_again_changes_nothing_and_writes_no_audit():
    session = make_session(capacity=5)
    for s in ["ana", "ben", "cai", "dev"]:
        book(session, s)
    set_capacity(session, 3)

    status, body = set_capacity(session, 3)

    assert (status, body["changed"], body["cancelled_booking_ids"]) == (200, False, [])
    assert count_bookings(session) == 3
    assert len(query("SELECT id FROM audit_log")) == 1


def test_raising_capacity_is_audited_and_restores_nobody():
    session = make_session(capacity=2)
    book(session, "ana")
    book(session, "ben")
    set_capacity(session, 1)

    set_capacity(session, 6)

    assert count_bookings(session) == 1  # ben was told his booking was cancelled; it stays cancelled
    assert book(session, "cai")[0] == 201  # the new places are open to everyone
    assert len(query("SELECT id FROM audit_log")) == 2


def test_cut_racing_bookings_never_exceeds_the_new_capacity():
    # Five rounds, each with 15 places already booked, then 20 more bookings racing one cut to 10.
    # Without the session lock this fails within a few rounds; with it, never.
    for round_ in range(5):
        session = make_session(capacity=40)
        for i in range(15):
            book(session, f"early-{round_}-{i}")
        barrier = threading.Barrier(21)
        errors = []

        def booker(i):
            try:
                barrier.wait()
                book(session, f"late-{round_}-{i}")
            except Exception as exc:
                errors.append(exc)

        def cutter():
            try:
                barrier.wait()
                set_capacity(session, 10)
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=booker, args=(i,)) for i in range(20)] + [threading.Thread(target=cutter)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, errors
        assert query("SELECT capacity FROM sessions WHERE id = %s", session)[0]["capacity"] == 10
        assert count_bookings(session) <= 10  # the conftest check also confirms the counter matches the rows


# Closing a session.

def test_closing_cancels_everyone_tells_them_and_refuses_new_bookings():
    session = make_session(capacity=5)
    for s in ["ana", "ben"]:
        book(session, s)

    status, body = close(session)

    assert (status, len(body["cancelled_booking_ids"])) == (200, 2)
    assert count_bookings(session) == 0
    assert {r["cancel_reason"] for r in query("SELECT cancel_reason FROM bookings")} == {"session_closed"}
    assert len(query("SELECT id FROM outbox WHERE kind = 'booking_cancelled_by_pool'")) == 2
    assert book(session, "cai") == (409, {"error": "session is closed"})
    assert set_capacity(session, 8) == (409, {"error": "session is closed"})


def test_closing_twice_changes_nothing():
    session = make_session(capacity=5)
    book(session, "ana")
    close(session)

    status, body = close(session)

    assert (status, body["changed"]) == (200, False)
    assert len(query("SELECT id FROM audit_log")) == 1


def test_swimmer_cancelling_after_the_pool_did_is_a_safe_no_op():
    session = make_session(capacity=1)
    made = book(session, "ana")[1]
    close(session)

    with db.connect() as conn:
        status, body = booking.cancel(conn, made["booking_id"], "ana")

    assert (status, body["already_cancelled"]) == (200, True)
    assert query("SELECT cancel_reason FROM bookings")[0]["cancel_reason"] == "session_closed"


# Over HTTP: who may do it, and what the swimmer sees.

def test_operator_endpoints_need_the_token(monkeypatch):
    session = make_session(capacity=5)
    path = f"/operator/sessions/{session}/capacity"
    payload = {"capacity": 3, "reason": "test"}

    monkeypatch.delenv("SWIMSYNC_OPERATOR_TOKEN", raising=False)
    assert client.post(path, json=payload, headers={"X-Operator-Token": TOKEN}).status_code == 403  # not configured

    monkeypatch.setenv("SWIMSYNC_OPERATOR_TOKEN", TOKEN)
    assert client.post(path, json=payload).status_code == 403  # no token
    assert client.post(path, json=payload, headers={"X-Operator-Token": "guess"}).status_code == 403  # wrong token
    assert client.post(path, json=payload, headers={"X-Operator-Token": TOKEN}).status_code == 200
    assert client.post(path, json={"capacity": 0, "reason": "x"}, headers={"X-Operator-Token": TOKEN}).status_code == 422


def test_swimmer_sees_why_their_booking_was_cancelled(monkeypatch):
    monkeypatch.setenv("SWIMSYNC_OPERATOR_TOKEN", TOKEN)
    session = make_session(capacity=2, name="Lunchtime swim")
    book(session, "ana")
    book(session, "ben")
    client.post(f"/operator/sessions/{session}/capacity", json={"capacity": 1, "reason": "lane closed"},
                headers={"X-Operator-Token": TOKEN})

    ben = client.get("/me/bookings", headers={"X-Swimmer-Id": "ben"}).json()
    listed = client.get("/sessions").json()

    assert [(b["status"], b["cancel_reason"]) for b in ben] == [("cancelled", "capacity_reduced")]
    assert [(s["capacity"], s["remaining"], s["status"]) for s in listed] == [(1, 0, "open")]


# The change log, read back for the operator screen.

def test_change_log_needs_the_token(monkeypatch):
    monkeypatch.delenv("SWIMSYNC_OPERATOR_TOKEN", raising=False)
    assert client.get("/operator/audit", headers={"X-Operator-Token": TOKEN}).status_code == 403  # not configured

    monkeypatch.setenv("SWIMSYNC_OPERATOR_TOKEN", TOKEN)
    assert client.get("/operator/audit").status_code == 403  # no token
    assert client.get("/operator/audit", headers={"X-Operator-Token": "guess"}).status_code == 403  # wrong token
    assert client.get("/operator/audit", headers={"X-Operator-Token": TOKEN}).status_code == 200


def test_change_log_is_newest_first_with_before_after_and_affected_bookings(monkeypatch):
    monkeypatch.setenv("SWIMSYNC_OPERATOR_TOKEN", TOKEN)
    session = make_session(capacity=3, name="Lunchtime swim")
    ids = [book(session, s)[1]["booking_id"] for s in ["ana", "ben", "cai"]]
    set_capacity(session, 2)  # cai booked last, so cai loses the place
    close(session)  # ana and ben

    log = client.get("/operator/audit", headers={"X-Operator-Token": TOKEN}).json()

    assert [entry["action"] for entry in log] == ["session_closed", "capacity_changed"]
    cut = log[1]
    assert (cut["session_name"], cut["reason"], cut["actor"]) == ("Lunchtime swim", "lifeguard off sick", "operator")
    assert (cut["before"], cut["after"]) == ({"capacity": 3, "booked": 3}, {"capacity": 2, "booked": 2})
    assert cut["affected_booking_ids"] == [ids[2]]
    assert sorted(log[0]["affected_booking_ids"]) == [ids[0], ids[1]]


def test_change_log_is_empty_before_any_change(monkeypatch):
    monkeypatch.setenv("SWIMSYNC_OPERATOR_TOKEN", TOKEN)
    make_session(capacity=3)
    assert client.get("/operator/audit", headers={"X-Operator-Token": TOKEN}).json() == []
