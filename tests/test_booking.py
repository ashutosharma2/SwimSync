"""Booking invariants, tested against a real PostgreSQL database.

Each test names the invariant from the project brief that it proves.
"""

from app import booking, db
from conftest import count_bookings, make_session, new_key, run_concurrently


def book(session_id, swimmer_id, key):
    with db.connect() as conn:
        return booking.book(conn, session_id, swimmer_id, key)


def cancel(booking_id, swimmer_id):
    with db.connect() as conn:
        return booking.cancel(conn, booking_id, swimmer_id)


# Invariants 1 and 4: confirmed bookings never exceed capacity; two requests can't both take the last place.

def test_twenty_swimmers_race_for_the_last_place():
    session = make_session(capacity=1)

    results = run_concurrently(20, lambda conn, i: booking.book(conn, session, f"swimmer-{i}", new_key()))

    statuses = sorted(status for status, _ in results)
    assert statuses == [201] + [409] * 19
    assert count_bookings(session) == 1


def test_thirty_swimmers_race_for_five_places():
    session = make_session(capacity=5)

    results = run_concurrently(30, lambda conn, i: booking.book(conn, session, f"swimmer-{i}", new_key()))

    assert sum(1 for status, _ in results if status == 201) == 5
    assert count_bookings(session) == 5


def test_full_session_is_rejected():
    session = make_session(capacity=1)
    assert book(session, "alice", new_key())[0] == 201

    status, body = book(session, "bob", new_key())

    assert status == 409
    assert body == {"error": "session is full"}


# Invariant 5 and 12: a retried request (same key) returns the first answer and books nothing new.

def test_retry_with_same_key_returns_the_first_booking():
    session = make_session(capacity=5)
    key = new_key()

    first_status, first = book(session, "alice", key)
    retry_status, retry = book(session, "alice", key)

    assert (first_status, retry_status) == (201, 200)
    assert retry == first
    assert count_bookings(session) == 1


def test_ten_simultaneous_retries_with_one_key_book_once():
    session = make_session(capacity=5)
    key = new_key()

    results = run_concurrently(10, lambda conn, i: booking.book(conn, session, "alice", key))

    assert sorted(status for status, _ in results) == [200] * 9 + [201]
    assert len({body["booking_id"] for _, body in results}) == 1
    assert count_bookings(session) == 1


def test_retry_of_a_full_answer_stays_full_even_after_a_place_frees_up():
    # Same key means same request, so it gets the same answer. A new attempt needs a new key.
    session = make_session(capacity=1)
    _, alice = book(session, "alice", new_key())
    bob_key = new_key()
    assert book(session, "bob", bob_key)[0] == 409

    cancel(alice["booking_id"], "alice")

    assert book(session, "bob", bob_key) == (409, {"error": "session is full"})
    assert book(session, "bob", new_key())[0] == 201


def test_same_key_for_a_different_session_is_rejected():
    first, second = make_session(capacity=5), make_session(capacity=5)
    key = new_key()
    book(first, "alice", key)

    status, _ = book(second, "alice", key)

    assert status == 422
    assert count_bookings(second) == 0


def test_double_tap_with_two_keys_books_once():
    # The case idempotency keys can't catch: two separate taps send two different keys.
    session = make_session(capacity=5)
    book(session, "alice", new_key())

    status, body = book(session, "alice", new_key())

    assert status == 409
    assert "already have a confirmed booking" in body["error"]
    assert count_bookings(session) == 1


# Invariant 6: a cancellation releases capacity exactly once.

def test_cancel_twice_releases_the_place_once():
    session = make_session(capacity=1)
    _, made = book(session, "alice", new_key())

    first = cancel(made["booking_id"], "alice")
    retry = cancel(made["booking_id"], "alice")

    assert first == (200, {"booking_id": made["booking_id"], "status": "cancelled", "already_cancelled": False})
    assert retry[1]["already_cancelled"] is True
    assert count_bookings(session) == 0


def test_ten_simultaneous_cancels_release_the_place_once():
    session = make_session(capacity=1)
    _, made = book(session, "alice", new_key())

    results = run_concurrently(10, lambda conn, i: booking.cancel(conn, made["booking_id"], "alice"))

    assert sum(1 for _, body in results if not body["already_cancelled"]) == 1
    assert count_bookings(session, status="cancelled") == 1


def test_cannot_cancel_someone_elses_booking():
    session = make_session(capacity=1)
    _, made = book(session, "alice", new_key())

    assert cancel(made["booking_id"], "mallory")[0] == 404
    assert count_bookings(session) == 1


def test_rebooking_after_cancelling_is_allowed():
    session = make_session(capacity=1)
    _, made = book(session, "alice", new_key())
    cancel(made["booking_id"], "alice")

    assert book(session, "alice", new_key())[0] == 201


def test_booking_an_unknown_session_returns_404():
    assert book(999, "alice", new_key()) == (404, {"error": "session not found"})


# Backstop: the database itself refuses to exceed capacity, even if the code had a bug.

def test_database_rejects_a_counter_above_capacity():
    import psycopg
    import pytest

    session = make_session(capacity=1)
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.connect() as conn:
            conn.execute("UPDATE sessions SET booked = 2 WHERE id = %s", (session,))
