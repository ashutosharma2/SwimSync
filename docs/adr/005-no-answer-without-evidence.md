<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-005: The app never says booked or not booked without evidence

- Status: Proposed
- Date: 2026-10-27 (commit 77f215a)

## Scenario

<!--
- What should the swimmer see after tapping Book when the network or the database misbehaves?
-->

## Obstacle

<!--
- Why doesn't a timeout mean the booking failed?
- What could happen to a swimmer told "failed" after a lost reply, or "booked" without proof?
-->

## Action

<!--
- Per-tap key kept in sessionStorage across reloads; 201 or 200 confirms; the 409 cases each get their own message.
- database_unavailable: two quiet retries a second apart, then "not booked".
- Unknown or timeout: the same key after 1, 2 and 4 s, then check My bookings; an unknown result keeps the key.
-->

Alternatives considered:

<!--
- **Show an error and let the swimmer retry:** why not?
- **Optimistic UI (show booked straight away):** why not?
-->

## Result

<!--
- What do the frontend tests cover? What does the swimmer see in the worst case?
-->

## Troubleshooting

<!--
- Drill A needed "check my bookings after giving up" (047f54c). What did the inconclusive runs show?
-->

<!--
Evidence to link:
- frontend/src/bookingFlow.ts
- frontend/src/bookingFlow.test.ts
- drills/01-instance-failure.md
-->
