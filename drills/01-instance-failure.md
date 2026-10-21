# Drill 01: app instance failure

- Date: 2026-10-22
- Fault injected: `kill -9` on API instance a1 at 20 s into a 60 s booking and cancelling load; a1 restarted at 40 s (`drills/a/run.py`)
- Environment: local, one Mac (HAProxy 3.4.7, two uvicorn processes, PostgreSQL 18.6). A local experiment, not proof of AWS high availability.

## Success criteria

Hard limits (any breach fails the drill):

- Zero duplicates
- Zero false successes
- Consistency: every session's counter equals its confirmed bookings, and none exceeds capacity

Recorded, with no pass mark: detection time, errors, time until errors stop, latency, retries.

## Predicted symptom

503 at first, retry succeeds on a2, duplicates most at risk.

<!-- Note: written after a dry run on 2026-10-22, so not an independent prediction. -->

## Evidence

<!-- What actually happened: commands, log lines, measurements, timestamps. -->

## Root cause

<!-- Why it happened, traced to a specific setting or component. -->

## Fix

<!-- The exact change that restored service, and how you confirmed it. -->

## Prevention

<!-- What stops this happening again, or makes it faster to detect. -->
