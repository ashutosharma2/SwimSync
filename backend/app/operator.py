"""Operator changes to a session: change its capacity, or close it.

Each function runs inside the caller's transaction and returns (status, body). Both take the same
session-row lock as booking and cancelling, so a booking can't slip in while capacity is being cut.

Both describe an end state ("capacity is 3", "the session is closed"), so repeating one changes
nothing the second time. That makes them safe to retry without an idempotency key.
"""

from psycopg.types.json import Jsonb

from .booking import _queue_notification

POOL_CANCEL_MESSAGES = {
    "capacity_reduced": "Your booking for {name} was cancelled because the pool reduced capacity. Book another session.",
    "session_closed": "Your booking for {name} was cancelled because the pool closed this session. Book another session.",
}


def _lock(conn, session_id):
    return conn.execute(
        "SELECT name, capacity, booked, status FROM sessions WHERE id = %s FOR UPDATE", (session_id,)
    ).fetchone()


def _cancel_by_pool(conn, session_id, name, booking_rows, reason):
    """Cancel these bookings, each with a reason and a notice in this same transaction."""
    ids = [row["id"] for row in booking_rows]
    if ids:
        conn.execute(
            "UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = %s WHERE id = ANY(%s)",
            (reason, ids),
        )
    for row in booking_rows:
        _queue_notification(
            conn, row["swimmer_id"], row["id"], "booking_cancelled_by_pool",
            POOL_CANCEL_MESSAGES[reason].format(name=name),
        )
    return ids


def _audit(conn, actor, action, session_id, reason, before, after, affected):
    conn.execute(
        "INSERT INTO audit_log (actor, action, session_id, reason, before, after, affected_booking_ids)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (actor, action, session_id, reason, Jsonb(before), Jsonb(after), affected),
    )


def set_capacity(conn, session_id, new_capacity, reason, actor):
    session = _lock(conn, session_id)
    if session is None:
        return 404, {"error": "session not found"}
    if session["status"] == "closed":
        return 409, {"error": "session is closed"}
    if new_capacity == session["capacity"]:
        return 200, {"session_id": session_id, "capacity": new_capacity, "changed": False, "cancelled_booking_ids": []}

    # Too many bookings for the new capacity: the most recent ones lose their place first, so the
    # people who booked earliest keep theirs. Booking id breaks ties in the timestamp.
    excess = max(0, session["booked"] - new_capacity)
    losing = conn.execute(
        "SELECT id, swimmer_id FROM bookings WHERE session_id = %s AND status = 'confirmed'"
        " ORDER BY created_at DESC, id DESC LIMIT %s",
        (session_id, excess),
    ).fetchall() if excess else []
    cancelled = _cancel_by_pool(conn, session_id, session["name"], losing, "capacity_reduced")

    # One statement, so CHECK (booked <= capacity) holds at every moment.
    conn.execute(
        "UPDATE sessions SET capacity = %s, booked = booked - %s WHERE id = %s",
        (new_capacity, len(cancelled), session_id),
    )
    before = {"capacity": session["capacity"], "booked": session["booked"]}
    after = {"capacity": new_capacity, "booked": session["booked"] - len(cancelled)}
    _audit(conn, actor, "capacity_changed", session_id, reason, before, after, cancelled)
    return 200, {"session_id": session_id, "capacity": new_capacity, "changed": True, "cancelled_booking_ids": cancelled}


def change_log(conn, limit=50):
    """The audit log, newest first, with each session's name for display."""
    rows = conn.execute(
        "SELECT a.id, a.at, a.actor, a.action, a.session_id, s.name AS session_name, a.reason,"
        " a.before, a.after, a.affected_booking_ids"
        " FROM audit_log a JOIN sessions s ON s.id = a.session_id"
        " ORDER BY a.at DESC, a.id DESC LIMIT %s",
        (limit,),
    ).fetchall()
    return 200, [
        {
            "id": row["id"],
            "at": row["at"].isoformat(),
            "actor": row["actor"],
            "action": row["action"],
            "session_id": row["session_id"],
            "session_name": row["session_name"],
            "reason": row["reason"],
            "before": row["before"],
            "after": row["after"],
            "affected_booking_ids": list(row["affected_booking_ids"]),
        }
        for row in rows
    ]


def session_bookings(conn, session_id):
    """Who holds a place in a session, oldest booking first: the reverse of the order a capacity cut
    cancels in, so the last booking listed is the first to lose its place.

    One statement, so the booked count and the list come from the same snapshot and always agree.
    """
    rows = conn.execute(
        "SELECT s.name, s.capacity, s.booked, s.status, b.id AS booking_id, b.swimmer_id, b.created_at"
        " FROM sessions s LEFT JOIN bookings b ON b.session_id = s.id AND b.status = 'confirmed'"
        " WHERE s.id = %s ORDER BY b.created_at, b.id",
        (session_id,),
    ).fetchall()
    if not rows:
        return 404, {"error": "session not found"}
    first = rows[0]
    return 200, {
        "session_id": session_id,
        "name": first["name"],
        "capacity": first["capacity"],
        "booked": first["booked"],
        "status": first["status"],
        "bookings": [
            {"booking_id": row["booking_id"], "swimmer_id": row["swimmer_id"], "booked_at": row["created_at"].isoformat()}
            for row in rows
            if row["booking_id"] is not None  # a session with no bookings still comes back as one row
        ],
    }


def close_session(conn, session_id, reason, actor):
    session = _lock(conn, session_id)
    if session is None:
        return 404, {"error": "session not found"}
    if session["status"] == "closed":
        return 200, {"session_id": session_id, "status": "closed", "changed": False, "cancelled_booking_ids": []}

    everyone = conn.execute(
        "SELECT id, swimmer_id FROM bookings WHERE session_id = %s AND status = 'confirmed' ORDER BY id",
        (session_id,),
    ).fetchall()
    cancelled = _cancel_by_pool(conn, session_id, session["name"], everyone, "session_closed")
    conn.execute("UPDATE sessions SET status = 'closed', booked = 0 WHERE id = %s", (session_id,))
    before = {"status": "open", "booked": session["booked"]}
    after = {"status": "closed", "booked": 0}
    _audit(conn, actor, "session_closed", session_id, reason, before, after, cancelled)
    return 200, {"session_id": session_id, "status": "closed", "changed": True, "cancelled_booking_ids": cancelled}
