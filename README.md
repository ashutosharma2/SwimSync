# SwimSync

A booking backend for swimming sessions that never confirms more places than a session has, releases a cancelled place exactly once, and tells swimmers about changes to their bookings.

The full story of the project, including every real error I hit, is in [docs/project-story.md](docs/project-story.md).

## Status

| Phase | | |
|---|---|---|
| 1. Problem framing | ✅ | Desk research, the causes SwimSync designs against, MVP scope |
| 2. Local core | ✅ | Schema, booking, cancel, idempotency keys, outbox and notifications, 28 tests |
| 3. Fault drills | ⏳ | Drill A (app instance failure) being built; drill B (database connectivity) planned |
| 4. MVP interface | | Swimmer views for sessions, bookings and the inbox |
| 5. Infrastructure design | | Terraform for a two-AZ AWS VPC, validated locally, not applied |
| 6. Portfolio | | Diagrams, demo, cost and teardown docs |

Architecture decision records will go in [docs/adr/](docs/adr/). None are written yet.

## Project summary

SwimSync is a FastAPI and PostgreSQL service for booking capacity-limited swimming sessions. A database row lock makes the capacity check and the booking one atomic step. Idempotency keys make retries safe, and notifications are written in the same transaction as the booking through an outbox. Concurrency tests show the guarantees hold when 20 to 30 requests arrive at once.

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

- List sessions with the places left
- Book a place: atomic reservation, safe retries
- Cancel: releases the place exactly once
- "My bookings" list showing each booking's current status
- In-app notifications fed by an outbox, with a worker that retries
- A seed script that creates fictional sessions

Deferred: a waitlist, operator capacity changes and closures, an audit log, an operator UI with authentication, and booking history. I left the waitlist out because it doesn't help with the incident.

Out: payments, real SMS or email, multiple facilities, mobile apps.

## Architecture

```
               swimmer (curl or tests for now; no frontend yet)
                              │  X-Swimmer-Id, Idempotency-Key
                              ▼
                    FastAPI app (backend/app)
                              │  one transaction per booking or cancel
                              ▼
         PostgreSQL: sessions · bookings · idempotency_keys · outbox · notifications
                              ▲
                              │  FOR NO KEY UPDATE SKIP LOCKED
                    outbox worker (scripts/outbox_worker.py)
                              │  separate transaction
                              ▼
               simulated in-app adapter  →  notifications inbox
```

**Booking request path:** the API locks the session row (`SELECT ... FOR UPDATE`). It returns the stored answer if the idempotency key was seen before, and rejects the request if `booked = capacity`. Otherwise it inserts the booking, increments the counter, stores the response against the key and queues an outbox row, then commits. Every step happens in one transaction, so it all commits or none of it does.

Designed but not built: two app instances behind HAProxy for drill A, Toxiproxy between the app and the database for drill B, and an AWS VPC design. Nothing runs on AWS.

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

The `bookings` table is the record of status. The inbox only carries messages about it.

## Security model

MVP controls:

- PostgreSQL listens on localhost only.
- Inputs are validated server side: the swimmer id matches `^[A-Za-z0-9_-]{1,64}$` and the idempotency key must be a UUID.
- Only the owner can cancel a booking.
- Synthetic data only; `.env`, keys and Terraform state are ignored by Git.

It isn't production-ready. The `X-Swimmer-Id` header is a demo shortcut, not authentication. Anyone can claim any id. A real deployment would need an identity provider, HTTPS, rate limiting, backups and a secrets manager.

## Local setup

Tested on macOS with Homebrew, PostgreSQL 18 and Python 3.14.

```bash
brew install postgresql@18
LC_ALL=en_US.UTF-8 /opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -l /opt/homebrew/var/log/postgresql@18.log start
createdb swimsync
createdb swimsync_test

python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

.venv/bin/python scripts/seed.py
.venv/bin/uvicorn --app-dir backend app.main:app --port 8001
```

`scripts/seed.py` drops and recreates every SwimSync table, then adds three fictional sessions for tomorrow. Set `DATABASE_URL` to point it somewhere other than `postgresql:///swimsync`.

In a second terminal, start the outbox worker:

```bash
.venv/bin/python scripts/outbox_worker.py
```

Try it:

```bash
curl -s localhost:8001/sessions
curl -s -X POST localhost:8001/sessions/1/bookings -H "X-Swimmer-Id: asha" -H "Idempotency-Key: $(uuidgen)"
curl -s localhost:8001/me/bookings -H "X-Swimmer-Id: asha"
curl -s -X POST localhost:8001/bookings/1/cancel -H "X-Swimmer-Id: asha"
curl -s localhost:8001/me/notifications -H "X-Swimmer-Id: asha"
```

