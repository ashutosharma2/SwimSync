# ADR-005: The app never says booked or not booked without evidence

- Status: Accepted
- Date: 2026-10-27

## Scenario

After tapping Book, a swimmer reads one line and acts on it: goes to the pool, or books something else. On a poolside network the reply can be slow, lost or a 503 ([ADR-004](004-two-kinds-of-503.md)).

## Obstacle

- A timeout doesn't mean the booking failed. The server may have saved it after the app stopped waiting.
- Saying "failed" after a lost reply could make a swimmer book twice, or skip a swim they actually have. Saying "booked" without the server's word is the false promise SwimSync exists to prevent.

## Action

The Book and Cancel rules live in [bookingFlow.ts](../../frontend/src/bookingFlow.ts), free of React so they can be tested on their own.

- Each tap gets one idempotency key ([ADR-002](002-idempotency-keys.md)), kept in sessionStorage until there's an answer, so a page reload mid-request resumes with the same key.
- "Booked" needs a 201 or 200 with a booking id. "Full", "closed" and "already booked" each get their own message.
- `database_unavailable`: two quiet retries a second apart (the server's `Retry-After`). If every attempt rolled back, the answer is "You're not booked".
- `outcome_unknown`, a timeout (the app waits 4 s) or a network error: retry with the same key after 1, 2 and 4 s, showing "checking". Once any attempt was uncertain, a later `database_unavailable` proves nothing about the earlier one, so the outcome stays uncertain.
- When the retries run out, the app reads My bookings, the server's record. A confirmed booking there means booked. If there's none, or the record can't be read, the answer is "we couldn't confirm yet", and the key is kept so pressing the button again can't book twice.
- Cancelling is safe to repeat on the server, so an uncertain cancel is retried the same way.

Alternatives considered:

- **Show an error and let the swimmer try again.** The new tap would carry a new key and could book twice, and the swimmer would be told "failed" when they might be booked.
- **Optimistic UI.** Showing "booked" straight away breaks the one rule that matters here.

## Result

- 16 tests cover it ([bookingFlow.test.ts](../../frontend/src/bookingFlow.test.ts)): no "booked" before the server confirms, the same key on every retry and after a reload, "unavailable" after an uncertain answer still treated as uncertain, a closed session treated as final, and My bookings deciding when the retries run out.
- The worst case is an honest "we couldn't confirm yet", with a button that's safe to press, not a wrong answer.

## Troubleshooting

- **The last step came from drill A.** The drill's load script first gave up after its retries with no answer at all. Commit 047f54c made it check My bookings after giving up, and scored a wrong "booked" there as a false success. In the next runs that check resolved a give-up correctly. The app ends the same way.
