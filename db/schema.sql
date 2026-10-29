-- SwimSync schema: bookings, notifications and operator capacity changes.
-- Applying this file resets the database: it drops every SwimSync table first. Local development only.

DROP TABLE IF EXISTS audit_log, notifications, outbox, idempotency_keys, bookings, sessions;

CREATE TABLE sessions (
    id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      text        NOT NULL,
    starts_at timestamptz NOT NULL,
    capacity  integer     NOT NULL CHECK (capacity > 0),
    -- Confirmed bookings, kept in step with the bookings table inside each transaction.
    booked    integer     NOT NULL DEFAULT 0,
    -- A closed session takes no bookings; closing it cancels the ones it had.
    status    text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    -- Backstop for invariant 1: even a bug in the code can't push booked past capacity.
    CHECK (booked >= 0 AND booked <= capacity)
);

CREATE TABLE bookings (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id   bigint      NOT NULL REFERENCES sessions (id),
    swimmer_id   text        NOT NULL,
    status       text        NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    -- Why a booking was cancelled, so "My bookings" never leaves the swimmer guessing.
    cancel_reason text CHECK (cancel_reason IN ('swimmer', 'capacity_reduced', 'session_closed')),
    CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);

-- One confirmed booking per swimmer per session. Catches a double tap that sends two different keys.
CREATE UNIQUE INDEX one_confirmed_booking_per_swimmer
    ON bookings (session_id, swimmer_id)
    WHERE status = 'confirmed';

-- The first answer to each booking request, so a retry with the same key gets the same answer.
CREATE TABLE idempotency_keys (
    swimmer_id  text        NOT NULL,
    key         text        NOT NULL,
    session_id  bigint      NOT NULL REFERENCES sessions (id),
    status_code integer     NOT NULL,
    response    jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (swimmer_id, key)
);

-- Notifications waiting to be delivered. Written in the same transaction as the booking change,
-- so a row exists if and only if that change committed. It is a request to notify, never the
-- record of booking status: the bookings table is.
CREATE TABLE outbox (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    swimmer_id      text        NOT NULL,
    booking_id      bigint      NOT NULL REFERENCES bookings (id),
    kind            text        NOT NULL CHECK (kind IN ('booking_confirmed', 'booking_cancelled', 'booking_cancelled_by_pool')),
    message         text        NOT NULL,
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts        integer     NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz
);

CREATE INDEX outbox_due ON outbox (next_attempt_at) WHERE status = 'pending';

-- The in-app inbox. One entry per outbox row: a redelivery after a crash can't create a duplicate.
CREATE TABLE notifications (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    outbox_id  bigint      NOT NULL UNIQUE REFERENCES outbox (id),
    swimmer_id text        NOT NULL,
    message    text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Every operator change to a session: who, what, before and after, and which bookings it cancelled
-- (invariant 11: capacity reductions are handled explicitly and audited). Rows are only ever added.
CREATE TABLE audit_log (
    id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at                   timestamptz NOT NULL DEFAULT now(),
    actor                text        NOT NULL,
    action               text        NOT NULL CHECK (action IN ('capacity_changed', 'session_closed')),
    session_id           bigint      NOT NULL REFERENCES sessions (id),
    reason               text        NOT NULL,
    before               jsonb       NOT NULL,
    after                jsonb       NOT NULL,
    affected_booking_ids bigint[]    NOT NULL DEFAULT '{}'
);
