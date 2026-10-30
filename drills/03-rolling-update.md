# Drill 03: rolling update and forced pod kill on Kubernetes

- Date: 2026-10-30. The prediction was committed before the first run ([a561e12](https://github.com/ashutosharma2/SwimSync/commit/a561e12)).
- Fault injected: on the local kind cluster (`drills/c/run.py`), 20 s into 60 s of booking and cancelling load sent through the web frontend. `--mode rollout` runs `kubectl rollout restart deployment/api`; `--mode kill` force-deletes one of the two API pods with `--grace-period=0 --force`.
- Environment: local, one Mac (kind 0.33.0, Kubernetes v1.37.0, Docker Desktop). A local experiment, not proof of how EKS or any cloud cluster would behave.

## Success criteria

Hard limits (any breach fails the drill), the same as drill A:

- Zero duplicates
- Zero false successes, including a "booked" that the client found by checking My bookings after giving up
- Consistency: every session's counter equals its confirmed bookings, and none exceeds capacity

Evidence rule: a run counts only if the fault happened while swimmers were booking. In a rollout, both an old pod and a new pod must have answered requests. In a kill, the killed pod must have answered before the kill and its replacement after it. Otherwise the run is INCONCLUSIVE.

Recorded, with no pass mark: failed attempts before, during and after the fault, retries, latency, outcomes the client never learned, and how long the rollout or the replacement took.

## Predicted symptom

Rollout: With the 5-second preStop pause, I expect zero failed requests, based on the previous 291/291 successful run. Without the pause, I expect a small number of failures—roughly the previous 4 HTTP 502s and 2 timeouts in 308 requests—because nginx does not retry a request that reaches a disappearing or unavailable pod. The hard limits should hold: retries reuse the same idempotency key, and the database transaction should prevent duplicate bookings or a counter mismatch.

Kill: --grace-period=0 --force is not exactly the same as kill -9: the API removes the Pod immediately, but the node may keep its process alive briefly. However, I do not expect the configured 5-second preStop pause to run.

A request already halfway through on the killed pod may either finish during that small termination window or be interrupted. If interrupted before commit, the database transaction should roll back. nginx will return a 502 or the connection will fail; the client will retry with the same Idempotency-Key, and the surviving pod should create the booking once.

If the commit landed but the reply was lost, the retry should reach the surviving pod and receive the stored idempotent response. The booking must exist exactly once; the client must not be told it booked something that was never committed.

A request sent before the kill may already be executing on either pod. A request arriving during termination may reach the surviving pod, or it may hit a stale endpoint pointing at the terminating pod and fail. Since nginx has no retries, any such failure goes back to the client, which retries. After the replacement is ready and registered as a Service endpoint, new requests should reach a healthy pod.

I expect the surviving pod to continue accepting bookings during replacement startup, assuming it remains healthy and the database is available. I will measure the time until two pods are ready rather than assume a fixed recovery time. /health not checking the database means a pod can appear healthy even when booking operations cannot reach the database.

Hard limits: No duplicate booking, no false successful booking, and no booking counter that disagrees with committed bookings. A timeout may leave the client temporarily uncertain, but the reused idempotency key should make its retry safe.

INCONCLUSIVE if: The test does not establish whether the request reached the killed or surviving pod; the logs cannot distinguish pre-commit from post-commit interruption; the client does not reuse the same idempotency key; or the test cannot verify persisted bookings and counters after recovery.

## Evidence

Every run's attempts, events, Kubernetes events and summary are in [drills/results/](results/). Each kill run also has `node-logs.txt`, with the container runtime's, the kubelet's and PostgreSQL's log lines from around the kill. Times below are relative to the fault.

| Run | What happened |
|---|---|
| `c-rollout-20261030-132341` | PASS. 3,872 operations, 0 failed attempts and 0 retries. Both old pods and both new pods answered. The new pods were ready 6.27 s after the restart began, and the old pods were gone after 12.72 s. p95 latency went from 20.6 ms before the rollout to 38.3 ms during it. |
| `c-kill-20261030-132455` | PASS. 2,993 operations and 46 failed attempts, all retried successfully. Nothing failed around the kill. The killed pod answered 14 more requests in the 0.34 s after the force delete. The kubelet started the 5 s preStop pause, which was cut off (exit 137), sent SIGTERM with a 2 s timeout at +1.1 s, and the process exited on its own at +1.5 s. The replacement was ready after 3.65 s. The failures came from elsewhere: 30 client timeouts, one per swimmer, from a database stall about 6 s before the kill, and 16 `503 database_unavailable` answers 11 to 27 s after it. Each 503 was a lock wait on a session row, cancelled by the 500 ms statement timeout. |
| `c-kill-20261030-132725` | PASS, with a 9 s outage. 3,099 operations and 101 failed attempts, all retried successfully. The killed pod answered 19 more requests in the 1.45 s after the force delete. From +1 s, PostgreSQL cancelled lock waits on session rows, and answers dropped from 60 to 80 a second to between 0 and 5. The kubelet sent SIGTERM at +1.5 s. The process was still running 2 s later, got SIGKILL at +3.9 s and exited at +4.5 s. At +7.8 s PostgreSQL logged four connections "reset by peer", and nginx returned six 502s at the same moment. Answers were back at the full rate at +9 s. In all there were 82 client timeouts, 13 `503 database_unavailable` answers and six 502s. A PostgreSQL checkpoint had started at +0.7 s. The replacement's container took about 9 s to start, and the pod was ready at +12.7 s. |
| `c-kill-20261030-133040` | PASS. 3,854 operations and 0 failed attempts. The killed pod answered for 0.25 s after the delete, got SIGTERM at +1.06 s and exited on its own at +1.67 s. The replacement was ready after 3.71 s. |

Each interrupted booking's attempts show which side of the commit it was on. A retry answered 200 means an earlier attempt had committed and only its reply was lost, so the retry got the stored answer ([ADR-002](../docs/adr/002-idempotency-keys.md)). A retry answered 201 means the earlier attempts had rolled back, so it booked fresh. In the first kill run, 4 bookings were the first kind and 5 the second; in the second kill run, 11 and 2. Each one left exactly one booking, and no swimmer was told "not booked" for a booking that existed.

## Root cause

- The rollout went as [ADR-015](../docs/adr/015-local-kubernetes-with-kind.md) intended. The new pods were ready before the old ones stopped, and the old pods kept answering through their 5 s pause, so no request failed. ADR-015 has the comparison without the pause: 4 errors in 308 requests.
- A force delete isn't `kill -9` on this cluster. The Pod leaves the API at once, but the kubelet still starts the preStop hook, sends SIGTERM and waits 2 s before SIGKILL (`node-logs.txt` in each kill run). The Kubernetes docs describe the same small grace period ([pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination-forced), last modified 2026-07-27, read 2026-10-30). In the first and third kills, traffic stopped reaching the pod within 0.34 s of the delete, before it was even signalled, and it exited with nothing in flight. That's why the predicted 502s didn't appear in those runs.
- The second kill's outage is only partly explained.
  - Known: it began at about +1 s, when PostgreSQL started cancelling lock waits on session rows, before the pod was signalled. The dying process didn't finish within its 2 s and was killed. Answers came back at the full rate just after PostgreSQL saw four connections reset at +7.8 s.
  - Inferred, not shown: the database slowed around +1 s, so requests on both pods queued behind session row locks and took longer than the client's 2 s. The dying pod was killed with requests still open, and the queue cleared when its connections were reset.
  - Not explained: why the database slowed, and why the connections were reset 3.3 s after the process exited. A checkpoint started at +0.7 s, but the stall before the first kill happened with no checkpoint running.
- The 30 simultaneous timeouts before the first kill match drill A's still-open stall: every swimmer timing out at once, before any fault. It has now happened on two different setups, so the cause is more likely in the database path than in HAProxy or Kubernetes (inferred).
- The `503 database_unavailable` answers are SwimSync working as designed. A lock wait over 500 ms is cancelled and rolled back, and the swimmer is told "not booked", which was true every time ([ADR-004](../docs/adr/004-two-kinds-of-503.md)).

## Fix

Nothing in SwimSync needed fixing: every hard limit held in all four runs, and no swimmer was told anything false. One correction to the drill: `drills/c/run.py` described the kill as the Kubernetes version of drill A's `kill -9`, which the first kill showed was wrong. Its docstring now says what the kubelet does.

## Prevention

- Write the prediction first. Whether a force delete is a `kill -9` came up while writing it, and the answer changed what the kill mode tests.
- Repeat the kill. Two kills had no failures around the fault and one had a 9 s outage, so a single run would have given the wrong picture.
- Retrying with the same key is what made the lost replies safe: 15 bookings across the first two kills committed with their reply lost, and each retry got the stored answer.
- Still open: what slowed the database during the second kill, and what caused the stalls before the first kill and in drill A. Logging lock waits (`log_lock_waits`) and sampling `pg_stat_activity` during a kill would narrow it down. Checkpoints are already logged.
