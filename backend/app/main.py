"""SwimSync HTTP API: browse sessions, book, cancel, list my bookings and my notifications.

The swimmer is identified by the X-Swimmer-Id header. That is a demo shortcut, not authentication.

Run: .venv/bin/uvicorn --app-dir backend app.main:app --port 8001
"""

import logging
import os
import time
import uuid
from typing import Annotated

import psycopg
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

log = logging.getLogger("swimsync.api")

OUTCOME_UNKNOWN = {
    "error": "outcome_unknown",
    "detail": "The database connection broke while saving, so it isn't known whether the change was saved. "
              "Retry with the same request (and the same Idempotency-Key), or check /me/bookings.",
}


def unavailable(**unchanged):
    return 503, {"error": "database_unavailable", **unchanged}


def run_change(work, swimmer_id, unchanged):
    """Run one booking change in a transaction, commit explicitly, and answer honestly on failure.

    A failure before the commit means PostgreSQL rolls the transaction back, so nothing changed and
    the answer says so. A failure during the commit means the change may or may not have been saved,
    so the answer is "outcome unknown": never yes, never no.
    """
    try:
        conn = db.connect()
    except psycopg.OperationalError as exc:
        log.warning("database unavailable before the transaction: %r", exc)
        return unavailable(**unchanged)
    try:
        try:
            status, body = work(conn)
            drill_pause(swimmer_id, DELAY_BEFORE_COMMIT)  # inside the transaction, holding the lock
        except psycopg.OperationalError as exc:  # includes statement and lock timeouts
            log.warning("database failure before commit, rolled back: %r", exc)
            return unavailable(**unchanged)
        try:
            conn.commit()
        except psycopg.OperationalError as exc:
            log.error("commit outcome unknown: %r", exc)
            return 503, OUTCOME_UNKNOWN
    finally:
        conn.close()  # without a commit, closing rolls the transaction back
    drill_pause(swimmer_id, DELAY_AFTER_COMMIT)  # committed, but the swimmer hasn't been told yet
    return status, body


def answer(status, body):
    headers = {"Retry-After": "1"} if status == 503 else None
    return JSONResponse(status_code=status, content=body, headers=headers)


def read(work):
    try:
        with db.connect() as conn:
            return work(conn)
    except psycopg.OperationalError as exc:
        log.warning("database unavailable for a read: %r", exc)
        return answer(*unavailable())


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
    return read(booking.list_sessions)


@app.post("/sessions/{session_id}/bookings")
def create_booking(session_id: int, swimmer_id: SwimmerId, idempotency_key: IdempotencyKey):
    try:
        status, body = run_change(
            lambda conn: booking.book(conn, session_id, swimmer_id, str(idempotency_key)),
            swimmer_id, {"booked": False},
        )
    except UniqueViolation:
        # Only reachable when the same key is used for two different sessions at the same moment.
        # The transaction rolled back, so nothing was booked.
        status, body = 409, {"error": "a conflicting request with the same Idempotency-Key is in progress"}
    # A 201 is only sent after conn.commit() succeeded, so the booking is saved.
    return answer(status, body)


@app.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, swimmer_id: SwimmerId):
    status, body = run_change(
        lambda conn: booking.cancel(conn, booking_id, swimmer_id), swimmer_id, {"cancelled": False}
    )
    return answer(status, body)


@app.get("/me/bookings")
def my_bookings(swimmer_id: SwimmerId):
    # The authoritative booking status. Notifications below are only messages about it.
    return read(lambda conn: booking.my_bookings(conn, swimmer_id))


@app.get("/me/notifications")
def my_notifications(swimmer_id: SwimmerId):
    return read(lambda conn: booking.my_notifications(conn, swimmer_id))
