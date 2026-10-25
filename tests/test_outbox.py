"""Notifications: the outbox, the worker and the inbox (invariants 9 and 10)."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import booking, db, outbox
from app.adapters import InAppAdapter
from app.main import app
from conftest import count_bookings, make_session, new_key

client = TestClient(app)


def book(session_id, swimmer_id, key=None):
    with db.connect() as conn:
        return booking.book(conn, session_id, swimmer_id, key or new_key())


def cancel(booking_id, swimmer_id):
    with db.connect() as conn:
        return booking.cancel(conn, booking_id, swimmer_id)


def outbox_rows():
    with db.connect() as conn:
        return conn.execute("SELECT * FROM outbox ORDER BY id").fetchall()


def inbox_rows():
    with db.connect() as conn:
        return conn.execute("SELECT * FROM notifications ORDER BY id").fetchall()


def make_all_due():
    """Skip the backoff wait in tests: make every pending row due now."""
    with db.connect() as conn:
        conn.execute("UPDATE outbox SET next_attempt_at = now() WHERE status = 'pending'")


# Invariant 10, first half: a notification exists if and only if the booking committed.

def test_rolled_back_booking_leaves_no_notification():
    session = make_session(capacity=5)

    with pytest.raises(RuntimeError):
        with db.connect() as conn:
            booking.book(conn, session, "alice", new_key())
            raise RuntimeError("crash before commit")

    assert count_bookings(session) == 0
    assert outbox_rows() == []


def test_booking_and_cancel_each_queue_one_notification():
    session = make_session(capacity=5, name="Evening family swim")
    key = new_key()
    _, made = book(session, "alice", key)
    book(session, "alice", key)  # replay: no new notice
    cancel(made["booking_id"], "alice")
    cancel(made["booking_id"], "alice")  # repeat cancel: no new notice
    book(make_session(capacity=1), "bob")
    book(session, "alice", new_key())  # a fresh booking after cancelling: one new notice

    assert [(r["swimmer_id"], r["kind"]) for r in outbox_rows()] == [
        ("alice", "booking_confirmed"),
        ("alice", "booking_cancelled"),
        ("bob", "booking_confirmed"),
        ("alice", "booking_confirmed"),
    ]
    assert outbox_rows()[0]["message"] == "Your booking for Evening family swim is confirmed."


def test_full_session_queues_no_notification():
    session = make_session(capacity=1)
    book(session, "alice")
    book(session, "bob")

    assert [r["swimmer_id"] for r in outbox_rows()] == ["alice"]


# Delivery.

def test_worker_delivers_to_the_inbox():
    session = make_session(capacity=5)
    book(session, "alice")

    assert outbox.deliver_due(InAppAdapter(failing=False)) == 1

    assert [r["status"] for r in outbox_rows()] == ["delivered"]
    assert len(inbox_rows()) == 1
    notices = client.get("/me/notifications", headers={"X-Swimmer-Id": "alice"}).json()
    assert [n["message"] for n in notices] == ["Your booking for Test swim is confirmed."]


# Invariant 9 and 10, second half: a failing adapter never changes booking status.

def test_failed_delivery_leaves_the_booking_confirmed():
    session = make_session(capacity=5)
    book(session, "alice")

    outbox.deliver_due(InAppAdapter(failing=True))

    mine = client.get("/me/bookings", headers={"X-Swimmer-Id": "alice"}).json()
    assert [b["status"] for b in mine] == ["confirmed"]
    assert client.get("/me/notifications", headers={"X-Swimmer-Id": "alice"}).json() == []
    row = outbox_rows()[0]
    assert (row["status"], row["attempts"]) == ("pending", 1)
    assert "simulated adapter outage" in row["last_error"]


def test_backoff_grows_then_gives_up_after_five_attempts():
    session = make_session(capacity=5)
    book(session, "alice")
    failing = InAppAdapter(failing=True)

    delays = []
    for _ in range(4):
        outbox.deliver_due(failing)
        with db.connect() as conn:
            delays.append(conn.execute(
                "SELECT round(extract(epoch FROM next_attempt_at - now())) AS s FROM outbox"
            ).fetchone()["s"])
        assert outbox.deliver_due(failing) == 0  # not due yet: the backoff is respected
        make_all_due()
    outbox.deliver_due(failing)

    assert [int(d) for d in delays] == [1, 2, 4, 8]
    row = outbox_rows()[0]
    assert (row["status"], row["attempts"]) == ("failed", 5)
    assert count_bookings(session) == 1


def test_delivery_resumes_when_the_adapter_recovers():
    session = make_session(capacity=5)
    book(session, "alice")
    outbox.deliver_due(InAppAdapter(failing=True))
    make_all_due()

    outbox.deliver_due(InAppAdapter(failing=False))

    row = outbox_rows()[0]
    assert (row["status"], row["attempts"], row["last_error"]) == ("delivered", 2, None)
    assert len(inbox_rows()) == 1


# At-least-once delivery, deduplicated by the unique outbox_id.

class SimulatedCrash(BaseException):
    """Not an Exception, so the worker can't catch it: like the process dying mid-step."""


