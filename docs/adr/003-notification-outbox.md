<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-003: Send notices through an outbox written with the booking

- Status: Proposed
- Date: 2026-10-22 (commit c36e561)

## Scenario

<!--
- A swimmer must hear about a booking, a cancel or a pool change, and must never hear about something that didn't happen.
-->

## Obstacle

<!--
- Why not send the message inside the request?
- What goes wrong if the send succeeds and the transaction rolls back, or the transaction commits and the send fails?
-->

## Action

<!--
- The outbox row is written in the same transaction as the change. How does the worker pick rows, back off and give up?
- Why at-least-once delivery, and how is the inbox kept free of duplicates?
-->

Alternatives considered:

<!--
- **Send inside the request:** why not?
- **Send after commit in the same process:** why not?
- **A message broker:** why not, given the cost limit?
-->

## Result

<!--
- What is guaranteed (no notice for a rolled-back booking, each notice once in the inbox) and what isn't (delay; a real provider would need its own deduplication)?
-->

## Troubleshooting

<!--
- Drill B's first run (ebf9719) found the worker crashed on a database connect error and never restarted: 258 notices waited and none were lost. How was it found, what was the cause, what was the fix (b020f1c), and what's the lesson?
-->

<!--
Evidence to link:
- backend/app/outbox.py
- scripts/outbox_worker.py
- tests/test_outbox.py: test_rolled_back_booking_leaves_no_notification, test_crash_after_delivery_does_not_duplicate_the_inbox_entry, test_four_workers_deliver_each_notification_once, test_worker_survives_a_database_outage
- drills/02-database-connectivity.md
- drills/results/b-20261025-235015 and b-20261026-000204
-->
