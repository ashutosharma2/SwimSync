# ADR-002: Idempotency keys that store the first answer

- Status: Accepted
- Date: 2026-10-21

## Scenario

A swimmer taps Book on a phone at the poolside. The request reaches the server, but the reply is lost, or the app stops waiting. The app has to ask again, and the second request must not book a second place or give a different answer.

## Obstacle

- The partial unique index (one confirmed booking per swimmer per session) stops a second booking, but on its own a retry would get "you already have a booking", not the answer the first request earned.
- It can't help when the first answer was something other than a booking, such as "full". A retry could then book a place that freed up later, which is a different decision from the one the swimmer saw.
- A retry can arrive while the first request is still running.

## Action

Every booking request carries an `Idempotency-Key` header: a UUID the app creates once per tap ([ADR-005](005-no-answer-without-evidence.md)).

Inside the booking transaction, after locking the session row ([ADR-001](001-session-row-lock.md)):

1. Look up the key for this swimmer. If it exists, return the stored answer and change nothing. A stored 201 is replayed as 200 with the same body and booking id, so the app can tell a replay from a new booking.
2. Otherwise decide as normal, then store the status and body under `(swimmer_id, key)` in the same transaction as the booking. The key and the booking are saved together or not at all.

Because the decision happens under the session lock, ten simultaneous retries with one key queue up: the first decides, and the rest read its answer.

A stored "full" stays "full", even if a place frees up later. The key names one attempt, and that attempt's answer was "full". Booking the freed place takes a new tap with a new key.

A key reused for a different session gets a 422. If the same key arrives for two different sessions at the same moment, the second insert hits the primary key, its transaction rolls back and it gets a 409, with nothing booked.

The partial unique index stays as a second guard: a double tap that sends two different keys still books once.

Alternatives considered:

- **Deduplicate only by swimmer and session.** Simpler, but a retry can't get back the original answer, and a "full" retry could quietly turn into a booking.
- **Server-generated request ids.** The app only learns the id from the reply, which is the thing that gets lost.
- **No automatic retries.** Leaves the swimmer guessing after every lost reply, which is the problem SwimSync exists to solve.

## Result

- A retry with the same key returns the first booking, ten simultaneous retries book once, a "full" answer stays full after a place frees up, a key for another session is refused, and a double tap with two keys books once ([tests/test_booking.py](../../tests/test_booking.py), [tests/test_api.py](../../tests/test_api.py)).
- Drill A's after-commit run: the booking committed, the instance died before replying, and the retry on the other instance got the stored answer, with exactly one booking ([ADR-011](011-local-fault-drills.md)).
- Keys are never deleted, so the table grows by one row per booking request. A clean-up of old keys is a follow-up, not yet in BACKLOG.md.

## Troubleshooting

- None while building it.
