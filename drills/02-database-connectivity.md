# Drill 02: database connectivity

- Date: <!-- the run's date -->
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

<!-- What actually happened: commands, log lines, measurements, timestamps. -->

## Root cause

<!-- Why it happened, traced to a specific setting or component. -->

## Fix

<!-- The exact change that restored service, and how you confirmed it. -->

## Prevention

<!-- What stops this happening again, or makes it faster to detect. -->
