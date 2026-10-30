# Drill 02: database connectivity

- Date: 2026-10-25 (first run), 2026-10-26 (rerun after fixing the outbox worker)
- Fault injected: Toxiproxy between the API and PostgreSQL (`drills/b/run.py`): connections refused from 10 to 20 s, 1 s of latency on every database reply from 30 to 40 s, and at 50 s a victim booking whose COMMIT reaches PostgreSQL while the reply is swallowed
- Environment: local, one Mac (Toxiproxy 2.13.0, uvicorn, PostgreSQL 18.6). A local experiment, not proof of how a cloud database would behave.

## Success criteria

Hard limits (any breach fails the drill):

- Zero duplicates
- Zero false successes
- Consistency: every session's counter equals its confirmed bookings, and none exceeds capacity
- No false "not booked": no key answered only with "booked": false or "full" that was in fact saved
- The outbox matches committed changes: one booking_confirmed row per booking, one booking_cancelled row per cancelled booking

Victim: first answer 503 outcome_unknown, exactly one victim booking in the database, retry returns 200 with that booking. Any other first answer makes the run INCONCLUSIVE.

Recorded, with no pass mark: outcomes and latency per phase, time to the first answer after each fault ends, how long the outbox takes to settle.

## Predicted symptom

- Down: fast `503 database_unavailable` answers with `booked: false`, most operations give up within the 10 s, and the first request after the proxy returns succeeds almost at once. The outbox backs off and catches up after recovery.
- Slow: `statement_timeout` doesn't fire, because the database runs each statement quickly and the delay is on the network. A booking takes about 8 to 9 s while holding the session lock, other bookings for that session hit `lock_timeout`, clients give up at 2 s, and some bookings commit after their swimmer stopped waiting. Requests back up for a few seconds after the phase ends. No duplicates, no false successes.
- Victim: `503 outcome_unknown` first, then `200` with the same booking on retry.

<!-- Note: agreed after reasoning it through with help, before the run, so not an independent prediction. -->

## Evidence

Every run's raw attempts, logs and summary are in [drills/results/](results/).

| Run | What happened |
|---|---|
| `b-20261025-235015`, first run | Every hard limit passed, and so did the victim. But the outbox worker crashed when the database went down and never restarted: at the end 282 notices were delivered and 258 were still pending. None were lost. |
| `b-20261026-000204`, after fixing the worker | PASS. All 473 notices were delivered and none were left pending. |

The rerun, phase by phase:

| Phase | Attempts | What came back |
|---|---|---|
| Normal, before the faults | 681 | All answered (p50 12.2 ms, p95 52.3 ms) |
| Down: connections refused for 10 s | 1,085 | 1,084 fast `database_unavailable` answers (p50 4.4 ms, slowest 27.7 ms) and 1 `outcome_unknown`. The first answer after the proxy came back took 0.02 s. |
| Between the faults | 779 | All answered (p50 13.5 ms) |
| Slow: 1 s added to every database reply for 10 s | 120 | All 120 timed out at the client's 2 s |
| After | 1,577 | 1,551 answered (p50 14.0 ms) and 26 `database_unavailable`, taking about 1 s each |

The victim's first answer was `503 outcome_unknown`, its retry got `200` with its booking, and it holds exactly one booking. Over the whole run, 174 operations ended with an outcome the client never learned, and the hard limits confirm that no swimmer was told a wrong answer.

Against the prediction: the down phase went as I predicted, but I had expected requests to back up after the slow phase, and they didn't.

## Root cause

- **The worker crash:** a database connection error was raised outside the code that handles delivery failures, so it ended the worker's loop ([ADR-003](../docs/adr/003-notification-outbox.md)).
- **The slow phase:** `statement_timeout` limits the database's own work, not delay on the network. With 1 s added to every reply, each request outlasted the client's 2 s timeout instead. The added latency also pushed new connections past the 2 s connect timeout.
- **The down phase:** the connection failed before any transaction started, so nothing could have been saved, and `database_unavailable` with `booked: false` was the true answer ([ADR-004](../docs/adr/004-two-kinds-of-503.md)).
- **The victim:** the commit reached PostgreSQL and its reply was swallowed, so the explicit commit raised an error and the API answered `outcome_unknown`. The stored idempotency key made the retry return the saved booking.

## Fix

[b020f1c](https://github.com/ashutosharma2/SwimSync/commit/b020f1c): the worker treats a database error as the database's problem rather than the notice's, so it doesn't use up the row's attempts. It backs off, up to 30 s between tries, and carries on when the database returns. A new test, `test_worker_survives_a_database_outage`, covers it, and the rerun delivered all 473 notices.

## Prevention

- The drill records the outbox at the end of every run, which is how the dead worker showed up even though every pass mark was met.
- Watching for a growing outbox is parked in [BACKLOG.md](../BACKLOG.md).
- Drill B is the regression test for database failures. The slow phase is a reminder that `statement_timeout` isn't a network timeout: the client timeout and the connect timeout are what limit a slow network.