To simulate a notification outage, start the worker with `SWIMSYNC_ADAPTER_FAILING=1`.

## Tests

```bash
.venv/bin/pytest -q
```

The tests use the `swimsync_test` database (override with `TEST_DATABASE_URL`). Result on 2026-10-22: 28 passed.

| File | What it proves |
|---|---|
| [tests/test_booking.py](tests/test_booking.py) | 20 swimmers racing for 1 place and 30 for 5 never oversell. Retries with the same key book once, including 10 at the same moment. A double tap with two keys books once. Ten simultaneous cancels release the place once. The database rejects a counter above capacity. |
| [tests/test_outbox.py](tests/test_outbox.py) | A rolled-back booking leaves no notification. The worker delivers, backs off and gives up after 5 attempts, then resumes when the adapter recovers. A crash after delivery doesn't duplicate an inbox entry, and 4 workers deliver each notification once. |
| [tests/test_api.py](tests/test_api.py) | HTTP behaviour: 201 then 200 on a retry, required headers, the status list, and a cancel that's safe to retry. |

With the row lock removed, both race tests failed in 3 out of 3 runs: the `CHECK` constraint rejected the oversell.

## Fault drills and results

Drills run locally and are labelled as local experiments, not proof of how AWS would behave. Each write-up follows [drills/TEMPLATE.md](drills/TEMPLATE.md).

| Drill | Setup | Status |
|---|---|---|
| A: app instance failure | Two app processes behind HAProxy, one killed during booking and cancelling load | Being built. Pass limits: zero duplicate bookings, zero false successes |
| B: database connectivity failure | Toxiproxy between the app and PostgreSQL | Planned |

No drill has been run yet, so there are no results to report.

## Cost constraints and free-tier assumptions

The whole project has to cost ₹0. Credits and free trials don't count, because they run out and then bill.

| Dependency | Cost | Basis |
|---|---|---|
| PostgreSQL, FastAPI, Uvicorn, psycopg, pytest | ₹0 | Open-source |
| HAProxy, Toxiproxy (for the drills) | ₹0 | Open-source; Toxiproxy is MIT-licensed |
| Terraform CLI | ₹0 | BSL; HashiCorp's licence FAQ says personal use is unaffected (checked 2026-10-21). OpenTofu is the fallback |
| GitHub Free, private repo | ₹0 | Actions minutes are blocked, not billed, without a payment method (GitHub docs, checked 2026-10-21) |
| AWS | Not used | My account is on the Paid plan, which bills automatically once credits run out |

Sources and the full audit are in [initial-research.md, section 12](docs/research/initial-research.md#12-cost-audit). AWS prices change, so recheck them on the AWS pricing pages before relying on them.

## Infrastructure design

Planned, not written yet. The proposal in [initial-research.md, section 11](docs/research/initial-research.md#11-custom-aws-vpc-design-designed-not-deployed) is a `10.20.0.0/16` VPC across two Availability Zones. It has public subnets for a load balancer, private subnets for the app and the database, security groups that each allow only the tier in front, and Session Manager instead of SSH. That design is still a proposal, and I haven't made the decisions in it yet.

The Terraform will be checked with `terraform fmt` and `terraform validate` only. `apply` needs a written cost check first, because the load balancer, EC2, RDS and NAT all bill by the hour.

## Teardown

Local only, so there's nothing in the cloud to remove.

```bash
dropdb swimsync
dropdb swimsync_test
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 stop
rm -rf .venv
```

Stop the API and the worker with Ctrl+C.

## Known limitations

- A separate desk inventory isn't handled. If walk-ins or members are admitted at the desk against the same pool, SwimSync's numbers can be correct while the pool is still full. Fixing that needs every admission to go through one system.
- Capacity changes aren't supported yet. An operator can't lower capacity or close a session, so nobody gets warned before travelling.
- There's no real authentication: `X-Swimmer-Id` is trusted as sent.
- Notifications are in-app only and simulated. There's no SMS, email or push.
- PostgreSQL is a single point of failure, and there are no backups.
- There's no frontend yet.
- SwimSync can't show it would have prevented my incident, because that cause is unknown.

## Future improvements

- Run drills A and B and write up the measurements, because they're the strongest evidence that the guarantees hold under failure.
- Operator capacity changes that flag affected bookings and notify swimmers, which covers the late-capacity-change cause.
- A waitlist that offers a freed place under the same locking rules.
- An audit log of capacity changes, closures and cancellations.
- A small swimmer frontend.
- Terraform for the VPC design, validated but not applied.
