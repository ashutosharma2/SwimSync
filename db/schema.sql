-- SwimSync schema, MVP step 1.
-- Applying this file resets the database: it drops every SwimSync table first. Local development only.

DROP TABLE IF EXISTS idempotency_keys, bookings, sessions;

CREATE TABLE sessions (
    id        bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      text        NOT NULL,
    starts_at timestamptz NOT NULL,
    capacity  integer     NOT NULL CHECK (capacity > 0),
    -- Confirmed bookings, kept in step with the bookings table inside each transaction.
    booked    integer     NOT NULL DEFAULT 0,
    -- Backstop for invariant 1: even a bug in the code can't push booked past capacity.
    CHECK (booked >= 0 AND booked <= capacity)
);

CREATE TABLE bookings (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id   bigint      NOT NULL REFERENCES sessions (id),
    swimmer_id   text        NOT NULL,
    status       text        NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz
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
