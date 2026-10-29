# ADR-007: Operator access through one shared token

- Status: Accepted
- Date: 2026-10-29

## Scenario

Only the pool should be able to change a session's capacity or close it ([ADR-006](006-capacity-cuts-newest-first.md)). The MVP has no sign-in for anyone: swimmers identify themselves with a header, as a demo shortcut.

## Obstacle

- Real operator sign-in needs an identity provider, which is out of scope for the MVP and must cost nothing.
- Leaving the operator endpoints open would let anyone cancel everyone's bookings.
- A token sent in a header can leak, and an ordinary string comparison can leak timing information about it.

## Action

- The operator endpoints need an `X-Operator-Token` header matching `SWIMSYNC_OPERATOR_TOKEN`, compared with `hmac.compare_digest`, which takes the same time wherever the strings differ.
- If the environment variable isn't set, every operator request is refused with 403. The default is closed.
- Inputs are bounded: a capacity from 1 to 500, and a reason of 1 to 200 characters, required for every change.
- The audit log records the actor as `operator`, because one shared secret can't say which person made the change.
- The token is set when the app starts and never written in the code or the repo.

Alternatives considered:

- **No protection, since it's a demo.** The endpoints cancel real bookings. Even a demo shouldn't leave that open.
- **HTTP basic auth.** The same shared secret with more ceremony.
- **A real identity provider now.** The right end state, but it adds a service and setup, and changes none of the booking guarantees this project is about.
- **Restrict by network.** Doesn't apply to a local demo, and still isn't identity.

## Result

- The operator endpoints refuse a missing or wrong token ([tests/test_operator.py](../../tests/test_operator.py)).
- What it doesn't give: named operators, revoking one person's access, or changing the token without restarting the app. A real deployment needs operator sign-in, HTTPS and a secrets manager ([README, known limitations](../../README.md#known-limitations)).

## Troubleshooting

- None while building it.
