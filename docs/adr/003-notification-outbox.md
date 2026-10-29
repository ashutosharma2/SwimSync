# ADR-003: Send notices through an outbox written with the booking

- Status: Accepted
- Date: 2026-10-22

## Scenario

Swimmers are told when a booking is confirmed, when they cancel, and when the pool cancels for them ([ADR-006](006-capacity-cuts-newest-first.md)). A notice must never describe something that didn't happen, and a change that did happen must always produce its notice.

## Obstacle

Sending the message inside the request ties two systems together without a shared transaction:

- Send, then the transaction rolls back: the swimmer hears about a booking that doesn't exist.
- Commit, then the send fails or the process dies: the booking exists and nobody is told.

A real provider (email or SMS) would cost money, so the MVP delivers to an in-app inbox. The design still has to work the same way for a provider later.

## Action

Each booking change writes an `outbox` row in the same transaction as the change, so the row exists if and only if the change committed. It is a request to notify, never the record of a booking's status: the bookings table is.

A separate worker ([scripts/outbox_worker.py](../../scripts/outbox_worker.py)) delivers due rows:

- It takes the oldest due row with `FOR NO KEY UPDATE SKIP LOCKED`. Several workers can run without taking the same row, and the weaker lock doesn't block the inbox's foreign-key check while delivery runs.
- A failed delivery is retried after 1, 2, 4, 8 seconds and so on, capped at 60, and marked failed after 5 attempts. A failure never touches the booking.
- Delivery is at least once. A crash after delivering but before marking the row delivered means a second delivery, which the inbox turns into a no-op: each inbox entry has a unique `outbox_id`.

Alternatives considered:

- **Send inside the request.** Both failure cases above.
- **Send right after commit, in the same process.** Closes the first gap but not the second: a crash between commit and send loses the notice.
- **A message broker.** Solves delivery, but adds a paid or self-run service. The outbox gives the same guarantee with the database already in use.

## Result

- A rolled-back booking leaves no notice, booking and cancelling each queue exactly one, a full session queues none, four workers deliver each notice once, and a crash after delivery doesn't duplicate an inbox entry ([tests/test_outbox.py](../../tests/test_outbox.py)).
- Notices arrive after a short delay, not instantly. An idle worker checks every second.
- At least once is enough for the inbox because of the unique `outbox_id`. A real email or SMS provider would need its own way to drop duplicates, such as sending the outbox id as the message id.

## Troubleshooting

- **The worker died with the database.** Drill B's first run (2026-10-25) passed every hard limit, but the outbox worker crashed when the database went down and never restarted. 258 notices waited in the outbox. None were lost, because they were stored safely.
- **Cause:** a database connection error was raised outside the code that handles delivery failures, so it ended the worker's loop.
- **Fix** (b020f1c): the worker treats a database error as the database's problem, not the notice's, so the row's attempts aren't used up. It backs off, up to 30 s between tries, and carries on when the database returns. A new test covers it, and the rerun delivered all 473 notices.
- **Lesson:** a drill can pass its checks while the system is clearly unhealthy. The recorded measurements matter as much as the pass marks.
