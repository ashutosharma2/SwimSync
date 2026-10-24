import os

import psycopg
from psycopg.rows import dict_row

DEFAULT_URL = "postgresql:///swimsync"

# Give up on a slow or unreachable database quickly, well inside a client's 2 s timeout, so waiting
# requests don't pile up and hold worker threads. Correctness doesn't depend on these numbers:
# idempotency keys make the retry safe.
# libpq rounds connect timeouts below 2 s up to 2 s (measured 2026-10-24 with libpq 18.6: asking for
# 1 s still took 2.00 s against an unreachable address), so ask for what you actually get.
CONNECT_TIMEOUT_SECONDS = 2
STATEMENT_TIMEOUT_MS = 500
LOCK_TIMEOUT_MS = 500


def url():
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


def connect():
    """Open a connection with rows as dicts and the timeouts above.

    Raises psycopg.OperationalError if the database can't be reached in time.
    """
    return psycopg.connect(
        url(),
        row_factory=dict_row,
        connect_timeout=CONNECT_TIMEOUT_SECONDS,
        options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS} -c lock_timeout={LOCK_TIMEOUT_MS}",
    )
