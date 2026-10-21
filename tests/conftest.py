import os

# Point the app at the test database before it's imported.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql:///swimsync_test")

import pathlib
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app import db

SCHEMA = pathlib.Path(__file__).resolve().parent.parent / "db" / "schema.sql"


@pytest.fixture(autouse=True)
def fresh_db():
    """Every test starts from empty tables, and ends by checking the counter matches the rows."""
    with db.connect() as conn:
        conn.execute(SCHEMA.read_text())
    yield
    assert_counters_match_rows()


def make_session(capacity, name="Test swim"):
    starts_at = datetime.now(timezone.utc) + timedelta(days=1)
    with db.connect() as conn:
        return conn.execute(
            "INSERT INTO sessions (name, starts_at, capacity) VALUES (%s, %s, %s) RETURNING id",
            (name, starts_at, capacity),
        ).fetchone()["id"]


def new_key():
    return str(uuid.uuid4())


def assert_counters_match_rows():
    """The consistency check: every session's counter equals its confirmed bookings."""
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT s.id, s.capacity, s.booked,"
            " (SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'confirmed') AS confirmed"
            " FROM sessions s"
        ).fetchall()
    for row in rows:
        assert row["booked"] == row["confirmed"], row
        assert row["confirmed"] <= row["capacity"], row


def run_concurrently(count, work):
    """Run work(conn, i) in `count` threads, each with its own connection, released at the same moment."""
    barrier = threading.Barrier(count)
    results = [None] * count
    errors = []

    def worker(i):
        try:
            barrier.wait()
            with db.connect() as conn:
                results[i] = work(conn, i)
        except Exception as exc:  # surface thread failures in the test, not just the log
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, errors
    return results


def count_bookings(session_id, status="confirmed"):
    with db.connect() as conn:
        return conn.execute(
            "SELECT count(*) AS n FROM bookings WHERE session_id = %s AND status = %s", (session_id, status)
        ).fetchone()["n"]
