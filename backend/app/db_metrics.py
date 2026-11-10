"""Database numbers for Prometheus, read from PostgreSQL each time Prometheus asks.

The outbox numbers come from the outbox table, not from the worker. In drill B the worker was the
thing that died, and a dead worker can't report its own backlog; the table still shows it.

Nothing is cached between scrapes. If the database can't be read, the scrape says so
(swimsync_db_reachable 0) and leaves the other numbers out, rather than repeating old ones.
"""

import logging

import psycopg
from prometheus_client.core import GaugeMetricFamily

from . import db

log = logging.getLogger("swimsync.db_metrics")

STATUSES = ("pending", "delivered", "failed")


def read(conn):
    counts = {row["status"]: row["n"] for row in conn.execute("SELECT status, count(*) AS n FROM outbox GROUP BY status")}
    oldest = conn.execute(
        "SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0) AS s FROM outbox WHERE status = 'pending'"
    ).fetchone()["s"]
    # Sessions blocked behind another transaction's lock, such as a booking queued behind a session
    # row lock. Seeing other roles' wait events needs the pg_monitor role (k8s/db.yaml).
    waits = conn.execute(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
    ).fetchone()["n"]
    return counts, float(oldest), waits


class DatabaseCollector:
    def collect(self):
        reachable = GaugeMetricFamily("swimsync_db_reachable", "1 if this scrape could read the database, else 0.")
        try:
            with db.connect() as conn:  # the API's timeouts: 2 s to connect, 500 ms per statement
                counts, oldest, waits = read(conn)
        except psycopg.Error as exc:
            log.warning("database not readable for metrics: %r", exc)
            reachable.add_metric([], 0)
            yield reachable
            return
        reachable.add_metric([], 1)
        yield reachable

        notices = GaugeMetricFamily("swimsync_outbox_notices", "Outbox rows by status.", labels=["status"])
        for status in STATUSES:
            notices.add_metric([status], counts.get(status, 0))
        yield notices
        yield GaugeMetricFamily(
            "swimsync_outbox_oldest_pending_seconds",
            "Age of the oldest notice not yet delivered, 0 when none is pending.",
            value=oldest,
        )
        yield GaugeMetricFamily("swimsync_db_lock_waits", "Database sessions waiting for a lock right now.", value=waits)
