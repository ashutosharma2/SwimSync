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

Every run's raw attempts, HAProxy log and summary are in [drills/results/](results/).

| Run | What happened |
|---|---|
| `a-20261022-004640`, kill at a random moment | PASS. 4,103 operations and 88 failed attempts, all of them HAProxy 503s after the kill, and every one retried successfully. HAProxy marked a1 down 1.93 s after the kill, the errors stopped at the same moment, and a1 rejoined 2.01 s after its restart. No request was cut off mid-commit, so duplicates weren't really put at risk. |
| `a-after-commit-20261022-222039`, 300 ms delay after every commit | PASS, with evidence: 2 bookings committed and lost their reply, and their retries got the stored answer; 1 cancel committed and lost its reply. There were also 30 client timeouts from a stall about 6 to 7.7 s into the run, before the kill. PostgreSQL logged nothing then, and the stall is still unexplained. |
| `a-before-commit-20261022-222251`, 100 ms delay before every commit, inside the lock | PASS, with evidence (5 bookings rolled back and their retries booked fresh), but the run was overloaded. The delay inside the lock capped throughput below demand, clients timed out at 2 s and retried while their first requests were still queued, and the restarted a1 failed a health check and was taken out again. The hard limits held. |
| `a-before-commit-20261023-175915`, `-180027` and `-180144`, 20 ms delay | INCONCLUSIVE three times: the kill landed between requests. The hard limits held, p95 was about 100 to 130 ms, and one give-up was resolved correctly by checking My bookings. |
| `a-before-commit-20261023-180753`, a victim request held 2 s before its commit | PASS. The victim's first attempt was cut off (`RemoteProtocolError`). The retry through HAProxy got 201 and a fresh booking (306), and the victim holds exactly one booking. The load's 91 failed attempts were all retried. a1 was marked down after 1.96 s. |
| `a-after-commit-20261023-180907`, a victim request held 2 s after its commit | PASS. The victim's booking was saved, then a1 died before replying. The retry got 200 with the stored booking (274), and the victim holds exactly one booking. a1 was marked down after 1.95 s. |

## Root cause

- Requests failed only while HAProxy still sent traffic to the dead instance. It checks `/health` every second and marks a server down after 2 failures (`inter 1s fall 2` in [haproxy.cfg](a/haproxy.cfg)), which is the 1.9 s detection time. HAProxy doesn't retry (`retries 0`), so each failed request went back to the client as a 503, and the client's retry with the same key reached a2.
- A booking cut off before its commit rolled back, because PostgreSQL aborts an open transaction when its connection dies. So the retry booked fresh.
- A booking cut off after its commit was already saved, together with its idempotency key and stored answer ([ADR-002](../docs/adr/002-idempotency-keys.md)). So the retry got 200 with the same booking instead of making a second one.
- The overload and the INCONCLUSIVE runs came from the drill, not from SwimSync. A delay on every request inside the lock limited throughput, and a short delay let the kill land between requests.

## Fix

Nothing in SwimSync needed fixing: every hard limit held in every run. The drill itself changed:

- Drill-only delays, off unless `run.py` sets them ([15bf1bd](https://github.com/ashutosharma2/SwimSync/commit/15bf1bd)).
- The evidence rule: a run is INCONCLUSIVE unless the risky case actually happened.
- After giving up, the load script checks My bookings, and a wrong "booked" there counts as a false success ([047f54c](https://github.com/ashutosharma2/SwimSync/commit/047f54c)).
- One targeted victim request instead of a delay on every request: held 2 s before or after its commit, sent straight to a1, which is killed 0.5 s into the hold ([1fc14d7](https://github.com/ashutosharma2/SwimSync/commit/1fc14d7)).

## Prevention

- Every client retries with the same idempotency key, which is what made a lost reply safe ([ADR-005](../docs/adr/005-no-answer-without-evidence.md)).
- The health check sets how long requests fail after a crash: about 2 s here. A shorter interval would shorten that window.
- The two victim modes are the regression test for lost replies, so they should be rerun after any change to the booking path.
- Still open: the unexplained stall 6 to 7.7 s into `a-after-commit-20261022-222039`.
