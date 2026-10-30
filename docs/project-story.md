# SwimSync: the project story (SOART)

SOART is Scenario, Obstacles, Actions, Results and Troubleshooting. This file tells how SwimSync was built, from one turned-away booking to a system tested against races, crashes and a failing database. Each decision has its own record in [adr/](adr/).

**Status (2026-10-30):** the booking core, the fault drills A and B, and the AWS design are done. The swimmer screen is built, but the operator screen is paused, so the interface phase stays open. Drill C (Kubernetes) is built and waits for my prediction, and the portfolio write-ups are in progress.

---

## S: Scenario

I was turned away from a swimming session I had booked because the pool was at capacity. I don't know why it happened. It could have been an oversold booking system, walk-ins sharing the same pool, a late capacity cut or a mistake at the desk, and one incident doesn't show that any platform is faulty or that this happens often.

It raised one question: what does it take for a booking system to keep its promise? SwimSync is my answer for the part software can control: never confirm more places than a session has, release a cancelled place exactly once, and never tell a swimmer "booked" or "not booked" without evidence.

The constraints: it had to cost ₹0, with no paid service, hosted database or notification provider; I did no user research (my decision on 2026-10-21); and I'm one student who has to be able to defend every decision in an interview.

## O: Obstacles

1. **The cause is unknown.** I couldn't fix "the bug", so I designed against the plausible causes a booking system can prevent (a race between bookings, a stale screen, an unreliable reservation, a late capacity change) and labelled every assumption ([initial-research.md](research/initial-research.md)).
2. **Races don't show up in a demo.** Two swimmers taking the last place at the same moment only happens under load, so the tests had to be able to fail.
3. **Failures are ambiguous.** When a reply is lost, the app can't tell whether the booking was saved, and a wrong guess either double-books or strands a swimmer.
4. **₹0 rules out the cloud.** My AWS account bills automatically beyond its credits, so every failure had to be made on one Mac, and the AWS design could only be validated, never deployed.
5. **A passing test can be empty.** A drill that never hits the risky moment passes without proving anything, so each one needed evidence that the fault actually happened.
6. **A promise can be broken after it's made.** If a pool cuts capacity, bookings that were true when made stop being true.

## A: Actions

### The booking engine (2026-10-21)

Every booking locks its session's row, checks a booked counter and writes in one transaction, with `CHECK (booked <= capacity)` as a backstop ([ADR-001](adr/001-session-row-lock.md)). Every booking request carries an idempotency key that stores its first answer, so a retry gets the same answer instead of a second booking ([ADR-002](adr/002-idempotency-keys.md)).

### Notices through an outbox (2026-10-22)

Each booking change writes its notice in the same transaction, and a separate worker delivers it with backoff, at least once, into an inbox that can't hold duplicates ([ADR-003](adr/003-notification-outbox.md)).

### Drill A: an app instance killed mid-request (2026-10-22 to 2026-10-23)

Two API instances behind HAProxy, 30 fictional swimmers, and one instance killed with `kill -9`. The final runs aimed the kill at one request held just before or just after its commit ([drill 01](../drills/01-instance-failure.md), [ADR-011](adr/011-local-fault-drills.md)).

### Honest answers when the database fails (2026-10-24)

Timeouts and an explicit commit let the API say either "database unavailable, not booked" or "outcome unknown", never a guess ([ADR-004](adr/004-two-kinds-of-503.md)).

### Drill B: the database down, slow, and losing a commit reply (2026-10-25 to 2026-10-26)

Toxiproxy between the API and PostgreSQL broke the connection three ways, including a commit that reached the database while its reply was swallowed ([drill 02](../drills/02-database-connectivity.md)).

### The AWS design, validated and never applied (2026-10-27)

Terraform for a VPC across two zones, private app instances reached through Session Manager over VPC endpoints, and RDS with a password it manages itself ([ADR-008](adr/008-aws-designed-not-applied.md), [ADR-009](adr/009-vpc-endpoints-not-nat.md), [ADR-010](adr/010-rds-managed-secret.md)).

### A frontend that never claims without evidence (2026-10-27)

The Book button retries with the same key, checks My bookings when retries run out, and says "we couldn't confirm yet" rather than guessing ([ADR-005](adr/005-no-answer-without-evidence.md)).

### CI (2026-10-28)

Every push runs the backend tests against a real PostgreSQL, the frontend tests and build, and `terraform validate` with no AWS credentials.

### Operator capacity changes (2026-10-29)

A cut cancels the newest bookings that no longer fit, tells each swimmer why and writes an audit row, all under the same session lock ([ADR-006](adr/006-capacity-cuts-newest-first.md)). The operator endpoints sit behind a shared token ([ADR-007](adr/007-operator-shared-token.md)).

### The design: a demo, then the React app (2026-10-29 to 2026-10-30)

A one-file browser demo ran the booking rules with made-up data and settled the pool design, which then moved into the React app ([ADR-012](adr/012-pool-canvas-beside-react.md), [ADR-013](adr/013-port-the-demo-css.md)). The two endpoints an operator screen needs, who is booked and the change log, are built behind the operator token ([ADR-016](adr/016-operator-reads-who-is-booked.md)). The screen itself is partly built and paused.

### Containers and Kubernetes, locally (2026-10-29 to 2026-10-30)

Docker Compose runs the whole app with one command ([ADR-014](adr/014-docker-compose-beside-native.md)), and a one-node kind cluster runs the same images with two API replicas, which CI builds and books through on every push ([ADR-015](adr/015-local-kubernetes-with-kind.md)). Drill C will put a rolling update and a forced pod kill under booking load ([drill 03](../drills/03-rolling-update.md)).

## R: Results

