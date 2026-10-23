"""SwimSync HTTP API: browse sessions, book, cancel, list my bookings and my notifications.

The swimmer is identified by the X-Swimmer-Id header. That is a demo shortcut, not authentication.

Run: .venv/bin/uvicorn --app-dir backend app.main:app --port 8001
"""

import logging
import os
import time
import uuid
from typing import Annotated

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from psycopg.errors import UniqueViolation

from . import booking, db

INSTANCE = os.environ.get("SWIMSYNC_INSTANCE", "local")

# Drill-only delays, off unless drills/a/run.py sets them, and only ever for one swimmer: the drill's
# "victim". They hold the victim's request open so the drill can kill the instance at a known point,
# before the commit or after it, without slowing anyone else down.
DRILL_VICTIM = os.environ.get("SWIMSYNC_DRILL_VICTIM")
DELAY_BEFORE_COMMIT = int(os.environ.get("SWIMSYNC_DRILL_DELAY_BEFORE_COMMIT_MS", "0")) / 1000
DELAY_AFTER_COMMIT = int(os.environ.get("SWIMSYNC_DRILL_DELAY_AFTER_COMMIT_MS", "0")) / 1000
if DRILL_VICTIM and (DELAY_BEFORE_COMMIT or DELAY_AFTER_COMMIT):
    logging.getLogger("swimsync").warning(
        "DRILL DELAYS ON (instance %s) for swimmer %s only: %.0f ms before commit, %.0f ms after commit",
        INSTANCE, DRILL_VICTIM, DELAY_BEFORE_COMMIT * 1000, DELAY_AFTER_COMMIT * 1000,
    )


def drill_pause(swimmer_id, seconds):
    if seconds and DRILL_VICTIM and swimmer_id == DRILL_VICTIM:
        time.sleep(seconds)


app = FastAPI(title="SwimSync")


@app.middleware("http")
async def tag_instance(request, call_next):
    # Says which copy of the API answered, so the drills can see traffic move between instances.
    response = await call_next(request)
    response.headers["X-Instance"] = INSTANCE
    return response


@app.get("/health")
def health():
    # Shallow on purpose: it only says this process can answer. If it checked the database, a
    # database outage would mark every instance down at once and the load balancer would have
    # nowhere to send anyone. Database failure is drill B's subject.
    return {"status": "ok", "instance": INSTANCE}

SwimmerId = Annotated[str, Header(alias="X-Swimmer-Id", pattern=r"^[A-Za-z0-9_-]{1,64}$")]
IdempotencyKey = Annotated[uuid.UUID, Header(alias="Idempotency-Key")]


@app.get("/sessions")
def list_sessions():
    with db.connect() as conn:
        return booking.list_sessions(conn)


@app.post("/sessions/{session_id}/bookings")
def create_booking(session_id: int, swimmer_id: SwimmerId, idempotency_key: IdempotencyKey):
    try:
        with db.connect() as conn:
            status, body = booking.book(conn, session_id, swimmer_id, str(idempotency_key))
            drill_pause(swimmer_id, DELAY_BEFORE_COMMIT)  # still inside the transaction, holding the session lock
    except UniqueViolation:
        # Only reachable when the same key is used for two different sessions at the same moment.
        # The transaction rolled back, so nothing was booked.
        status, body = 409, {"error": "a conflicting request with the same Idempotency-Key is in progress"}
    # Leaving the `with` block committed the transaction, so a 201 is only sent once the booking is saved.
    drill_pause(swimmer_id, DELAY_AFTER_COMMIT)  # committed, but the swimmer hasn't been told yet
    return JSONResponse(status_code=status, content=body)


@app.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, swimmer_id: SwimmerId):
    with db.connect() as conn:
        status, body = booking.cancel(conn, booking_id, swimmer_id)
        drill_pause(swimmer_id, DELAY_BEFORE_COMMIT)
    drill_pause(swimmer_id, DELAY_AFTER_COMMIT)
    return JSONResponse(status_code=status, content=body)


@app.get("/me/bookings")
def my_bookings(swimmer_id: SwimmerId):
    # The authoritative booking status. Notifications below are only messages about it.
    with db.connect() as conn:
        return booking.my_bookings(conn, swimmer_id)


@app.get("/me/notifications")
def my_notifications(swimmer_id: SwimmerId):
    with db.connect() as conn:
        return booking.my_notifications(conn, swimmer_id)
