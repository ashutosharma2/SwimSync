"""Serve the database numbers in backend/app/db_metrics.py for Prometheus.

Runs in the cluster as the db-metrics Deployment (k8s/monitoring/exporters.yaml), connecting as the
read-only monitor role.

Run: DATABASE_URL=postgresql:///swimsync .venv/bin/python scripts/db_metrics.py
     then curl http://127.0.0.1:9000/metrics
"""

import logging
import os
import pathlib
import signal
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "backend"))

from prometheus_client import REGISTRY, start_http_server  # noqa: E402

from app.db_metrics import DatabaseCollector  # noqa: E402

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # In a container this process is PID 1, which ignores SIGTERM unless it sets a handler.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    REGISTRY.register(DatabaseCollector())
    port = int(os.environ.get("SWIMSYNC_METRICS_PORT", "9000"))
    start_http_server(port)
    logging.info("database metrics on port %d", port)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
