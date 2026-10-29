# ADR-004: Answer database failures with two different 503s

- Status: Accepted
- Date: 2026-10-24

## Scenario

The database can be down, slow, or lose the reply to a commit. In each case the API still has to tell the app something true.

## Obstacle

- The API had no database timeouts, so a slow database held requests open for as long as it took.
- A generic 500 tells the app nothing. It can't say "not booked", because the booking may have been saved, or "booked", because it may not have been.
- Once the commit has been sent, the API can't know the outcome if the reply is lost. PostgreSQL may have saved it or not.

## Action

Every booking change goes through one function that commits explicitly, so the code knows which side of the commit a failure happened on:

- **Can't connect, or a failure before the commit** (including statement and lock timeouts): PostgreSQL rolls the transaction back, so nothing changed. The answer is `503 database_unavailable` with `booked: false` (or `cancelled: false`).
- **A failure during the commit:** the change may or may not have been saved. The answer is `503 outcome_unknown`, which says neither yes nor no. The app retries with the same key ([ADR-002](002-idempotency-keys.md)) or checks My bookings.
- Both carry `Retry-After: 1`. Reads answer `database_unavailable` too.

The timeouts are a 2 s connect, a 500 ms statement and a 500 ms lock wait, well inside a client's patience. libpq rounds connect timeouts below 2 s up to 2 s (measured on 2026-10-24 with libpq 18.6), so the code asks for what it actually gets.

The app treats the two differently ([ADR-005](005-no-answer-without-evidence.md)): `database_unavailable` can end in "not booked", and `outcome_unknown` never can.

Alternatives considered:

- **One 503 for every failure.** The app couldn't tell "nothing saved" from "maybe saved", so it would have to treat every failure as "maybe" and could never say "not booked".
- **Retry inside the API before answering.** Holds the request open longer, and retrying after a lost commit is only safe with the idempotency key, which the app already sends.
- **Two-phase commit.** It coordinates a commit across several databases, but here there's one database and the uncertainty is in the network.

## Result

- With the database down, a booking gets a fast 503 with `booked: false` and nothing is saved. A held lock times out in under 1.5 s. A commit that saved but lost its reply gives `outcome_unknown`, and the retry returns the stored booking; a commit that didn't save also gives `outcome_unknown`, and the retry books fresh ([tests/test_db_failures.py](../../tests/test_db_failures.py)).
- Drill B (local, rerun on 2026-10-26): 1,084 fast `database_unavailable` answers while the database was unreachable, and service back 0.02 s after it returned. The swallowed-commit booking got `outcome_unknown` first, then `200` with its one booking on retry ([ADR-011](011-local-fault-drills.md)).
- The slow phase showed a limit: `statement_timeout` caps the database's own work, not network delay. With 1 s added to every reply, all 120 attempts hit the client's 2 s timeout instead.

## Troubleshooting

- **Part of the prediction was wrong.** Before drill B, the prediction expected requests to back up for a few seconds after the slow phase ended. There was no backlog. The added latency also pushed new connections past the 2 s connect timeout.
