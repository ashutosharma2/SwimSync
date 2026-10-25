"""The outbox worker: delivers pending notifications, retrying failures with backoff.

Delivery is at least once. A crash between delivering and marking the row delivered leads to a
second delivery, which the inbox's unique outbox_id turns into a no-op.
"""

import logging
import time

import psycopg

from . import db

log = logging.getLogger("swimsync.outbox")

MAX_ATTEMPTS = 5
BASE_DELAY_SECONDS = 1
MAX_DELAY_SECONDS = 60


def backoff_seconds(attempts):
    """Wait before the next try, after `attempts` failures: 1, 2, 4, 8 ... capped at 60."""
    return min(BASE_DELAY_SECONDS * 2 ** (attempts - 1), MAX_DELAY_SECONDS)


def deliver_one(adapter):
    """Deliver the oldest due notification. Returns False when nothing is due."""
    with db.connect() as conn:
        # SKIP LOCKED: a second worker skips a row this one holds instead of waiting for it,
        # so each row is worked on by one worker at a time.
        # NO KEY UPDATE, not UPDATE: the adapter's inbox insert checks the foreign key to this row,
        # which takes a key-share lock. FOR UPDATE would block that check while we wait for the
        # adapter, and the two connections would wait on each other forever.
        row = conn.execute(
            "SELECT id, swimmer_id, message, attempts FROM outbox"
            " WHERE status = 'pending' AND next_attempt_at <= now()"
            " ORDER BY id LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED"
        ).fetchone()
        if row is None:
            return False

        try:
            adapter.deliver(row["id"], row["swimmer_id"], row["message"])
        except Exception as exc:  # any adapter failure: record it, never touch the booking
            attempts = row["attempts"] + 1
            if attempts >= MAX_ATTEMPTS:
                conn.execute(
                    "UPDATE outbox SET status = 'failed', attempts = %s, last_error = %s WHERE id = %s",
                    (attempts, repr(exc), row["id"]),
                )
                log.error("outbox=%s status=failed attempts=%s error=%r", row["id"], attempts, exc)
            else:
                delay = backoff_seconds(attempts)
                conn.execute(
                    "UPDATE outbox SET attempts = %s, last_error = %s,"
                    " next_attempt_at = now() + make_interval(secs => %s) WHERE id = %s",
                    (attempts, repr(exc), delay, row["id"]),
                )
                log.warning("outbox=%s status=retry attempts=%s retry_in=%ss error=%r", row["id"], attempts, delay, exc)
        else:
            conn.execute(
                "UPDATE outbox SET status = 'delivered', attempts = attempts + 1, delivered_at = now(),"
                " last_error = NULL WHERE id = %s",
                (row["id"],),
            )
            log.info("outbox=%s status=delivered", row["id"])
    return True


def deliver_due(adapter, limit=100):
    """Work through due notifications until none are left (or `limit` is reached)."""
    handled = 0
    while handled < limit and deliver_one(adapter):
        handled += 1
    return handled


DB_RETRY_MAX_SECONDS = 30


def run_forever(adapter, poll_seconds=1.0, stop=None):
    """Deliver notifications until `stop` (a threading.Event) is set, surviving database outages.

    A database error (unreachable, timed out) is not the notification's fault, so it doesn't count
    against the row's attempts: the row stays pending and is retried once the database is back.
    Drill B found that without this, the first outage killed the worker for good.
    """
    db_failures = 0
    while stop is None or not stop.is_set():
        try:
            handled = deliver_due(adapter)
        except psycopg.OperationalError as exc:
            db_failures += 1
            wait = min(2 ** (db_failures - 1), DB_RETRY_MAX_SECONDS)
            log.warning("database unavailable, retrying in %ss (failure %s): %r", wait, db_failures, exc)
            _wait(wait, stop)
            continue
        if db_failures:
            log.info("database back after %s failures", db_failures)
            db_failures = 0
        if handled == 0:
            _wait(poll_seconds, stop)


def _wait(seconds, stop):
    if stop is None:
        time.sleep(seconds)
    else:
        stop.wait(seconds)
