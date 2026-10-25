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

<!-- What you expect the swimmer, the load balancer and the logs to show. -->

## Evidence

<!-- What actually happened: commands, log lines, measurements, timestamps. -->

## Root cause

<!-- Why it happened, traced to a specific setting or component. -->

## Fix

<!-- The exact change that restored service, and how you confirmed it. -->

## Prevention

<!-- What stops this happening again, or makes it faster to detect. -->
