# Drill 03: rolling update and forced pod kill on Kubernetes

- Date: <!-- the run's date -->
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

<!-- What actually happened: commands, log lines, measurements, timestamps. -->

## Root cause

<!-- Why it happened, traced to a specific setting or component. -->

## Fix

<!-- The exact change that restored service, and how you confirmed it. -->

## Prevention

<!-- What stops this happening again, or makes it faster to detect. -->
