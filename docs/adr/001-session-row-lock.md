# ADR-001: Lock the session row and keep a booked counter

- Status: Accepted
- Date: 2026-10-21

## Scenario

A swimming session has a fixed number of places. When several swimmers ask for the last places at once, at most `capacity` of them may be confirmed. Concurrency oversell is the first of the plausible causes behind [my incident](../research/incident.md) that software can prevent.

## Obstacle

The obvious code reads how many places are taken, checks there's room and inserts a booking. Two requests can both read "one place left" before either inserts, and both get confirmed. Nothing in the read stops the second request.

The fix has to hold under real concurrency, be easy to explain, and not turn every busy moment into errors for swimmers.

## Action

Every booking, cancel and operator change runs in one transaction that starts by locking the session's row:

1. `SELECT ... FROM sessions WHERE id = %s FOR UPDATE`. Every other change to the same session waits here until this transaction ends, so "is there room?" and "take a place" can't be split by another request.
2. Check the swimmer's existing booking, whether the session is closed, and `booked < capacity`.
3. Insert the booking and add one to `sessions.booked` in the same transaction.

The session row keeps a `booked` counter instead of counting bookings each time. The counter lives on the row that is already locked, so the check reads one number that nobody else can change until commit.

The table also has `CHECK (booked >= 0 AND booked <= capacity)`. If a bug ever skipped the lock, the database would refuse the write instead of overselling.

The lock order is always the session row first, so booking, cancelling and capacity changes ([ADR-006](006-capacity-cuts-newest-first.md)) queue behind each other per session and can't deadlock.

Alternatives considered:

- **SERIALIZABLE isolation.** Also correct, but conflicting transactions fail and have to be retried, so a busy session turns into errors and retry loops instead of a short queue.
- **Optimistic concurrency (a version column).** The same retry problem under contention, which is exactly when a popular session fills.
- **Advisory locks.** They work, but they're a convention every code path has to remember. A row lock comes with the row the booking changes.
- **COUNT(\*) under the lock instead of a counter.** Correct, but it gets slower as bookings grow, and a CHECK constraint can't guard a count.

## Result

- 20 swimmers racing for 1 place and 30 racing for 5 never oversell, and ten simultaneous cancels release a place once ([tests/test_booking.py](../../tests/test_booking.py)).
- With the lock removed, both race tests failed in 3 out of 3 runs, and each time it was the CHECK constraint that rejected the oversell. The backstop works, but the swimmer gets an error instead of a clear "full", which is why the lock is the main defence.
- Requests for one session wait for each other. A lock held too long times out after 500 ms instead of piling requests up ([ADR-004](004-two-kinds-of-503.md)).
- The guarantee holds with any number of app instances (drill A ran two) because it lives in the one database.

## Troubleshooting

- None while building it. The lock-removed runs were a deliberate check that the tests can fail, not a bug.
