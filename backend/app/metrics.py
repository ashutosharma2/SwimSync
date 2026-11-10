"""Prometheus metrics for the API: how long each request took, what it was told, and how many are open.

They're served on a port of their own (SWIMSYNC_METRICS_PORT, 9000 in the cluster), never on the
API's port 8000: nginx forwards everything under /api/ to port 8000, so a /metrics route there would
be public. Prometheus adds the pod's name to every series it scrapes, so each one is per pod without
a label here.
"""

from prometheus_client import Counter, Gauge, Histogram

# Bucket edges at the times that matter here: 0.5 s is the database's statement and lock timeout,
# and 2 s is the client's timeout, so a request in the last bucket had already been given up on.
LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5)

REQUEST_SECONDS = Histogram(
    "swimsync_http_request_duration_seconds",
    "Time to answer an HTTP request, by route pattern and status.",
    ["method", "route", "status"],
    buckets=LATENCY_BUCKETS,
)
IN_PROGRESS = Gauge(
    "swimsync_http_requests_in_progress",
    "Requests this process has started and not yet answered.",
)
OUTCOMES = Counter(
    "swimsync_booking_outcomes_total",
    "What each booking or cancel request was told.",
    ["action", "outcome"],
)


def route_of(scope):
    """The matched route's pattern, such as /sessions/{session_id}/bookings, never the raw path.

    One label value per raw path would make a new series for every session and booking id. Paths
    that match no route share one value.
    """
    route = scope.get("route")
    return getattr(route, "path", "unmatched")


def outcome(action, status, body):
    """Name what a booking or cancel request was told, from its status and body.

    The two 503s keep their own names (ADR-004): "database_unavailable" means nothing changed,
    "outcome_unknown" means it isn't known. A booking answered 200 is a stored answer: an earlier
    attempt with the same key booked, and this retry got its reply (ADR-002).
    """
    if status == 503:
        return body.get("error", "unavailable")
    if action == "book":
        named = {201: "booked", 200: "replayed", 409: "refused", 404: "not_found", 422: "key_reused"}
    elif status == 200:
        return "already_cancelled" if body.get("already_cancelled") else "cancelled"
    else:
        named = {404: "not_found"}
    return named.get(status, str(status))
