# ADR-017: The operator types the token in, and the screen keeps it for that tab only

- Status: Accepted
- Date: 2026-10-30

## Scenario

The operator screen at `/operator` changes capacities and closes sessions. Every call it makes needs the shared operator token in `X-Operator-Token` ([ADR-007](007-operator-shared-token.md)). Every 5 s it reads the sessions, who is booked in the chosen session ([ADR-016](016-operator-reads-who-is-booked.md)) and the change log. So the screen has to hold the token somewhere for as long as the operator is using it.

## Obstacle

- Anything shipped in the page's JavaScript can be read by anyone who loads the page.
- A token in the URL ends up in browser history, server logs and `Referer` headers.
- A poolside computer may be shared. If one person leaves the screen signed in, the next person can cancel bookings.
- The token can stop working while the screen is open, for example when the API restarts with a different one. The screen shouldn't keep polling with a dead token, or keep showing controls that will be refused.

## Action

- The screen starts at a sign-in form ([OperatorApp.tsx](../../frontend/src/operator/OperatorApp.tsx)). The operator types the token into a password field.
- The form checks the token with a read, `GET /operator/audit`, before keeping it, so the check changes nothing. A 200 signs the operator in. A 403 shows "That token wasn't accepted" and keeps nothing. Any other answer, or none, says the server couldn't be reached.
- The token is kept in `sessionStorage` under `swimsync.operator-token` (Ashu's choice, 2026-10-30). According to MDN, that storage survives a reload, isn't shared with a new tab, and is cleared when the tab closes ([Window: sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage), page last modified 2026-10-12, read 2026-10-30).
- Sign out removes it. If an operator read gets a 403 later, the screen removes the token and goes back to the form with "That token is no longer accepted. Sign in again." ([useOperatorData.ts](../../frontend/src/operator/useOperatorData.ts))
- Every operator call goes through `call()` in [api.ts](../../frontend/src/api.ts), which adds the header. The token is never put in the URL or in `localStorage`.

Alternatives considered:

- **Build the token into the frontend (a `VITE_` variable).** It would be in the JavaScript bundle, readable by every visitor.
- **`localStorage`.** It stays after the tab closes, so the next person at a shared computer would be signed in.
- **Memory only.** Nothing is left behind, but every reload signs the operator out.
- **An HttpOnly cookie set by a login endpoint.** Page scripts couldn't read it, which is safer. It needs a login endpoint and protection against cross-site requests, though, and ADR-007 already names operator sign-in as the real fix. That's a lot of work to move a stopgap secret.
- **A query parameter, `?token=`.** It ends up in history and logs.

## Result

- A browser check against the local API, with the token set to the test value in [test_operator.py](../../tests/test_operator.py):
  - A wrong value got "That token wasn't accepted", and nothing was stored.
  - After sign-in, all 55 operator requests carried `X-Operator-Token`: 28 change-log reads, 25 bookings reads, 1 capacity change and 1 close.
  - A reload kept the operator signed in. Sign out cleared the stored token.
  - A wrong value planted in `sessionStorage` sent the screen back to the form with the "no longer accepted" line, and the value was removed.
- The cut and the close both worked from the screen, and the database matched. Lunchtime swim went from 10 places to 5: bookings 8, 7 and 6 were cancelled with `capacity_reduced`, the booked counter and the confirmed rows both said 5, and one audit row has the reason. Closing Evening family swim cancelled bookings 9, 10 and 11. swimmer-07's card showed "The pool reduced capacity and your booking was cancelled", and the notices for both changes were delivered.
- Frontend: typecheck clean, 37 tests pass, build succeeds.
- Trade-offs:
  - Any script running on the page can read `sessionStorage`, so a cross-site scripting bug would expose the token.
  - The token can be seen in the browser's developer tools.
  - It's still one shared secret, with no named operators (ADR-007).
- Not tested here: whether closing the tab clears the token. That comes from MDN.

## Troubleshooting

- **The sign-in didn't reach the screen being checked.** Ashu signed in twice, but the browser running the check still showed an empty form and had sent no operator request. That browser's window was hidden, so the sign-in most likely happened in another window. The test value was then entered directly into that browser, and the check carried on once the page's own requests showed the header arriving. Lesson: before trusting a manual step in a check, confirm it reached the page under test.
