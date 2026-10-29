# ADR-006: Capacity cuts cancel the newest bookings first

- Status: Accepted
- Date: 2026-10-29
- Written: 2026-10-29

## Scenario

A lifeguard calls in sick, and the pool has to drop a session from 10 places to 8 while 9 swimmers are booked. A late capacity change is one of the plausible causes of [my incident](../research/incident.md).

## Obstacle

- `CHECK (booked <= capacity)` ([ADR-001](001-session-row-lock.md)) refuses any capacity below the number booked, so someone has to lose their place in the same step.
- Bookings can arrive while the cut is happening.
- A confirmed booking must keep meaning a place. Nine confirmed bookings for 8 places is the situation SwimSync was built to prevent.
- The swimmers who lose their place have to be told, and the change has to be traceable.

## Action

A capacity change takes the same session-row lock as booking, so no booking can slip in while it runs. In one transaction:

1. If the new capacity is below the number booked, the newest bookings lose their place first (`ORDER BY created_at DESC, id DESC`), so the people who booked earliest keep theirs. The booking id breaks ties in the timestamp.
2. Each one is cancelled with `cancel_reason = 'capacity_reduced'` and an outbox notice saying the pool reduced capacity ([ADR-003](003-notification-outbox.md)).
3. Capacity and the counter change in one UPDATE, so the CHECK holds at every moment.
4. An `audit_log` row records who, when, the reason, before and after, and which bookings were cancelled. Rows are only ever added.

Raising capacity cancels nobody and brings nobody back. Closing a session works the same way: everyone is cancelled with `session_closed`, told and audited, and the session refuses new bookings. Both operations describe an end state, so repeating one changes nothing the second time. That makes them safe to retry without an idempotency key.

Alternatives considered:

- **Oldest first.** Punishes the people who planned ahead.
- **Random.** Unpredictable, and hard to explain to a swimmer or to test.
- **Mark bookings "at risk" and let the desk decide later.** Leaves confirmed bookings that may not mean a place.
- **Refuse cuts below the number booked.** Safe for the system, but the pool still can't take those swimmers, so the problem moves to the front desk.

## Result

- A cut cancels the newest bookings, tells each swimmer why and audits who was affected. A cut above the number booked cancels nobody, the same capacity twice writes nothing, and raising capacity restores nobody. Twenty bookings racing a cut never exceed the new capacity. Closing cancels everyone and refuses new bookings, and a swimmer cancelling a booking the pool already cancelled changes nothing ([tests/test_operator.py](../../tests/test_operator.py)).
- My bookings shows the reason, so a pool cancellation is never left unexplained.
- Newest first is a policy choice. A real pool might prefer members, or a waitlist; the choice sits in one ORDER BY.

## Troubleshooting

- **The race test was too weak at first.** With the lock deliberately removed from the capacity change, the first version of its race test failed in only 1 run out of 3, so it could easily have passed with a real bug. It now repeats the race five times per run, each time with 15 places already booked and 20 bookings racing a cut to 10. Without the lock it fails 5 out of 5, and with the lock it passes.
- **Lesson:** a concurrency test is only evidence if it fails reliably when the protection is removed.