- **No oversell under races.** 20 swimmers racing for 1 place and 30 racing for 5 never oversell. With the lock removed, both race tests failed in 3 out of 3 runs, and the capacity-cut race test failed in 5 out of 5.
- **Crashes don't double-book.** In drill A, every hard limit held in every run. A request cut off before its commit rolled back and its retry booked fresh; one cut off after its commit had its reply lost, and the retry got the stored answer. Either way, exactly one booking. HAProxy noticed the dead instance in about 1.9 s.
- **A failing database gets honest answers.** In drill B, 1,084 requests got a fast "database unavailable" while it was down, service came back 0.02 s after it returned, the swallowed commit was answered "outcome unknown" and then found on retry, and after the worker fix all 473 notices were delivered.
- **Kubernetes behaves.** With a 5 s pause before each pod stops, a rolling restart answered all 291 requests in a 25 s test. Deleting an API pod while 40 swimmers booked a 20-place session gave exactly 20 bookings, 20 "full" answers and no duplicates.
- **Tests and CI.** 52 backend and 29 frontend tests (2026-10-30), with five CI jobs on every push, including a throwaway kind cluster.
- **Cost.** ₹0. The AWS design is validated and has never been applied.
- **What this doesn't show.** Real users, a real pool, how AWS would behave, or the desk-inventory cause, which is out of scope. The drills are local experiments.

## T: Troubleshooting

- **Running uvicorn from the wrong folder (2026-10-29).** The command failed with "no such file or directory: .venv/bin/uvicorn" because a new terminal opens in my home folder. Every setup block in the README now starts with `cd ~/projects/swimsync`. Lesson: instructions should work from a fresh terminal.
- **The tests hung on a lock (2026-10-22).** The outbox worker held a `FOR UPDATE` lock while the inbox insert on another connection needed a key-share lock on the same row, so each waited on the other. `pg_stat_activity` showed the wait, and `FOR NO KEY UPDATE` fixed it. Lesson: know which lock a foreign-key check takes.
- **The race test was too weak (2026-10-29).** With the lock removed from the capacity cut, the first race test failed in only 1 run out of 3. Repeating the race five times per run, with 15 places already booked and 20 bookings racing a cut to 10, made it fail 5 out of 5. Lesson: a concurrency test is only evidence if it fails reliably without the protection.
- **Capacity and the counter had to change together (2026-10-29).** PostgreSQL checks `booked <= capacity` after every statement, so a cut has to change both in one UPDATE: the constraint is checked per statement, not per transaction.
- **Drill A overloaded itself (2026-10-22).** A 100 ms delay before every commit, inside the lock, capped throughput below demand, so clients timed out and retried while their first requests were still queued. The hard limits held, but it was a retry storm, not a test of the crash. Lesson: retries pile up when requests queue.
- **Drill A missed the risky moment (2026-10-23).** Three runs with a 20 ms delay were INCONCLUSIVE because the kill landed between requests. One targeted victim request, held 2 s before or after its commit, fixed it. Lesson: aim the fault at the case you're worried about, and report INCONCLUSIVE rather than PASS when it didn't happen.
- **An unexplained stall (2026-10-22, still open).** One drill A run had 30 client timeouts from a stall about 6 to 7.7 s in, before the kill, with nothing in PostgreSQL's log.
- **A 1 s connect timeout took 2 s (2026-10-24).** libpq rounds connect timeouts below 2 s up to 2 s, which I only found by measuring. The code now asks for 2 s. Lesson: measure timeouts instead of trusting the setting.
- **The outbox worker died with the database (2026-10-25).** Drill B passed every hard limit while the worker had crashed for good, with 258 notices waiting. A database error was raised outside the code that handles delivery failures. The fix ([b020f1c](https://github.com/ashutosharma2/SwimSync/commit/b020f1c)) lets the worker back off and carry on. Lesson: the recorded measurements matter as much as the pass marks.
- **`statement_timeout` didn't help on a slow network (2026-10-25).** It limits the database's own work, so with 1 s added to every reply, requests hit the client's 2 s timeout instead. Lesson: name which timeout covers which delay.
- **The demo's race didn't show (2026-10-29).** With the lock switched off, the demo's 30 simultaneous bookings didn't overlap, because simulated latency spread them out, and its text claimed refusals that hadn't happened. Narrowing the latency and making the text depend on the actual refusals fixed it.
- **The VPC endpoints weren't cheaper (2026-10-29).** A Terraform comment said the endpoints cost less per hour than a NAT gateway. Working the numbers for ADR-009 showed three endpoints in two zones cost more per hour than one NAT gateway, so the comment now gives the real reason, security. Lesson: check a cost claim before it goes in writing.
- **Container session times were in UTC (2026-10-29).** Planning the Docker seed step showed the containers run in UTC, so "tomorrow at 06:30" would have shown as 12:00. The seed now takes a time zone.
- **kind couldn't load the images (2026-10-29).** Docker Desktop keeps multi-platform images with only the local platform's layers, and `kind load docker-image` failed on the rest. Saving each image for the local platform fixed it.
- **A rolling restart refused requests (2026-10-29).** A stopping pod refused connections while the cluster still sent it traffic: 4 errors in 308 requests. A 5 s pause before each pod stops brought it to none in 291.
- **CI got a 502 on a brand-new cluster (2026-10-29).** A booking sent 0.25 s after the pods reported ready got a 502. The deploy script now waits until the API answers.
- **A type that referred to itself (2026-10-29).** In the React port, the pool floor's module kept the floor that's showing in a variable typed from its own create function, which TypeScript can't infer. An explicit interface fixed it.
- **The kind cluster was gone (2026-10-30).** After Docker Desktop restarted, the cluster no longer existed, and the deploy script rebuilt it from nothing.
