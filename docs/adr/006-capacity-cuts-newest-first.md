<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-006: Capacity cuts cancel the newest bookings first

- Status: Proposed
- Date: 2026-10-29 (commit a732cc5)

## Scenario

<!--
- A lifeguard calls in sick and the pool must drop from 10 places to 8 when 9 are booked.
-->

## Obstacle

<!--
- The CHECK constraint won't let capacity fall below the booked count, and bookings can arrive during the cut.
- Who loses their place, and how are they told?
-->

## Action

<!--
- Same session-row lock as booking; newest first (created_at DESC, id DESC); cancelled in the same transaction with a reason; an outbox notice; an audit_log row with before, after and who was affected.
- Why does raising capacity restore nobody? How does closing a session work?
-->

Alternatives considered:

<!--
- **Oldest first:** why not?
- **Random:** why not?
- **Mark bookings at risk and let the desk decide:** why not?
- **Refuse cuts below the booked count:** why not?
-->

## Result

<!--
- What do the tests prove? What does the swimmer see, and what does the audit log keep?
-->

## Troubleshooting

<!--
- The race test first caught a missing lock in only 1 of 3 runs. How did you change it so it failed 5 of 5 without the lock and passed with it?
-->

<!--
Evidence to link:
- backend/app/operator.py
- db/schema.sql (status, cancel_reason, audit_log)
- tests/test_operator.py: test_cut_cancels_the_newest_bookings_and_tells_them, test_cut_racing_bookings_never_exceeds_the_new_capacity, test_cut_is_audited_with_before_after_and_who_was_affected, test_raising_capacity_is_audited_and_restores_nobody, test_closing_cancels_everyone_tells_them_and_refuses_new_bookings
-->
