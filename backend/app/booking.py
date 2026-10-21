"""Booking rules. Each function runs inside the caller's transaction and returns (status, body).

Lock order is always the session row first. Booking and cancelling both follow it, so they
queue behind each other per session and can't deadlock.
"""

from psycopg.types.json import Jsonb


def list_sessions(conn):
    rows = conn.execute(
        "SELECT id, name, starts_at, capacity, booked FROM sessions ORDER BY starts_at, id"
    ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "starts_at": row["starts_at"].isoformat(),
            "capacity": row["capacity"],
            # Advisory only: it may be stale by the time you book. Only a booking reserves a place.
            "remaining": row["capacity"] - row["booked"],
        }
        for row in rows
    ]


def book(conn, session_id, swimmer_id, key):
    # 1. Lock the session row. Every other booking or cancel for this session waits here until
    #    we commit, so "is there room?" and "take a place" can't be split by another request.
    session = conn.execute(
        "SELECT name, capacity, booked FROM sessions WHERE id = %s FOR UPDATE", (session_id,)
    ).fetchone()
    if session is None:
        return 404, {"error": "session not found"}

    # 2. A key we've already seen means a retry: return the first answer and change nothing.
    seen = conn.execute(
        "SELECT session_id, status_code, response FROM idempotency_keys"
        " WHERE swimmer_id = %s AND key = %s",
        (swimmer_id, key),
    ).fetchone()
    if seen is not None:
        if seen["session_id"] != session_id:
            return 422, {"error": "this Idempotency-Key was already used for a different session"}
        status = 200 if seen["status_code"] == 201 else seen["status_code"]
        return status, seen["response"]

    # 3. Decide, while holding the lock.
    already = conn.execute(
        "SELECT id FROM bookings WHERE session_id = %s AND swimmer_id = %s AND status = 'confirmed'",
        (session_id, swimmer_id),
    ).fetchone()
    if already is not None:
        status = 409
        body = {"error": "you already have a confirmed booking for this session", "booking_id": already["id"]}
    elif session["booked"] >= session["capacity"]:
        status, body = 409, {"error": "session is full"}
    else:
        booking_id = conn.execute(
            "INSERT INTO bookings (session_id, swimmer_id, status) VALUES (%s, %s, 'confirmed') RETURNING id",
            (session_id, swimmer_id),
        ).fetchone()["id"]
        conn.execute("UPDATE sessions SET booked = booked + 1 WHERE id = %s", (session_id,))
        _queue_notification(
            conn, swimmer_id, booking_id, "booking_confirmed",
            f"Your booking for {session['name']} is confirmed.",
        )
        status = 201
        body = {"booking_id": booking_id, "session_id": session_id, "status": "confirmed"}

    # 4. Store the answer under the key in the same transaction, so the key and the booking
    #    are saved together or not at all.
    conn.execute(
        "INSERT INTO idempotency_keys (swimmer_id, key, session_id, status_code, response)"
        " VALUES (%s, %s, %s, %s, %s)",
        (swimmer_id, key, session_id, status, Jsonb(body)),
    )
    return status, body


def cancel(conn, booking_id, swimmer_id):
    found = conn.execute(
        "SELECT b.session_id, s.name FROM bookings b JOIN sessions s ON s.id = b.session_id"
        " WHERE b.id = %s AND b.swimmer_id = %s",
        (booking_id, swimmer_id),
    ).fetchone()
    if found is None:
        return 404, {"error": "booking not found"}

    # Same lock as booking. Once we hold it, no other cancel or booking for this session can run,
    # so the status we read next is the latest committed one.
    conn.execute("SELECT 1 FROM sessions WHERE id = %s FOR UPDATE", (found["session_id"],))
    status = conn.execute("SELECT status FROM bookings WHERE id = %s", (booking_id,)).fetchone()["status"]

    if status == "cancelled":
        # A retry or a second tap: the cancel already happened. Report success, release nothing.
        return 200, {"booking_id": booking_id, "status": "cancelled", "already_cancelled": True}

    conn.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = %s", (booking_id,))
    conn.execute("UPDATE sessions SET booked = booked - 1 WHERE id = %s", (found["session_id"],))
    _queue_notification(
        conn, swimmer_id, booking_id, "booking_cancelled",
        f"Your booking for {found['name']} is cancelled.",
    )
    return 200, {"booking_id": booking_id, "status": "cancelled", "already_cancelled": False}


def _queue_notification(conn, swimmer_id, booking_id, kind, message):
    # Same transaction as the booking change: the notice exists if and only if the change commits.
    # Delivery happens later, in the outbox worker, outside this transaction.
    conn.execute(
        "INSERT INTO outbox (swimmer_id, booking_id, kind, message) VALUES (%s, %s, %s, %s)",
        (swimmer_id, booking_id, kind, message),
    )


def my_notifications(conn, swimmer_id):
    rows = conn.execute(
        "SELECT id, message, created_at FROM notifications WHERE swimmer_id = %s ORDER BY id",
        (swimmer_id,),
    ).fetchall()
    return [{"id": row["id"], "message": row["message"], "created_at": row["created_at"].isoformat()} for row in rows]


def my_bookings(conn, swimmer_id):
    rows = conn.execute(
        "SELECT b.id, b.session_id, s.name, s.starts_at, b.status"
        " FROM bookings b JOIN sessions s ON s.id = b.session_id"
        " WHERE b.swimmer_id = %s ORDER BY s.starts_at, b.id",
        (swimmer_id,),
    ).fetchall()
    return [
        {
            "booking_id": row["id"],
            "session_id": row["session_id"],
            "session_name": row["name"],
            "starts_at": row["starts_at"].isoformat(),
            "status": row["status"],
        }
        for row in rows
    ]
