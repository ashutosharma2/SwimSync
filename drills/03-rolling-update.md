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

<!-- Write this before the first run: what you expect swimmers, nginx and the pods to show, for the rollout and for the kill. drills/c/run.py won't start a real run while this section is empty. -->

## Evidence

<!-- What actually happened: commands, log lines, measurements, timestamps. -->

## Root cause

<!-- Why it happened, traced to a specific setting or component. -->

## Fix

<!-- The exact change that restored service, and how you confirmed it. -->

## Prevention

<!-- What stops this happening again, or makes it faster to detect. -->
