"""Notification delivery adapters.

The simulated in-app adapter writes to the inbox in its own transaction, the way an external email
or SMS service would work outside our database. That keeps the outbox worker honest: it can't
assume delivery and "mark delivered" happen together.
"""

import os

from . import db


class DeliveryFailed(Exception):
    pass


class InAppAdapter:
    def __init__(self, failing=None):
        # Tests and drills switch this on to simulate an outage. SWIMSYNC_ADAPTER_FAILING=1 does
        # the same for the worker process.
        self.failing = os.environ.get("SWIMSYNC_ADAPTER_FAILING") == "1" if failing is None else failing

    def deliver(self, outbox_id, swimmer_id, message):
        if self.failing:
            raise DeliveryFailed("simulated adapter outage")
        with db.connect() as conn:
            # The unique outbox_id makes a repeat delivery a no-op instead of a second inbox entry.
            conn.execute(
                "INSERT INTO notifications (outbox_id, swimmer_id, message) VALUES (%s, %s, %s)"
                " ON CONFLICT (outbox_id) DO NOTHING",
                (outbox_id, swimmer_id, message),
            )
