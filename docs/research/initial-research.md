# SwimSync: research, validation plan and proposed design

Status: research and proposals, 2026-10-21. Nothing here has been built, tested or validated with users. Every design section is a proposal for you to accept, change or reject. Sources were read on 2026-10-21; most support pages carry no date.

Labels used in the evidence tables: **Verified** (stated in the cited source), **Inferred** (my reasoning from verified facts), **Anecdotal** (one person's account), **Unknown** (no evidence found).

---

## 1. Executive verdict

**As a cloud engineering portfolio project: yes, worth pursuing.** The core engineering problem, never confirming more bookings than capacity under concurrent requests, retries and partial failures, is real, well defined and provable with tests. That holds whatever the market research finds.

**As a product: not yet established.** The evidence so far does not show an unmet need:

- Your incident is one event with an unknown cause.
- Cult.fit already publishes a waitlist that confirms the next member automatically when someone cancels (for its classes; unknown for swimming).
- Capacity-limited slot booking is an existing product category (Playo, Hudle and several pool-specific tools).

**The most important finding challenges the brief's own priority.** Your incident may not be a database problem at all. If the pool admits walk-ins or its own members at the desk while an app holds a separate quota, the app's database can be perfectly correct and you still get turned away. A correct booking database is necessary but not sufficient. The thing that may actually fail is keeping one source of truth for capacity between the app and the front desk. That should shape the MVP.

**Recommendation:** spend the first one to two weeks on discovery (section 6) before writing substantial code. You can study the concurrency design in parallel, because it's valuable whichever way the discovery goes.

## 2. Personal incident analysis

**What it establishes:** on one occasion, a booking you believed was valid was not honoured when you arrived, and the stated reason was that the pool was at capacity. That cost you travel time.

**What it does not establish:**

| Not established | Why it matters |
|---|---|
| The cause | Six plausible causes lead to different fixes (section 3) |
| Whether the booking was confirmed, pending or a waitlist entry | Only a confirmed booking proves an integrity failure |
| Which system held the capacity | An aggregator app, the pool's own system, or a desk register |
| Whether walk-ins or members shared the same capacity | Points to a two-inventory problem rather than a concurrency bug |
| How often it happens, to anyone | One incident can't show a recurring problem |

**Evidence to collect from your own records now, before memory fades:**

1. The booking confirmation (screenshot, email, SMS, in-app history). Did it say "confirmed"?
2. The platform and the facility (kept private in the repo if you prefer).
3. When you booked, relative to the session start.
4. What staff said, as close to their words as you can recall: "full", "app quota used up", "members only today", "lanes closed"?
5. Whether you were offered a refund, a credit or another slot.
6. Whether other people with bookings were also turned away.

## 3. Problem diagnosis

| Plausible cause | Mechanism | How to tell it apart |
|---|---|---|
| Concurrency oversell | Two requests read "1 place left" and both confirm | The booking system itself shows confirmed bookings > capacity |
| Two inventories | The app sells N places; the desk admits walk-ins or members against the same water | App records are within its quota, yet the pool is full; staff mention walk-ins or members |
| Capacity changed late | Lifeguard shortage, lane closure, lessons or a gala reduce capacity after bookings | Staff mention closures or reduced lanes; the operator changed capacity that day |
| Stale display | The app shows cached availability | Usually causes failed bookings, not false confirmations, if the server checks capacity at booking time |
| Unreliable reservation | Booking marked confirmed before capacity was reserved, or a retry duplicated it | Duplicate or excess confirmations in the system's records |
| Manual or operational error | The desk didn't see the app's list, or a staff miscount | Bookings exist but weren't communicated to the desk |

Only the operator's records can distinguish these. Your interviews with operators (section 6) are the way to learn which causes are common.

**Coherence of the three problem areas:** A (integrity) and C (closures and capacity changes) are one product. Both are about keeping the booking promise in line with real capacity, and C is the operational half of A. B (waitlist recovery) is a separate feature. It fills a place after a cancellation but does nothing for your incident, and Cult already offers a version of it for classes.

**Narrowest problem worth solving:** a confirmed booking must always mean the facility can actually take you. When that stops being true because capacity changed, the swimmer is told before they travel.

## 4. Research and evidence

| # | Claim | Source | Date | Status | Effect on the product |
|---|---|---|---|---|---|
| 1 | Cult classes can be cancelled up to 60 minutes before start; not cancelling in time can be a no-show | [cure.fit support: cancel/reschedule](https://support.cure.fit/support/solutions/articles/25000017573-can-i-cancel-reschedule-a-booked-cult-class-) | Undated | Verified (classes) | Cancellation rules exist at the main competitor |
| 2 | Cult's waitlist opens when a class is full; on a cancellation the next waitlisted member gets a confirmed booking; final check about 60 minutes before class; SMS and push notifications | [cure.fit support: waitlist](https://support.cure.fit/support/solutions/articles/25000019464-what-is-the-waitlist-feature-how-does-it-work-) | Undated | Verified (classes); Unknown for swimming | Cancellation recovery is not an obvious gap; deprioritise B |
| 3 | Cult customers get 5 swimming access sessions at Cult-affiliated centres in their city, booked through the Cult app | [cure.fit support: swimming access](https://support.cure.fit/support/solutions/articles/25000034087-where-can-customers-use-the-swimming-access-) | Undated | Verified | Pools are third-party affiliates, so a two-inventory setup is plausible (Inferred) |
| 4 | For cultpass gyms, booking a slot is optional; members can walk in and check in | [cure.fit support: gym slots](https://support.cure.fit/support/solutions/articles/25000024634-do-i-need-to-schedule-my-visit-to-cultpass-gyms-) | Undated | Verified (gyms, not pools) | Shows a model where bookings and walk-ins share capacity; Unknown for pools |
| 5 | Cult's "Booking cult classes" help folder (page 1) has no article on swimming, centre-side cancellations or capacity changes | [cure.fit support folder](https://support.cure.fit/support/solutions/folders/25000030966) | Read 2026-10-21 | Verified (absence on page 1 only) | Absence in an FAQ doesn't prove absence of a feature |
| 6 | Playo lists swimming venues by city and has a venue-partner app with a scheduler and booking confirmations | [playo.co](https://playo.co/), [Playo app listing](https://apps.apple.com/app/id1018786950), [Venue Partner app](https://apps.apple.com/us/app/-/id1057092085) | Read 2026-10-21 | Verified (features listed); capacity handling Unknown | Slot booking for pools exists in India |
| 7 | Hudle's partner app offers slot and booking management, rescheduling and cancellations, and customer notifications | [Hudle Partner app](https://apps.apple.com/us/app/-/id1569130632), [hudle.in venues](https://hudle.in/list-your-sports-venue) | Read 2026-10-21 | Verified (marketing); pool-specific Unknown | Operator-side tools exist |
| 8 | Pool-specific booking software sells time-slot tickets with capacity controls | [anny](https://anny.co/en/solutions/swimming-pool-booking-system), [booked.it](https://booked.it/industries/swimming-pools/) | Read 2026-10-21 | Verified (marketing) | "Capacity-limited slots" alone is not a differentiator |
| 9 | How independent Indian pools track occupancy (app, register, WhatsApp, phone) | None found | n/a | Unknown | Must come from operator interviews |
| 10 | How often booked swimmers are turned away | None found | n/a | Unknown | Must come from swimmer interviews; don't claim it's common |
| 11 | Public APIs for Cult, Playo or Hudle | None found | n/a | Unknown; assume none | No integration in scope |

## 5. Competitor analysis

| Product | What's documented | Gaps you could test (hypotheses, not findings) |
|---|---|---|
| Cult.fit / Cult Play | Class booking, a 60-minute cancellation window, an auto-confirming waitlist, swimming access at affiliated centres | How affiliated pools reconcile Cult bookings with walk-ins and members; how centre-side closures reach swimmers |
| Playo | Venue discovery and booking, including swimming; partner scheduler | Whether pool capacity is per slot or per lane; how cancellations by the venue are communicated |
| Hudle | Venue management: slots, cancellations, notifications, payments | Pool-specific workflows |
| Pool software abroad (anny, booked.it and others) | Time-slot capacity, lanes, payments | Not India-focused; desk/app reconciliation unclear |

**Honest conclusion:** SwimSync as "a booking app with capacity and a waitlist" would duplicate existing products. The only gap with any support so far is the **app-versus-desk capacity mismatch at partner pools, and disruption notice before travel**. Even that is inferred from one incident and two support articles. It needs operator evidence.

## 6. Problem-validation plan

**Sample:** 5 to 10 swimmers who booked a pool slot through any app in the last 6 months, plus 2 to 3 people who run or staff a pool desk (a college pool, a club, a society or an affiliated centre). This is exploratory discovery, not statistical proof. It tells you whether the problem exists and what shape it takes, not how common it is.

### Swimmer interview (15 minutes)

1. How do you usually get into a pool session? Walk-in, app, membership, phone?
2. Tell me about the last time you booked a swim. Which app, how far ahead?
3. Has a booked session ever not gone as expected? What happened, step by step?
4. When you arrived, what did staff say? Did you see your booking on their side?
5. Have you seen the pool much more crowded than the booking suggested?
6. Has a session been cancelled or changed on you? How and when did you find out?
7. Before you travel, do you check anything? Call the pool, check the app again?
8. Have you cancelled a booking? Did anyone else get the place, as far as you know?
9. What did the problem cost you: time, money, a missed swim?
10. What do you do now to avoid it?

Avoid asking "would you use an app that...". Ask about what already happened.

### Operator interview (20 minutes)

1. How do people get into a session here: walk-in, members, which apps?
2. Who decides the capacity for a session, and where is it written down?
3. When an app booking arrives, how does the desk see it?
4. Do walk-ins, members and app bookings share the same capacity? How is that tracked?
5. Tell me about the last time more people turned up than you could take. What happened?
6. When capacity drops (lifeguard absent, lanes for lessons, maintenance), how do you update the apps and tell booked swimmers?
7. How often does that happen in a month?
8. How do cancellations and no-shows work today? Does anyone fill freed places?
9. What workarounds do you use (WhatsApp groups, calling, paper lists)? How long do they take?
10. If you could change one thing about bookings, what would it be? Does it have to live inside the app you already use?

### Evidence-tracking template

| ID | Date | Role | Platform | Incident (their words) | Category | Cost to them | Current workaround | Quote (with consent) | Confidence |
|---|---|---|---|---|---|---|---|---|---|

**Categories:** OVERSELL, TWO-INVENTORY, LATE-CAPACITY-CHANGE, CLOSURE-NOT-COMMUNICATED, CANCELLATION-NOT-REFILLED, NO-SHOW, OTHER.

Group the incidents by category after all the interviews. Look for categories mentioned independently by at least two people.

### Proceed, pivot or stop (set these before interviewing)

- **Proceed with integrity plus capacity-change notices:** at least 3 swimmers describe a concrete turned-away or capacity-change incident, or at least 1 operator describes reconciling app bookings with the desk by hand.
- **Pivot to cancellation recovery:** incidents are mostly unfilled cancellations or no-shows, not over-capacity.
- **Pivot to a generic engineering demo:** few real incidents. You build the same system and present it honestly as a capacity-integrity reference design, not a validated product.
- **Stop the product framing:** nobody reports the problem and operators say their current setup works.

These thresholds are judgement calls for a small exploratory sample, not statistical tests.

## 7. Recommended MVP (proposal)

**In:**

1. An operator creates sessions with a capacity.
2. A swimmer books. Capacity is reserved atomically, and repeat requests are idempotent.
3. A swimmer cancels. The place is released exactly once.
4. The operator reduces capacity or closes a session. Affected bookings are flagged and their status changes visibly.
5. An in-app notification inbox fed by an outbox table, with a simulated adapter that can be told to fail.
6. An audit log of capacity changes, closures and cancellations.
7. Concurrency and failure tests that prove the invariants.

**Deferred:** the waitlist and time-limited offers (strong v1.1 candidate, and a good concurrency test). Also deferred: payments, mobile apps, multiple facilities, real SMS or email, analytics, integrations.

**Your decision:** whether the waitlist is in the MVP. It adds invariant 7 and test 4, which are good interview material, but it doesn't address your incident.

A working demo here means it runs locally with simulated data and tests pass. It is not a production service: there's no real authentication provider, no backups, no HTTPS deployment and no real users.

## 8. User journeys and state machines (proposal)

**Session:** `OPEN → CLOSED_FOR_BOOKING → COMPLETED`, and `OPEN or CLOSED_FOR_BOOKING → CANCELLED`.
Rejected transitions: anything out of `COMPLETED` or `CANCELLED`, and booking into a session that isn't `OPEN`.

**Booking:** `CONFIRMED → CANCELLED_BY_SWIMMER`, `CONFIRMED → AT_RISK` (after a capacity reduction), `AT_RISK → CONFIRMED` (the operator restores capacity), `AT_RISK or CONFIRMED → CANCELLED_BY_OPERATOR`.
There is no `PENDING` state: a request either reserves capacity in one transaction and becomes `CONFIRMED`, or it is rejected. That removes a whole class of "is it confirmed?" confusion (invariants 2, 3 and 13).
Rejected transitions: cancelling an already-cancelled booking (it returns the earlier result, with no second release), and anything moving back to `CONFIRMED` from a cancelled state.

**Waitlist offer (if included):** `OFFERED → ACCEPTED | DECLINED | EXPIRED`.
Rejected transitions: accepting an `EXPIRED` or `DECLINED` offer, and accepting twice.

**Your decision:** when capacity drops below the number confirmed, which bookings become `AT_RISK`? The most recently booked, an operator choice, or all of them? This is a policy question with fairness consequences, and it's yours to reason through.

## 9. Database and concurrency design (proposal)

**Tables:**

- `sessions(id, starts_at, capacity, confirmed_count, status, updated_at)`
- `bookings(id, session_id, swimmer_id, status, created_at, updated_at)`
- `idempotency_keys(key PRIMARY KEY, swimmer_id, request_hash, response_json, created_at)`
- `audit_log(id, actor, action, session_id, booking_id, before_json, after_json, at)`
- `outbox(id, swimmer_id, kind, payload_json, status, attempts, created_at, delivered_at)`

Optional: `waitlist_entries` and `offers`.

**Constraints:**

- A unique partial index on `bookings(session_id, swimmer_id) WHERE status IN ('CONFIRMED','AT_RISK')` stops one swimmer holding two places in the same session.
- `CHECK (confirmed_count >= 0)`.

**Booking, the critical operation.** One transaction:

```sql
-- 1. Idempotency: if this key already exists, return its stored response and stop.
INSERT INTO idempotency_keys (key, swimmer_id, request_hash) VALUES ($key, $swimmer, $hash)
  ON CONFLICT (key) DO NOTHING;   -- if 0 rows inserted, read and return the stored response

-- 2. Reserve a place only if one exists. Conditional update in one statement.
UPDATE sessions SET confirmed_count = confirmed_count + 1, updated_at = now()
 WHERE id = $session AND status = 'OPEN' AND confirmed_count < capacity
 RETURNING id;                    -- 0 rows means full or not open: reject

-- 3. Record the booking, the audit row and the notification in the same transaction.
INSERT INTO bookings ... ; INSERT INTO audit_log ... ; INSERT INTO outbox ... ;
UPDATE idempotency_keys SET response_json = $response WHERE key = $key;
COMMIT;
```

**Why the conditional update is enough:** under PostgreSQL's default Read Committed level, a second transaction updating the same session row waits for the first to commit. It then re-checks its `WHERE` clause against the new row, so the last place can only be taken once. Read the "Read Committed" section of the [transaction isolation docs](https://www.postgresql.org/docs/current/transaction-iso.html) and the [row-level locks docs](https://www.postgresql.org/docs/current/explicit-locking.html) (PostgreSQL 18 is current) so you can explain this yourself.

**Alternatives to discuss:**

- `SELECT ... FOR UPDATE` followed by a separate update (pessimistic, more statements).
- A version column with optimistic retries.

**Cancellation exactly once:**
`UPDATE bookings SET status='CANCELLED_BY_SWIMMER' WHERE id=$id AND status IN ('CONFIRMED','AT_RISK') RETURNING session_id`. Decrement `confirmed_count` only if a row came back, in the same transaction.

**Ambiguous outcome (committed, but the client timed out):** the client retries with the same idempotency key and gets the stored result. It never sees a second booking, and never a false "failed" once the booking has committed (invariant 12).

**Notifications:** written to `outbox` in the same transaction. A separate worker delivers them through the simulated adapter. A delivery failure only changes the outbox row's `status` and `attempts`, never the booking (invariants 9 and 10). This is the outbox pattern, justified here because "booking saved but notice lost" and "notice sent but booking rolled back" are both possible without it.

**Capacity reduction:** one transaction sets `capacity`. If `confirmed_count > capacity`, it marks bookings `AT_RISK` per your policy, writes audit rows and queues outbox notices (invariant 11). Note that `confirmed_count <= capacity` can't be a `CHECK` constraint, because an operator can legitimately cut capacity below the number already confirmed. The guarantee is enforced on new bookings instead.

**Tests:**

| # | Test | Invariant | Evidence it passed |
|---|---|---|---|
| 1 | 20 concurrent requests for 1 remaining place | Never more confirmed than capacity | Exactly 1 confirmed; `confirmed_count = capacity`; query output saved |
| 2 | Same request twice, same key | No duplicate bookings | 1 booking row; both responses identical |
| 3 | Cancel, simulated timeout, retry | Release exactly once | `confirmed_count` decreased by 1 only |
| 4 | Two workers accept the same offer | One acceptance | 1 accepted offer, 1 booking |
| 5 | Adapter fails after commit | Notification can't corrupt state | Booking `CONFIRMED`; outbox `FAILED` then `DELIVERED` on retry |
| 6 | DB timeout mid-booking (Toxiproxy) | No false success | Client sees an error or the stored result; DB has 0 or 1 booking, never 2 |
| 7 | Capacity cut below the confirmed count | Handled and audited | `AT_RISK` bookings match your policy; audit rows present |

Run the consistency query after every test: confirmed bookings per session compared with `confirmed_count`.

## 10. Zero-cost architecture

Everything required runs on your Mac:

| Piece | Choice | Cost basis |
|---|---|---|
| Database | PostgreSQL, native (Homebrew) or in Docker | Open source |
| Backend | FastAPI, two processes on different ports | Open source |
| Load balancer for drill A | HAProxy (open source), which has active health checks | Open source. I believe active health checks are a paid NGINX Plus feature rather than open-source nginx; verify before choosing nginx. |
| Fault injection for drill B | [Toxiproxy](https://github.com/Shopify/toxiproxy) between app and DB: latency, timeout, reset, down | MIT licence |
| Frontend | React with Tailwind, via Vite | Open source |
| Containers (optional) | [Docker Desktop](https://docs.docker.com/subscription/desktop-license/) | Free for personal use, education and businesses under 250 employees and under $10M revenue |
| Linux environment (optional) | Your existing Multipass VM | Already installed |

This gives you all five pieces the brief lists: the app, the DB plus concurrency tests, redundancy and faults, Terraform for the VPC design, and an optional deploy.

## 11. Custom AWS VPC design (designed, not deployed)

**CIDR:** `10.20.0.0/16`, across two Availability Zones (AZ a and AZ b).

| Subnet | AZ a | AZ b | Route table |
|---|---|---|---|
| Public (ALB) | 10.20.0.0/24 | 10.20.1.0/24 | 0.0.0.0/0 to the Internet Gateway |
| Private app | 10.20.10.0/24 | 10.20.11.0/24 | Local only, plus your egress choice |
| Private DB | 10.20.20.0/24 | 10.20.21.0/24 | Local only |

**Security groups (each one references the previous):**

- `alb-sg` allows 443/80 from the internet.
- `app-sg` allows the app port from `alb-sg` only.
- `db-sg` allows 5432 from `app-sg` only.

No SSH ports anywhere.

**IAM:** the instance role gets `AmazonSSMManagedInstanceCore` and nothing else. You'd use a separate deploy role, scoped to the resources Terraform manages.

**Private egress options** (the costs are why this design stays undeployed):

| Option | Cost | Note |
|---|---|---|
| NAT gateway | $0.045/hour plus $0.045/GB ([VPC pricing](https://aws.amazon.com/vpc/pricing/), US East example) | Not ₹0 |
| NAT instance | An EC2 instance plus a public IPv4 at $0.005/hour | Not ₹0 beyond credits |
| No egress, with interface endpoints for SSM | $0.01/hour per endpoint per AZ ([PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)) | Session Manager needs `ssm` and `ssmmessages` (and `ec2messages` for older agents), plus S3 access ([SSM docs](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html)). Not ₹0 |

**Per component:**

| Component | Purpose | Availability role | Cost risk | ₹0? |
|---|---|---|---|---|
| VPC, subnets, route tables, IGW, SGs | Network and boundaries | None by itself | VPC itself has no charge ([VPC FAQ](https://aws.amazon.com/vpc/faqs/)); the others are inferred free | Yes, but empty |
| ALB | Spreads traffic, health checks | Survives one instance or AZ failing | $0.0225/hour plus LCUs ([ELB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)) | No (credits only) |
| 2 × EC2 | App servers | Needs at least 2 across AZs | Hourly plus EBS | No (credits only) |
| RDS PostgreSQL | DB | Single-AZ is a single point of failure; Multi-AZ costs more | Free plan only on db.t3/t4g.micro, up to 6 months ([RDS free](https://aws.amazon.com/rds/free/)) | No on the Paid plan |
| Session Manager | Admin without SSH | n/a | No charge on EC2 ([SSM pricing](https://aws.amazon.com/systems-manager/pricing/)), but needs endpoints or NAT | No (the dependencies cost) |
| CloudWatch | Logs, metrics, alarms | n/a | Free tier: 5 GB logs, 10 metrics, 10 alarms ([pricing](https://aws.amazon.com/cloudwatch/pricing/)); the page doesn't say it's permanent | Probably, at small scale |

A VPC does not make anything highly available. Availability comes from two or more app instances in different AZs behind a load balancer, plus a database that survives losing an AZ. Even then, the Region, your deploy process and your own code remain failure domains.

**Terraform without spending:** write the configuration and run `terraform init`, `terraform fmt` and `terraform validate` locally (validate needs no AWS credentials). `terraform plan` makes read-only API calls with your credentials; you'd run it yourself, and the API calls aren't billed. Don't run `apply` by default. Terraform is under the BSL; HashiCorp's [licence FAQ](https://www.hashicorp.com/license-faq) says internal and personal use is unaffected. OpenTofu (MPL) is the open-source alternative.

## 12. Cost audit

**Your account, from what you told me:** it is on the AWS Paid plan. The AWS FAQ says "You will be automatically charge[d] for any usage beyond the credit balance," and its credit-expiry wording is inconsistent (6 or 12 months). Check the real expiry in your Billing console.

Credits are a temporary allowance, so under your own rule they don't count as ₹0. The FAQ also mentions a monthly spend limit starting at $20 that pauses resources; verify whether your account has it.

| Dependency | Cost | Condition or risk | Verdict |
|---|---|---|---|
| PostgreSQL, FastAPI, React, Tailwind, HAProxy, Toxiproxy | ₹0 | Open-source licences (Toxiproxy's MIT licence verified; check the others' licence files) | Safe |
| Docker Desktop | ₹0 | Personal or education use | Safe; Homebrew-native alternative exists |
| Terraform CLI | ₹0 | BSL personal use | Safe; OpenTofu as a fallback |
| GitHub Free | ₹0 | Actions are free on public repos; private repos get 2,000 minutes, and usage is blocked (not billed) without a payment method ([docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) | Safe if no payment method, or if the repo is public |
| AWS VPC, subnets, SGs, IGW | ₹0 | Nothing runs in them | Safe to create, but useless alone |
| AWS ALB, EC2, RDS, NAT, public IPv4, interface endpoints | Hourly | Draws down credits, then bills | **Unsafe**: design only |
| CloudWatch | Free tier | Only with resources sending data | Not needed locally |
| AWS Budgets | Monitoring free; first 2 action-enabled budgets free ([pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)) | Alerts are delayed, not a hard cap | Use as a safety net only |
| Domain, TLS, SMS, email | Paid | Not needed | Excluded |

**Total for the required project: ₹0.** The optional AWS deployment stays off until you verify every resource against your own account.

**Safety checklist before any `terraform apply`:**

1. Check the plan and credits in the Billing console.
2. Read `terraform plan` line by line for any ALB, NAT, EC2, RDS, EIP or endpoint.
3. Have a budget alert at ₹0 or $1, knowing it's delayed.
4. Run apply and destroy in the same sitting.
5. After destroying, check for EBS volumes, snapshots, Elastic IPs, RDS snapshots, log groups and ENIs.

Closing the browser deletes nothing.

## 13. Fault drill A: application instance failure (local)

**Setup:**

- 2 FastAPI processes (`:8001`, `:8002`) behind HAProxy (`:8080`), with health checks against `/health` every 1 second, marked down after 2 failures.
- One shared PostgreSQL.
- A load generator script: a booking request every 100 ms with unique idempotency keys, each logged with timestamp, instance id, status and latency.

**Success criteria (write them before running):**

- Zero duplicate bookings, and `confirmed_count` matches the count of confirmed bookings.
- Errors stop within N seconds of the kill, where you choose N from the health-check settings.
- Every client-visible success corresponds to exactly one committed booking.

**Procedure:**

1. Record the baseline for 60 seconds.
2. Run `kill -9` on instance 1, noting the time.
3. Watch HAProxy's state change.
4. Keep the load running for 60 seconds, retrying failures with the same key.
5. Restart instance 1 and confirm it rejoins.
6. Run the consistency queries.

**Measurements:**

- Detection time (kill to HAProxy marking the instance down).
- Error count and rate.
- Time to recovery.
- p50 and p95 latency.
- Retries.
- Duplicates (expected 0).
- Consistency query results before and after.

**Report:** use your drill template (predicted symptom, evidence, root cause, fix, prevention), plus a measurements table and the raw log files. Label it as a local experiment, not proof of AWS high availability.

## 14. Fault drill B: database connectivity failure (local)

**Setup:** the app connects to PostgreSQL through Toxiproxy. Set DB statement and connect timeouts, such as 2 seconds.

**Cases:**

- `down` during a booking.
- A `timeout` toxic during a cancellation.
- `latency` larger than the client timeout during offer acceptance, which produces the ambiguous-commit case.
- Restore, then retry with the same keys.

**Success criteria:**

- Zero false successes.
- Zero duplicates.
- Every operation either committed exactly once or not at all.
- Outbox rows match committed state after reconciliation.

**Safe stop condition:** if the consistency check fails, stop. Keep the DB state for analysis; don't rerun over it.

**Ambiguous commit:** the server committed but the client timed out. The client must show "status unknown, checking" and retry with the same key, which returns the stored result. The test asserts exactly one booking and that the final client message matches the DB.

**Measurements:**

- Error rate.
- Latency.
- Failed or delayed operations.
- Time to resume.
- Duplicates.
- False successes.
- Outbox discrepancies.

**Report:** same template as drill A.

## 15. Security and observability

**MVP controls:**

- The DB listens on localhost or a private network only.
- Server-side validation of every input.
- Operator endpoints need an operator role. A simple local token is enough for a demo; real authentication is a production item.
- Audit log for capacity, closure and cancellation actions.
- Synthetic data only.
- `.env` files kept out of Git, with a `.env.example` checked in instead.
- No Terraform state in Git.

**Production only:** HTTPS, a real identity provider, rate limiting, backups, a secrets manager, dependency scanning.

**Observability:**

- Structured JSON logs carrying a request id, an idempotency key and the outcome.
- A `/metrics` text endpoint or log-derived counters: bookings confirmed and rejected (full), duplicates detected, cancellations, outbox failures, DB errors and latency.
- A consistency check script.

**Who uses what:**

- Operators: confirmed against capacity, at-risk bookings, notices failed.
- Engineers: latency, error rate, DB errors, duplicates detected, recovery time.

## 16. Implementation roadmap (estimates at about 8 hours a week)

| Phase | Deliverables | Time | Done when |
|---|---|---|---|
| 1 Research and validation | Interviews, evidence table, problem statement, proceed/pivot/stop decision | 2 weeks | A decision is written down, with evidence |
| 2 Local core | Schema, booking, cancel, idempotency, outbox, tests 1 to 3 and 5 | 3 to 4 weeks | All invariant tests pass repeatedly |
| 3 MVP interface | Swimmer and operator views, inbox, audit view | 3 weeks | A demo script runs end to end |
| 4 Infra learning | Terraform for the VPC design, validate, plan reviewed | 2 weeks | Validate passes; plan reviewed; nothing applied |
| 5 Fault drills | Drills A and B run, issues fixed, rerun | 2 weeks | Reports with real numbers |
| 6 Portfolio | README, diagram, demo video, cost and teardown docs | 1 to 2 weeks | A stranger can run it from the README |

The common failure point is phase 3 swallowing phase 5. The drills are the portfolio's strongest evidence, so protect their time.

## 17. GitHub and portfolio plan

```
swimsync/
  backend/   frontend/   db/migrations/   tests/   drills/{a,b}/
  infra/terraform/   docs/{research,adr,runbooks}/   diagrams/   .env.example
```

The README follows your 17-point outline. **Provisional CV line, with no metrics until you have them:** "Designed and built a capacity-safe booking system (FastAPI, PostgreSQL) with idempotent operations and an outbox for notifications; verified invariants with concurrency tests and two local fault drills; documented a two-AZ AWS VPC design in Terraform."

## 18. Immediate next steps

1. Write down your own incident evidence (section 2) this week.
2. Run 3 swimmer interviews and 1 operator interview, then review the categories before doing more.
3. Read the PostgreSQL Read Committed and row-locking sections, and explain the conditional update back in your own words.
4. Decide whether SwimSync replaces Project 1 or runs alongside it. They overlap heavily: a VPC design, drills, a cost ceiling.
5. Make the open design decisions: waitlist in or out of the MVP, the capacity-reduction policy, and the single-source-of-truth question from section 1.

**What to do first:** step 1 and the first interviews. The rest of the design depends on which cause from section 3 turns out to be real.
