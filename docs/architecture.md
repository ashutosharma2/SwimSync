# SwimSync architecture diagrams

## Summary (SOART)

- **Scenario:** SwimSync books places in fictional swimming sessions so that a confirmed booking always means a reserved place, motivated by being turned away from a booked swim.
- **Obstacle:** the guarantees live in a few lines of SQL inside transactions, plus a worker that runs separately. Without pictures it's hard to see where the lock is held, what's in each transaction and which process does what.
- **Action:** one diagram per view, drawn from the code as it is today. Solid lines and boxes are built; dashed ones are planned.
- **Result:** you can follow a booking from the request to the committed row, see two swimmers race for the last place, and see how a notification reaches the inbox even when delivery fails.
- **Troubleshooting:** the diagrams are only useful while they're accurate, so they're updated at the end of every phase, alongside the README.

**Contents**

1. [System context](#1-system-context)
2. [Containers (local)](#2-containers-local)
3. [API components](#3-api-components)
4. [Data model](#4-data-model)
5. [Booking a place](#5-booking-a-place)
6. [Two swimmers, one place](#6-two-swimmers-one-place)
7. [Retry after a lost response](#7-retry-after-a-lost-response)
8. [Cancelling exactly once](#8-cancelling-exactly-once)
9. [Booking states](#9-booking-states)
10. [Notification delivery](#10-notification-delivery)
11. [Drill A: instance failure](#11-drill-a-instance-failure)
12. [Drill B: database connectivity (planned)](#12-drill-b-database-connectivity-planned)
13. [Trust boundaries](#13-trust-boundaries)
14. [AWS infrastructure (designed, never deployed)](#14-aws-infrastructure-designed-never-deployed)
15. [AWS security groups](#15-aws-security-groups)
16. [Admin access and the database password](#16-admin-access-and-the-database-password)

---

## 1. System context

Who and what SwimSync deals with. The pool's front desk sits outside SwimSync: walk-ins and members admitted at the desk don't go through it, which is a known limitation, not something the MVP handles.

```mermaid
flowchart LR
    Swimmer(["Swimmer"])
    Operator(["Pool operator"])
    Desk(["Front desk<br/>walk-ins, members"])

    subgraph SwimSync["SwimSync (local)"]
        API["Booking API"]
        Worker["Outbox worker"]
    end

    Swimmer -- "browse, book, cancel,<br/>my bookings, inbox" --> API
    Worker -- "notices in the in-app inbox" --> Swimmer
    Operator -. "sessions and capacity<br/>(seed script for now)" .-> API
    Desk -. "not connected:<br/>known limitation" .- Operator

    class Operator,Desk planned
    classDef planned stroke-dasharray: 5 5
```

## 2. Containers (local)

The processes that run on one machine and how they talk. Everything listens on localhost only.

```mermaid
flowchart LR
    Client["Client<br/>curl, tests, drill load script"]
    UI["React + Tailwind app<br/>(planned)"]

    subgraph Local["Local machine"]
        API["Booking API<br/>FastAPI + uvicorn :8001"]
        Worker["Outbox worker<br/>scripts/outbox_worker.py"]
        Adapter["Simulated in-app adapter<br/>can be switched to fail"]
        PG[("PostgreSQL 18<br/>localhost only")]
    end

    Client -- "HTTP JSON" --> API
    UI -.-> API
    API -- "one transaction per request" --> PG
    Worker -- "claims due outbox rows" --> PG
    Worker --> Adapter
    Adapter -- "inserts inbox row<br/>(own transaction)" --> PG

    class UI planned
    classDef planned stroke-dasharray: 5 5
```

## 3. API components

How the backend code is split. `booking.py` holds every rule and never commits; the caller's `with db.connect()` block decides when the transaction ends.

```mermaid
flowchart TB
    Main["main.py<br/>routes, header checks,<br/>/health, X-Instance"]
    Booking["booking.py<br/>book, cancel, my_bookings,<br/>my_notifications"]
    DB["db.py<br/>connect(): commit on success,<br/>roll back on error"]
    Outbox["outbox.py<br/>deliver_one, backoff,<br/>run_forever"]
    Adapters["adapters.py<br/>InAppAdapter"]
    PG[("PostgreSQL")]

    Main --> Booking
    Main --> DB
    Booking -- "SQL inside the caller's transaction" --> PG
    DB --> PG
    Outbox --> DB
    Outbox --> Adapters
    Adapters --> DB
```

## 4. Data model

The five tables in `db/schema.sql`. The `booked` counter on `sessions` is changed only in the same transaction as the booking row it counts.

```mermaid
erDiagram
    sessions ||--o{ bookings : "has"
    sessions ||--o{ idempotency_keys : "requested for"
    bookings ||--o{ outbox : "announced by"
    outbox ||--o| notifications : "delivered as"

    sessions {
        bigint id PK
        text name
        timestamptz starts_at
        int capacity "greater than 0"
        int booked "CHECK 0 to capacity"
    }
    bookings {
        bigint id PK
        bigint session_id FK
        text swimmer_id
        text status "confirmed or cancelled"
        timestamptz created_at
        timestamptz cancelled_at
    }
    idempotency_keys {
        text swimmer_id PK
        text key PK
        bigint session_id FK
        int status_code
        jsonb response "the first answer"
    }
    outbox {
        bigint id PK
        bigint booking_id FK
        text kind
        text status "pending, delivered, failed"
        int attempts
        timestamptz next_attempt_at
        text last_error
    }
    notifications {
        bigint id PK
        bigint outbox_id FK "UNIQUE"
        text swimmer_id
        text message
    }
```

Two rules aren't visible in the diagram: a unique index allows one `confirmed` booking per swimmer per session, and `notifications.outbox_id` is unique, so one outbox row can only ever make one inbox entry.

## 5. Booking a place

`POST /sessions/{id}/bookings` with `X-Swimmer-Id` and `Idempotency-Key`. Everything between the lock and the commit is one transaction, and the answer is sent only after the commit.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant DB as PostgreSQL

    C->>A: POST /sessions/3/bookings (swimmer, key)
    A->>DB: BEGIN
    A->>DB: SELECT ... FROM sessions WHERE id = 3 FOR UPDATE
    Note over DB: session row locked until COMMIT
    A->>DB: key already stored?
    alt key seen before
        DB-->>A: stored answer
        A->>DB: COMMIT
        A-->>C: 200 with the first answer (nothing new booked)
    else already booked, or session full
        A->>DB: store 409 under the key
        A->>DB: COMMIT
        A-->>C: 409
    else place available
        A->>DB: INSERT booking (confirmed)
        A->>DB: UPDATE sessions SET booked = booked + 1
        A->>DB: INSERT outbox row (booking_confirmed)
        A->>DB: store 201 under the key
        A->>DB: COMMIT
        A-->>C: 201 confirmed
    end
```

## 6. Two swimmers, one place

Why the row lock matters. Without it, both would read "9 of 10" and both would book. The test suite proves the lock works (20 swimmers for 1 place gives exactly one booking) and that removing it breaks the tests.

```mermaid
sequenceDiagram
    participant SA as Swimmer A
    participant SB as Swimmer B
    participant DB as PostgreSQL

    SA->>DB: lock session row, read booked = 9 of 10
    SB->>DB: lock session row
    Note over SB,DB: waits: A holds the lock
    SA->>DB: insert booking, booked = 10, COMMIT
    Note over DB: lock released
    DB-->>SB: lock granted, read booked = 10 of 10
    SB->>DB: full: store 409, COMMIT
```

## 7. Retry after a lost response

A booking commits but the response never reaches the app (timeout, dead instance). The app retries with the same key and gets the first answer instead of a second booking.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant DB as PostgreSQL

    C->>A: book (key K)
    A->>DB: lock, insert booking 42, store 201 under K, COMMIT
    A--xC: response lost
    Note over C: outcome unknown: retry with the SAME key
    C->>A: book (key K)
    A->>DB: lock, key K already stored
    A-->>C: 200 booking 42 (no second booking)
```

## 8. Cancelling exactly once

`POST /bookings/{id}/cancel`. The cancel takes the same session lock as booking, then releases the place only if the booking is still confirmed, so a retry or a double tap changes nothing.

```mermaid
flowchart TD
    Start(["cancel booking 42"]) --> Find{"booking 42 belongs<br/>to this swimmer?"}
    Find -- no --> NotFound["404"]
    Find -- yes --> Lock["lock the session row<br/>(same lock as booking)"]
    Lock --> Status{"status now?"}
    Status -- cancelled --> Already["200 already_cancelled: true<br/>nothing released"]
    Status -- confirmed --> Release["set cancelled,<br/>booked = booked - 1,<br/>outbox row booking_cancelled"]
    Release --> Commit["COMMIT, 200"]
```

## 9. Booking states

There is no "pending" state: a request either reserves a place and becomes `confirmed` in one transaction, or it's rejected. That removes the gap between "shown as booked" and "actually reserved".

```mermaid
stateDiagram-v2
    [*] --> confirmed: book (place reserved in the same transaction)
    [*] --> rejected: full, already booked, unknown session
    confirmed --> cancelled: cancel (place released once)
    cancelled --> cancelled: cancel again (no change)
    rejected --> [*]
    cancelled --> [*]
```

## 10. Notification delivery

The outbox row is written with the booking. The worker delivers it later, outside the booking's transaction, so a delivery failure can never change a booking. Delivery is at least once; the inbox's unique `outbox_id` turns a repeat into a no-op.

```mermaid
stateDiagram-v2
    [*] --> pending: written in the booking transaction
    pending --> delivered: adapter succeeds
    pending --> pending: adapter fails, retry after 1, 2, 4, 8 s (cap 60 s)
    pending --> failed: 5th failure, last error kept
    delivered --> [*]
    failed --> [*]
```

The worker claims a row with `FOR NO KEY UPDATE SKIP LOCKED`. `SKIP LOCKED` lets several workers share the queue. `NO KEY UPDATE` (not `UPDATE`) lets the adapter's inbox insert pass its foreign-key check while the worker still holds the row; with `FOR UPDATE` the two connections waited on each other forever.

## 11. Drill A: instance failure

Local experiment, not proof of AWS high availability. `drills/a/run.py` runs 30 fictional swimmers for 60 seconds, kills `a1` with `kill -9` at 20 seconds and restarts it at 40. HAProxy doesn't retry on its own (`retries 0`); the load script retries with the same idempotency key.

Two modes aim the kill at a known point. A single "victim" request (swimmer `drill-victim`, on its own session) goes straight to `a1` and is held there for 2 seconds, either before its commit (`--mode before-commit`) or after it (`--mode after-commit`). `a1` is killed half a second into that hold. Only the victim is delayed, so the load swimmers aren't slowed down. The victim then retries through HAProxy with the same key: before the commit, the booking rolled back, so the retry books fresh (201); after the commit, the booking was saved, so the retry gets the stored answer (200). Either way the database must end with exactly one victim booking.

```mermaid
flowchart LR
    Load["drills/a/load.py<br/>30 swimmers, same-key retries"]

    subgraph Local["Local machine"]
        LB["HAProxy :8080<br/>GET /health every 1 s<br/>down after 2 fails, up after 2 passes"]
        A1["API a1 :8001<br/>kill -9 at 20 s, restart at 40 s"]
        A2["API a2 :8002"]
        PG[("PostgreSQL<br/>swimsync_drill")]
    end

    Load --> LB
    LB --> A1
    LB --> A2
    A1 --> PG
    A2 --> PG
```

```mermaid
sequenceDiagram
    participant L as Load script
    participant H as HAProxy
    participant A1 as a1
    participant A2 as a2

    L->>H: book (key K)
    H->>A1: forward
    Note over A1: kill -9
    H-->>L: 503 (a1 refused the connection)
    L->>H: retry, same key K
    H->>A2: forward
    A2-->>L: 201 or the stored answer for K
    Note over H: 2 failed health checks: a1 marked DOWN, all traffic to a2
    Note over A1: restarted
    Note over H: 2 passed checks: a1 marked UP again
```

## 12. Drill B: database connectivity (planned)

Not built yet. The plan from the research: put Toxiproxy between the API and PostgreSQL to add latency, time out or cut the connection, including the case where a booking commits but the client's request times out.

```mermaid
flowchart LR
    Load["drill B load script"]
    API["Booking API"]
    Toxi["Toxiproxy<br/>latency, timeout, cut"]
    PG[("PostgreSQL")]

    Load -.-> API
    API -.-> Toxi
    Toxi -.-> PG

    class Load,Toxi planned
    classDef planned stroke-dasharray: 5 5
```

## 13. Trust boundaries

What SwimSync trusts today, and what it doesn't. The swimmer's identity is only a header: fine for a local demo, not authentication.

```mermaid
flowchart LR
    subgraph Untrusted["Untrusted: anything can be sent"]
        Client["Client"]
    end

    subgraph Server["Checked on the server"]
        API["API<br/>validates headers and IDs,<br/>decides every outcome"]
    end

    subgraph Data["Localhost only"]
        PG[("PostgreSQL<br/>constraints as a backstop")]
    end

    Auth["Real sign-in and operator roles<br/>(planned)"]

    Client -- "X-Swimmer-Id (demo identity),<br/>Idempotency-Key (UUID)" --> API
    API --> PG
    Auth -.-> API

    class Auth planned
    classDef planned stroke-dasharray: 5 5
```

What the server never takes from the client: whether there's room, the booking's status, or the counter. The database enforces the last line of defence itself: `CHECK (booked <= capacity)`, the unique confirmed-booking index and the unique inbox `outbox_id`.

## 14. AWS infrastructure (designed, never deployed)

The AWS version of the local system, as written in `infra/terraform/` and checked with `terraform validate`. It has never been planned or applied: the account is on the Paid plan, so the ₹0 budget comes from not deploying it. Everything in this section is drawn dashed for that reason.

The region is `ap-south-1`, with one subnet of each tier in each of two zones (a and b). The mapping from what's been drilled locally: the ALB plays HAProxy, and the two app instances in two zones play `a1` and `a2`. Only the ALB can be reached from the internet. The app subnets have no internet route at all, and the database subnets only route inside the VPC.

```mermaid
flowchart TB
    Internet(["Internet"])

    subgraph VPC["VPC 10.20.0.0/16"]
        IGW["Internet Gateway"]

        subgraph Public["Public subnets"]
            direction LR
            PubA["zone a: 10.20.0.0/24<br/>ALB node"]
            PubB["zone b: 10.20.1.0/24<br/>ALB node"]
        end

        subgraph App["Private app subnets"]
            direction LR
            AppA["zone a: 10.20.10.0/24<br/>app instance 0<br/>API + outbox worker"]
            AppB["zone b: 10.20.11.0/24<br/>app instance 1<br/>API + outbox worker"]
        end

        subgraph Data["Private DB subnets"]
            direction LR
            DbA["zone a: 10.20.20.0/24<br/>RDS PostgreSQL<br/>(single zone by default)"]
            DbB["zone b: 10.20.21.0/24<br/>standby only if db_multi_az"]
        end

        Endpoints["Interface endpoints<br/>ssm, ssmmessages, secretsmanager<br/>(one interface per app subnet)"]
        S3GW["S3 gateway endpoint<br/>(no charge)"]
    end

    Internet -. "HTTP :80" .-> IGW
    IGW -.-> Public
    Public -. ":8000 to both instances" .-> App
    App -. ":5432" .-> DbA
    DbA -. "replica only if db_multi_az" .- DbB
    App -. ":443" .-> Endpoints
    App -.-> S3GW

    class IGW,PubA,PubB,AppA,AppB,DbA,DbB,Endpoints,S3GW planned
    classDef planned stroke-dasharray: 5 5
```

| Route table | Subnets | Routes |
|---|---|---|
| public | 10.20.0.0/24, 10.20.1.0/24 | local, and `0.0.0.0/0` to the Internet Gateway (the only internet route in the VPC) |
| app | 10.20.10.0/24, 10.20.11.0/24 | local, and S3 through the gateway endpoint |
| db | 10.20.20.0/24, 10.20.21.0/24 | local only, permanently |

What survives what: losing an app instance or a whole zone leaves the other app instance serving through the ALB, which is drill A at cloud scale. Losing the database's zone takes the database down unless `db_multi_az` is switched on, which roughly doubles the database's cost. That trade-off is deliberate and is listed as a known single point of failure.

## 15. AWS security groups

Each tier accepts traffic only from the tier in front of it, and the rules name security groups, not IP addresses, so they keep working when instances are replaced. Terraform removes AWS's default "allow all outbound" rule, so the arrows below are the only traffic allowed. There's no port 22 anywhere.

```mermaid
flowchart LR
    Internet(["Internet"])
    ALB["sg alb"]
    App["sg app"]
    DB["sg db<br/>no outbound rules"]
    EP["sg endpoints"]
    S3["S3 prefix list"]

    Internet -. "80 in" .-> ALB
    ALB -. "8000" .-> App
    App -. "5432" .-> DB
    App -. "443" .-> EP
    App -. "443" .-> S3

    class ALB,App,DB,EP planned
    classDef planned stroke-dasharray: 5 5
```

HTTP only on the ALB: HTTPS needs a certificate, a certificate needs a domain, and a domain costs money. It's a production requirement, not part of the ₹0 design.

## 16. Admin access and the database password

Nothing connects in to an app instance. SSM Agent on each instance connects out, through the interface endpoints, to Session Manager, and an operator's shell travels back over that connection. The database password is created by RDS and kept in Secrets Manager; Terraform only ever sees its ARN, and the instance role may read that one secret and nothing else.

```mermaid
sequenceDiagram
    participant Op as Operator (AWS console or CLI)
    participant SSM as Session Manager (AWS service)
    participant EP as Interface endpoints (in the VPC)
    participant App as App instance (private, no public IP)
    participant SM as Secrets Manager
    participant DB as RDS

    App->>EP: SSM Agent connects out on 443
    EP->>SSM: registered, waiting for sessions
    Op->>SSM: start session (IAM-authorised)
    SSM-->>App: shell over the agent's outbound channel
    Note over App: no port 22, no SSH key, no bastion
    App->>EP: at start-up: GetSecretValue (one ARN only)
    EP->>SM: request
    SM-->>App: database password (planned: the app reads DATABASE_URL today)
    App->>DB: connect on 5432
```

Instances also require IMDSv2 (`http_tokens = "required"`), so the instance metadata, including the role's temporary credentials, can only be read after a PUT for a session token.
