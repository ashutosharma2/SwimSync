# SwimSync

[![Tests](https://github.com/ashutosharma2/SwimSync/actions/workflows/tests.yml/badge.svg)](https://github.com/ashutosharma2/SwimSync/actions/workflows/tests.yml)

A booking system for swimming sessions that never confirms more places than a session has, releases a cancelled place exactly once, and never tells a swimmer "booked" or "not booked" without evidence.

The full story of the project, including every real error I hit, is in [docs/project-story.md](docs/project-story.md). The architecture diagrams are in [docs/architecture.md](docs/architecture.md), and a one-line-per-day build log is in [LOG.md](LOG.md).

## Status

| Phase | | |
|---|---|---|
| 1. Problem framing | ✅ | Desk research, the causes SwimSync designs against, MVP scope |
| 2. Local core | ✅ | Booking, cancel, idempotency keys, outbox and notifications, honest answers when the database fails; 34 tests |
| 3. Fault drills | ✅ | Drill A (app instance killed mid-request) and drill B (database down, slow, and a lost commit reply), both passing |
| 4. MVP interface | ⏳ | First version built and tested (15 tests); on hold while the visual design is redone in Figma |
| 5. Infrastructure design | ✅ | Terraform for a two-zone AWS VPC, ALB, two instances and RDS; validated locally, never applied |
| 6. Portfolio | ⏳ | Architecture diagrams and build log done; demo, project story and drill write-ups to finish |

Architecture decision records will go in [docs/adr/](docs/adr/). None are written yet.

## Project summary

SwimSync is a FastAPI, PostgreSQL and React app for booking capacity-limited swimming sessions. A database row lock makes the capacity check and the booking one atomic step, idempotency keys make retries safe, and notifications go through an outbox written in the same transaction as the booking. When the database fails, the API says either "not booked" or "outcome unknown", never a guess, and the frontend checks again with the same key until it knows. Concurrency tests and two local fault drills show the guarantees hold when 20 to 30 requests arrive at once, when an app instance is killed mid-request, and when the database goes down or slows to a crawl. The AWS design is written in Terraform and validated, but deliberately never deployed, to keep the cost at ₹0.

## Personal motivation

I was turned away from a swimming session I had booked because the pool was at capacity. I don't know why it happened. It could have been an oversold booking system, walk-ins sharing the same pool, a late capacity cut or a mistake at the desk. One incident doesn't show that any platform is faulty or that this happens often, and I don't claim either. It made me ask what it takes for a booking system to keep its promise, and SwimSync is my attempt at the part that software can control.

## Problem statement

A confirmed booking should mean the facility can take you. Because the cause of my incident is unknown, I designed SwimSync against three of the plausible causes that a booking system can prevent and that I can prove with tests:

- Concurrency oversell: two requests both see one place left and both get confirmed.
- Stale display: the app shows availability that is out of date. In SwimSync the list is only advisory, and the server checks capacity again when it books.
- Unreliable reservation: a booking shown as confirmed before the place was reserved, or a retry that books twice.

Two other plausible causes, possibly the likelier ones, are out of scope for the MVP: a separate desk inventory (walk-ins or members admitted against the same water) and a late capacity change. See [Known limitations](#known-limitations).

## Research findings and limitations

Desk research from 2026-10-21 is in [docs/research/initial-research.md](docs/research/initial-research.md). Each claim there is labelled verified, inferred, anecdotal or unknown.

- Verified: capacity-limited slot booking already exists (Cult.fit, Playo, Hudle and pool-specific tools). Cult.fit's support pages describe swimming at affiliated centres and walk-in check-in at its gyms.
- Inferred: a mismatch between an app's quota and the front desk is plausible at partner pools. It isn't proven.
- Unknown: what caused my incident, how pools track occupancy, and how often booked swimmers are turned away.

I decided not to run interviews or surveys, so SwimSync rests on one personal incident plus desk research and engineering reasoning. No real platform is scraped or integrated, and every facility and session is fictional.

## Target users

- Swimmers need a confirmation they can trust, a clear view of their bookings, a cancel that works, and notice of changes before they travel.
- Operators need sessions that never go over capacity. In the MVP they're represented by a seed script; an operator interface and login come later.

## MVP scope

Built:

- List sessions with the places left, shown as a water-level meter with an "as of" time
- Book a place: atomic reservation, safe retries, honest answers when the outcome isn't known
- Cancel: releases the place exactly once
- "My bookings", with each confirmed booking shown as a swim pass with a QR code
- In-app notifications fed by an outbox, with a worker that retries and survives database outages
- A seed script that creates fictional sessions

Deferred: a waitlist, operator capacity changes and closures, an audit log, an operator UI with authentication, and booking history. I left the waitlist out because it doesn't help with the incident.

Out: payments, real SMS or email, multiple facilities, mobile apps.

## Architecture

All the diagrams, from the request path to the AWS design, are in [docs/architecture.md](docs/architecture.md). The local system:

```
          browser (React + Tailwind, frontend/)
                              │  /api/* through the Vite dev proxy
                              │  X-Swimmer-Id, Idempotency-Key
                              ▼
                    FastAPI app (backend/app)
                              │  one transaction per booking or cancel, explicit commit,
                              │  500 ms statement and lock timeouts
                              ▼
         PostgreSQL: sessions · bookings · idempotency_keys · outbox · notifications
                              ▲
                              │  FOR NO KEY UPDATE SKIP LOCKED
                    outbox worker (scripts/outbox_worker.py)
                              │  separate transaction
                              ▼
               simulated in-app adapter  →  notifications inbox
```

**Booking request path:** the API locks the session row (`SELECT ... FOR UPDATE`). It returns the stored answer if the idempotency key was seen before, and rejects the request if `booked = capacity`. Otherwise it inserts the booking, increments the counter, stores the response against the key and queues an outbox row, then commits explicitly. Every step happens in one transaction, so it all commits or none of it does. If the database fails before the commit, the answer is `503 database_unavailable` with `booked: false`; if the connection breaks during the commit, the answer is `503 outcome_unknown`.

**The frontend's rule:** a booking is shown as confirmed only after the server says so. On an uncertain answer, the app retries with the same key after 1, 2 and 4 seconds, then checks "My bookings", and keeps the key so a later "Check again" can't book twice. That logic is in [frontend/src/bookingFlow.ts](frontend/src/bookingFlow.ts), separate from the screens.

For the drills, two app instances run behind HAProxy (drill A), and Toxiproxy sits between the app and PostgreSQL (drill B). Nothing runs on AWS.

## Data model and consistency guarantees

Schema: [db/schema.sql](db/schema.sql).

| Guarantee | How it's enforced |
|---|---|
| Confirmed bookings never exceed capacity | Session row lock around check and insert; `CHECK (booked >= 0 AND booked <= capacity)` as a database backstop |
| The counter matches the rows | `booked` changes only in the same transaction as the booking row; every test ends by checking this |
| A cancel releases the place once | The counter goes down only if the booking was still `confirmed`, under the same session lock; a repeat cancel returns success without changing anything |
| A retry doesn't book twice | `idempotency_keys` stores the first response for each (swimmer, key); reusing a key for a different session returns 422 |
| A double tap with two keys books once | Partial unique index: one `confirmed` booking per swimmer per session |
| A notification exists if and only if the change committed | The outbox row is written in the booking transaction |
| A redelivery doesn't duplicate an inbox entry | `notifications.outbox_id` is `UNIQUE` |
| A failed notification never changes a booking | The worker runs separately; after 5 failed attempts the outbox row is marked `failed` and the booking stays as it is |
| The worker survives a database outage | Database errors are caught and retried with their own backoff, without using up a notification's attempts |
| A swimmer is never told a wrong yes or no | Explicit commit separates "rolled back" (`503 database_unavailable`, `booked: false`) from "may have saved" (`503 outcome_unknown`) |

The `bookings` table is the record of status. The inbox only carries messages about it.

## Security model

MVP controls:

- PostgreSQL listens on localhost only.
- Inputs are validated server side: the swimmer id matches `^[A-Za-z0-9_-]{1,64}$` and the idempotency key must be a UUID.
- Only the owner can cancel a booking.
- Database calls time out (500 ms per statement and lock wait, 2 s to connect), so a slow database can't tie up every worker thread.
- Synthetic data only; `.env`, keys and Terraform state are ignored by Git.

It isn't production-ready. The `X-Swimmer-Id` header, and the "You are" picker in the frontend, are a demo shortcut, not authentication. Anyone can claim any id. A real deployment would need an identity provider, HTTPS, rate limiting, backups and a secrets manager. The AWS design covers some of this (private subnets, no SSH, a managed database password); see [Infrastructure design](#infrastructure-design).

## Local setup

Tested on macOS with Homebrew, PostgreSQL 18, Python 3.14 and Node 26. Run every command from the project folder (`cd ~/projects/swimsync` first).

```bash
brew install postgresql@18
LC_ALL=en_US.UTF-8 /opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /opt/homebrew/var/log/postgresql@18.log start
createdb swimsync
createdb swimsync_test

python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install

.venv/bin/python scripts/seed.py
.venv/bin/uvicorn --app-dir backend app.main:app --port 8001
```

PostgreSQL stops when the Mac restarts; run the `pg_ctl ... start` line again. `scripts/seed.py` drops and recreates every SwimSync table, then adds three fictional sessions for tomorrow. Set `DATABASE_URL` to point it somewhere other than `postgresql:///swimsync`.

In a second terminal, start the frontend and open http://localhost:5173:

```bash
npm --prefix frontend run dev
```

In a third terminal, start the outbox worker:

```bash
.venv/bin/python scripts/outbox_worker.py
```

Or try the API directly:

```bash
curl -s localhost:8001/sessions
curl -s -X POST localhost:8001/sessions/1/bookings -H "X-Swimmer-Id: asha" -H "Idempotency-Key: $(uuidgen)"
curl -s localhost:8001/me/bookings -H "X-Swimmer-Id: asha"
curl -s -X POST localhost:8001/bookings/1/cancel -H "X-Swimmer-Id: asha"
curl -s localhost:8001/me/notifications -H "X-Swimmer-Id: asha"
```

To simulate a notification outage, start the worker with `SWIMSYNC_ADAPTER_FAILING=1`. To point the frontend at HAProxy during a drill, start it with `SWIMSYNC_API=http://127.0.0.1:8080`.

## Tests

```bash
.venv/bin/pytest -q
npm --prefix frontend test
```

The backend tests use the `swimsync_test` database (override with `TEST_DATABASE_URL`). Result on 2026-10-27: 34 backend tests and 15 frontend tests passed.

| File | What it proves |
|---|---|
| [tests/test_booking.py](tests/test_booking.py) | 20 swimmers racing for 1 place and 30 for 5 never oversell. Retries with the same key book once, including 10 at the same moment. A double tap with two keys books once. Ten simultaneous cancels release the place once. The database rejects a counter above capacity. |
| [tests/test_outbox.py](tests/test_outbox.py) | A rolled-back booking leaves no notification. The worker delivers, backs off and gives up after 5 attempts, then resumes when the adapter recovers. A crash after delivery doesn't duplicate an inbox entry, 4 workers deliver each notification once, and the worker survives a database outage. |
| [tests/test_db_failures.py](tests/test_db_failures.py) | Database down gives a fast 503 with `booked: false` and books nothing. A held lock times out in under 1.5 s. A commit that saved but lost its reply gives `outcome_unknown`, and the retry returns the stored booking; a commit that didn't save gives `outcome_unknown`, and the retry books fresh. |
| [tests/test_api.py](tests/test_api.py) | HTTP behaviour: 201 then 200 on a retry, required headers, the status list, and a cancel that's safe to retry. |
| [frontend/src/bookingFlow.test.ts](frontend/src/bookingFlow.test.ts) | The Book and Cancel buttons never show "booked" before the server confirms, retry with the same key, resume the same key after a page reload, treat "unavailable" after an uncertain answer as still uncertain, and let "My bookings" decide when retries run out. |

With the row lock removed, both race tests failed in 3 out of 3 runs: the `CHECK` constraint rejected the oversell.

## Fault drills and results

Drills run locally and are labelled as local experiments, not proof of how AWS would behave. Each write-up follows [drills/TEMPLATE.md](drills/TEMPLATE.md), and the raw logs and measurements of every run, including the ones that didn't go to plan, are in [drills/results/](drills/results/).

**Drill A, app instance failure** ([write-up](drills/01-instance-failure.md)). Two app instances behind HAProxy, 30 fictional swimmers booking and cancelling for 60 s, one instance killed with `kill -9` at 20 s and restarted at 40 s. Hard limits: zero duplicates, zero false successes, every counter matching its bookings.

| Run | Result |
|---|---|
| Kill at a random moment | Pass. 88 failed attempts, all HAProxy 503s within 1.93 s of the kill, all retried successfully. But no request was cut off mid-commit, so the riskiest case wasn't tested |
| A "victim" request held 2 s after its commit, then the instance killed | Pass. The booking was saved but its reply lost; the retry on the other instance got the stored answer, and there was exactly one booking |
| A victim request held 2 s before its commit, then the instance killed | Pass. The booking rolled back; the retry booked fresh, and there was exactly one booking |

Along the way: delaying every request by 100 ms inside the lock overloaded the system into a retry storm (the hard limits still held), and three runs at 20 ms were reported INCONCLUSIVE because the kill never landed mid-request. That's why the final runs aim the kill at one targeted request.

**Drill B, database connectivity** ([write-up](drills/02-database-connectivity.md)). Toxiproxy between the app and PostgreSQL: connections refused for 10 s, then 1 s of latency on every reply for 10 s, then a booking whose commit reaches PostgreSQL while the reply is swallowed. Hard limits: the three above, plus no false "not booked" and an outbox row for every committed change.

| Run | Result |
|---|---|
| First run | The hard limits and the lost-commit case passed: the swimmer got `outcome_unknown`, and the retry returned the saved booking. But the outbox worker crashed when the database went down and never came back, leaving 258 notifications undelivered. None were lost, because they were stored safely. The drill's checks passed while the system was clearly unhealthy, which is why the recorded measurements matter as much as the pass marks |
| After fixing the worker | Pass. Down phase: 1,084 fast `database_unavailable` answers and service back 0.02 s after the proxy returned. Slow phase: all 120 attempts timed out at 2 s, because `statement_timeout` limits the database's own work, not network delay. All 473 notifications delivered |

## Cost constraints and free-tier assumptions

The whole project has to cost ₹0. Credits and free trials don't count, because they run out and then bill.

| Dependency | Cost | Basis |
|---|---|---|
| PostgreSQL, FastAPI, Uvicorn, psycopg, pytest | ₹0 | Open-source |
| React, Vite, Tailwind, Vitest, qrcode | ₹0 | Open-source (MIT) |
| HAProxy, Toxiproxy (for the drills) | ₹0 | Open-source; Toxiproxy is MIT-licensed |
| Terraform CLI | ₹0 | BSL; HashiCorp's licence FAQ says personal use is unaffected (checked 2026-10-21). OpenTofu is the fallback |
| GitHub Free, private repo | ₹0 | Actions minutes are blocked, not billed, without a payment method (GitHub docs, checked 2026-10-21) |
| AWS | Not used | My account is on the Paid plan, which bills automatically once credits run out. The Terraform is validated locally and never applied |

Sources and the full audit are in [initial-research.md, section 12](docs/research/initial-research.md#12-cost-audit). AWS prices change, so recheck them on the AWS pricing pages before relying on them.

## Infrastructure design

The AWS version of SwimSync is written in [infra/terraform/](infra/terraform/) and drawn in [docs/architecture.md](docs/architecture.md), sections 14 to 16. It has been checked with `terraform fmt` and `terraform validate`, and never planned or applied.

- A `10.20.0.0/16` VPC in `ap-south-1` across two Availability Zones, with public, private app and private database subnets in each.
- Only the internet-facing ALB is in the public subnets. The app subnets have no internet route at all, and the database subnets only route inside the VPC.
- Two app instances, one per zone, with no public IP and IMDSv2 required. Losing one instance, or a whole zone, is drill A at cloud scale.
- Administration through Session Manager over VPC interface endpoints, instead of a NAT gateway, SSH or a bastion. There's no port 22 anywhere.
- Security groups that each allow only the tier in front: internet to ALB on 80, ALB to app on 8000, app to database on 5432.
- RDS PostgreSQL, private and encrypted, with a password RDS keeps in Secrets Manager; the instances may read that one secret and nothing else.
- A single-zone database by default (`db_multi_az = false`) for cost. That makes the database a known single point of failure; one variable changes it.

To check it locally (it needs no AWS credentials):

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform validate
```

`apply` needs a written cost check first, because the load balancer, instances, database and endpoints all bill by the hour.

## Teardown

Local only, so there's nothing in the cloud to remove.

```bash
dropdb swimsync
dropdb swimsync_test
dropdb swimsync_drill
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 stop
rm -rf .venv frontend/node_modules infra/terraform/.terraform
```

Stop the API, the frontend and the worker with Ctrl+C.

## Known limitations

- A separate desk inventory isn't handled. If walk-ins or members are admitted at the desk against the same pool, SwimSync's numbers can be correct while the pool is still full. Fixing that needs every admission to go through one system.
- Capacity changes aren't supported yet. An operator can't lower capacity or close a session, so nobody gets warned before travelling.
- There's no real authentication: `X-Swimmer-Id` is trusted as sent.
- Notifications are in-app only and simulated. There's no SMS, email or push.
- PostgreSQL is a single point of failure, and there are no backups. In the AWS design, the database stays single-zone unless `db_multi_az` is turned on.
- The AWS design has never been deployed, so it's validated as Terraform, not proven against AWS. The app also doesn't yet read its database password from Secrets Manager, as the design expects.
- The drills ran on one Mac. They show how the code behaves under failure, not how AWS would.
- The frontend's visual design is being redone, and the app is HTTP only.
- SwimSync can't show it would have prevented my incident, because that cause is unknown.

## Future improvements

- Apply the new visual design to the frontend, then add a behind-the-scenes panel showing which instance answered each request, and live notification toasts.
- Finish the drill write-ups and the project story.
- Operator capacity changes that flag affected bookings and notify swimmers, which covers the late-capacity-change cause.
- A waitlist that offers a freed place under the same locking rules.
- An audit log of capacity changes, closures and cancellations.
- Have the app read its database password from Secrets Manager, as the AWS design expects.
