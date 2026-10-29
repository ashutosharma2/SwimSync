# ADR-011: Run the fault drills locally

- Status: Accepted
- Date: 2026-10-22

## Scenario

SwimSync's guarantees have to hold when things fail: an app instance dying mid-request, or the database going down, slowing down or losing the reply to a commit. Tests prove the logic, and drills show what happens when real processes and connections fail. All of it has to cost ₹0.

## Obstacle

- Running the same failures on AWS means deploying the stack, which bills by the hour ([ADR-008](008-aws-designed-not-applied.md)).
- A drill on one Mac isn't AWS. It can't show how a real load balancer, network or managed database behaves, so the results have to be labelled as local experiments.

## Action

- **Drill A, app instance failure** ([write-up](../../drills/01-instance-failure.md)): HAProxy 3.4.7 in front of two uvicorn instances sharing one PostgreSQL 18.6. 30 fictional swimmers book and cancel for 60 s, and one instance is killed with `kill -9` at 20 s and restarted at 40 s. HAProxy doesn't retry on the client's behalf, so every retry is the app's own, with the same key.
- **Drill B, database connectivity** ([write-up](../../drills/02-database-connectivity.md)): Toxiproxy 2.13.0 between the API and PostgreSQL. Connections are refused for 10 s, then every reply is delayed by 1 s for 10 s, then one booking's commit reaches PostgreSQL while its reply is swallowed.
- Hard limits are written before each run: zero duplicates, zero false successes, and every counter matching its bookings. Drill B adds no false "not booked" and an outbox row for every committed change. Other measurements are recorded with no pass mark.
- A prediction is written before each run, and a run only counts if the risky case actually happened. Otherwise it's reported as INCONCLUSIVE.
- The raw logs of every run, including the ones that went wrong, stay in [drills/results/](../../drills/results/).

Alternatives considered:

- **AWS Fault Injection Service.** Real infrastructure, but the stack has to be deployed and billing.
- **Chaos testing a deployed stack.** The same cost problem.
- **Tests only.** They can't kill a process mid-commit or swallow a database reply on a real connection.

## Result

- Drill A passed every hard limit, including two targeted runs. A request cut before its commit rolled back, and the retry booked fresh. A request cut after its commit lost its reply, and the retry got the stored answer ([ADR-002](002-idempotency-keys.md)). Exactly one booking each time, and the dead instance was detected in about 1.9 s.
- Drill B passed after one fix ([ADR-003](003-notification-outbox.md)): fast `database_unavailable` answers while the database was down, `outcome_unknown` and then the stored booking for the swallowed commit, and every notice delivered ([ADR-004](004-two-kinds-of-503.md)).
- Both are local experiments, not proof of how AWS would behave.

## Troubleshooting

- **Random kills missed the risky moment.** The first drill A runs killed the instance at a random time and never cut a request mid-commit, so duplicates weren't really tested. Delaying every request by 100 ms inside the lock overloaded the system into a retry storm, although the hard limits still held. Three runs at 20 ms were INCONCLUSIVE because the kill landed between requests. The fix (1fc14d7) was one targeted "victim" request, held for 2 s before or after its commit and sent to the instance that gets killed.
- **Drill B's first run passed while the outbox worker was dead.** See [ADR-003](003-notification-outbox.md).
- **Lesson:** aim the fault at the case you're worried about, and don't let pass marks hide what the measurements show.
