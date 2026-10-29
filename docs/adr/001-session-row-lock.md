<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-001: Lock the session row and keep a booked counter

- Status: Proposed
- Date: 2026-10-21 (commit 729800f)

## Scenario

<!--
- What must be true when 20 or 30 swimmers ask for the last places at the same moment?
- Which plausible cause from docs/research/incident.md does this guard against?
-->

## Obstacle

<!--
- Why does "read the count, then insert" oversell without a lock? Describe the interleaving.
- What would SERIALIZABLE isolation or an optimistic version check cost here: retries, error handling, swimmer experience?
-->

## Action

<!--
- What happens inside the transaction: SELECT ... FOR UPDATE on the session row, the check, the insert, the counter update?
- Why a booked column instead of COUNT(*) over bookings?
- Why CHECK (booked >= 0 AND booked <= capacity) as a second line of defence, and what does a swimmer see if it ever fires?
-->

Alternatives considered:

<!--
- **SERIALIZABLE isolation with retries:** why not?
- **Optimistic concurrency (a version column):** why not?
- **Advisory locks:** why not?
- **One queue per session:** why not?
-->

## Result

<!--
- What do the race tests prove, and what don't they (one database, one machine)?
- What happens to lock waits under load? (See the lock timeout added in ef561a8.)
- What did the demo show with the lock switched off: refused writes, never oversold?
-->

## Troubleshooting

<!--
- Anything that went wrong while building it? "None" is a fine answer.
-->

<!--
Evidence to link:
- backend/app/booking.py
- db/schema.sql
- tests/test_booking.py: test_twenty_swimmers_race_for_the_last_place, test_thirty_swimmers_race_for_five_places, test_database_rejects_a_counter_above_capacity
- tests/test_db_failures.py: test_lock_held_too_long_times_out_quickly_and_rolls_back
-->
