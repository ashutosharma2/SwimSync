"""SwimSync HTTP API, MVP step 1: browse sessions, book, cancel, list my bookings.

The swimmer is identified by the X-Swimmer-Id header. That is a demo shortcut, not authentication.

Run: .venv/bin/uvicorn --app-dir backend app.main:app --port 8001
"""

import uuid
from typing import Annotated

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse
from psycopg.errors import UniqueViolation

from . import booking, db

app = FastAPI(title="SwimSync")

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
    except UniqueViolation:
        # Only reachable when the same key is used for two different sessions at the same moment.
        # The transaction rolled back, so nothing was booked.
        status, body = 409, {"error": "a conflicting request with the same Idempotency-Key is in progress"}
    # Leaving the `with` block committed the transaction, so a 201 is only sent once the booking is saved.
    return JSONResponse(status_code=status, content=body)


@app.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, swimmer_id: SwimmerId):
    with db.connect() as conn:
        status, body = booking.cancel(conn, booking_id, swimmer_id)
    return JSONResponse(status_code=status, content=body)


@app.get("/me/bookings")
def my_bookings(swimmer_id: SwimmerId):
    with db.connect() as conn:
        return booking.my_bookings(conn, swimmer_id)