class DeliverThenCrash(InAppAdapter):
    def deliver(self, outbox_id, swimmer_id, message):
        super().deliver(outbox_id, swimmer_id, message)
        raise SimulatedCrash()


def test_crash_after_delivery_does_not_duplicate_the_inbox_entry():
    session = make_session(capacity=5)
    book(session, "alice")

    with pytest.raises(SimulatedCrash):
        outbox.deliver_due(DeliverThenCrash(failing=False))
    assert outbox_rows()[0]["status"] == "pending"  # the crash rolled back "mark delivered"
    assert len(inbox_rows()) == 1

    outbox.deliver_due(InAppAdapter(failing=False))  # redelivery after restart

    assert outbox_rows()[0]["status"] == "delivered"
    assert len(inbox_rows()) == 1


def test_four_workers_deliver_each_notification_once():
    session = make_session(capacity=30)
    for i in range(20):
        book(session, f"swimmer-{i}")

    barrier = threading.Barrier(4)

    def worker():
        barrier.wait()
        outbox.deliver_due(InAppAdapter(failing=False))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    rows = outbox_rows()
    assert {(r["status"], r["attempts"]) for r in rows} == {("delivered", 1)}
    assert len(inbox_rows()) == 20


# Drill B found the worker died on its first database error. It must survive an outage instead.

def test_worker_survives_a_database_outage(monkeypatch):
    import psycopg

    session = make_session(capacity=5)
    book(session, "alice")
    real_connect, calls = db.connect, {"n": 0}

    def down_then_up():
        calls["n"] += 1
        if calls["n"] <= 3:
            raise psycopg.OperationalError("simulated: database unreachable")
        return real_connect()

    monkeypatch.setattr(db, "connect", down_then_up)
    monkeypatch.setattr(outbox, "_wait", lambda seconds, stop: stop.wait(0.01))  # skip the real backoff
    stop = threading.Event()
    worker = threading.Thread(target=outbox.run_forever, args=(InAppAdapter(failing=False),), kwargs={"stop": stop})
    worker.start()
    try:
        deadline = time.time() + 5
        while time.time() < deadline:
            with real_connect() as conn:  # poll on a real connection, not the failing one
                if conn.execute("SELECT count(*) AS n FROM notifications").fetchone()["n"]:
                    break
            time.sleep(0.05)
    finally:
        stop.set()
        worker.join(timeout=5)
        monkeypatch.undo()

    assert not worker.is_alive()
    assert calls["n"] > 3  # it kept trying after the failures
    row = outbox_rows()[0]
    assert (row["status"], row["attempts"]) == ("delivered", 1)  # the outage didn't use up attempts
    assert len(inbox_rows()) == 1
