"""Run the outbox worker as its own process.

Run: .venv/bin/python scripts/outbox_worker.py
Simulate an adapter outage: SWIMSYNC_ADAPTER_FAILING=1 .venv/bin/python scripts/outbox_worker.py
"""

import logging
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "backend"))

from app.adapters import InAppAdapter  # noqa: E402
from app.outbox import run_forever  # noqa: E402

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    adapter = InAppAdapter()
    logging.info("outbox worker started, adapter failing=%s", adapter.failing)
    try:
        run_forever(adapter)
    except KeyboardInterrupt:
        pass
