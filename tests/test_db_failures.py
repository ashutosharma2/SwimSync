"""What the API says when the database fails: never a wrong yes, never a wrong no."""

import time

import psycopg
from fastapi.testclient import TestClient

from app import db
from app.main import app
from conftest import count_bookings, make_session, new_key

client = TestClient(app)
UNREACHABLE = "postgresql://swimsync@127.0.0.1:1/swimsync_test"  # nothing listens on port 1


def book(session_id, key, swimmer="alice"):
    return client.post(f"/sessions/{session_id}/bookings", headers={"X-Swimmer-Id": swimmer, "Idempotency-Key": key})


def test_database_down_gives_503_and_books_nothing(monkeypatch):
    session = make_session(capacity=5)
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE)

    response = book(session, new_key())
    listed = client.get("/sessions")

    assert response.status_code == 503
    assert response.json() == {"error": "database_unavailable", "booked": False}
    assert response.headers["Retry-After"] == "1"
    assert listed.status_code == 503
    monkeypatch.undo()
    assert count_bookings(session) == 0


def test_cancel_with_database_down_says_not_cancelled(monkeypatch):
    session = make_session(capacity=5)
    made = book(session, new_key()).json()
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE)

    response = client.post(f"/bookings/{made['booking_id']}/cancel", headers={"X-Swimmer-Id": "alice"})

    assert (response.status_code, response.json()) == (503, {"error": "database_unavailable", "cancelled": False})
    monkeypatch.undo()
    assert count_bookings(session) == 1


def test_lock_held_too_long_times_out_quickly_and_rolls_back():
    session = make_session(capacity=5)
    blocker = psycopg.connect(db.url())
    blocker.execute("SELECT 1 FROM sessions WHERE id = %s FOR UPDATE", (session,))  # hold the lock
    try:
        started = time.time()
        response = book(session, new_key())
        elapsed = time.time() - started
    finally:
        blocker.rollback()
        blocker.close()

    assert response.status_code == 503
    assert response.json()["booked"] is False
    assert elapsed < 1.5  # lock_timeout is 500 ms
    assert count_bookings(session) == 0


class CommitThenLoseReply:
    """A connection whose commit reaches the database but whose reply is lost."""

    def __init__(self, conn, commit_first):
        self._conn, self._commit_first = conn, commit_first

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def commit(self):
        if self._commit_first:
            self._conn.commit()
        raise psycopg.OperationalError("simulated: connection lost during COMMIT")


def test_commit_saved_but_reply_lost_is_outcome_unknown_then_retry_finds_it(monkeypatch):
    session = make_session(capacity=5)
    key = new_key()
    real_connect = db.connect
    monkeypatch.setattr(db, "connect", lambda: CommitThenLoseReply(real_connect(), commit_first=True))

    first = book(session, key)

    assert first.status_code == 503
    assert first.json()["error"] == "outcome_unknown"
    assert "booked" not in first.json()  # neither yes nor no
    monkeypatch.undo()
    assert count_bookings(session) == 1  # it was in fact saved

    retry = book(session, key)
    assert retry.status_code == 200  # the stored answer, not a second booking
    assert count_bookings(session) == 1


def test_commit_not_saved_is_also_outcome_unknown_then_retry_books(monkeypatch):
    session = make_session(capacity=5)
    key = new_key()
    real_connect = db.connect
    monkeypatch.setattr(db, "connect", lambda: CommitThenLoseReply(real_connect(), commit_first=False))

    first = book(session, key)

    assert (first.status_code, first.json()["error"]) == (503, "outcome_unknown")
    monkeypatch.undo()
    assert count_bookings(session) == 0  # it wasn't saved

    retry = book(session, key)
    assert retry.status_code == 201
    assert count_bookings(session) == 1
