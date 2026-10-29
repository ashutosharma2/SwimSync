<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-007: Operator access through one shared token

- Status: Proposed
- Date: 2026-10-29 (commit a732cc5)

## Scenario

<!--
- Only the pool should change capacity or close a session, and the MVP has no sign-in.
-->

## Obstacle

<!--
- Real sign-in needs an identity provider and must still cost nothing.
- A token in a header can leak, and an ordinary string comparison can leak timing.
-->

## Action

<!--
- X-Operator-Token compared with hmac.compare_digest; the endpoints refuse every request when no token is set; the audit log records "operator", not a person.
-->

Alternatives considered:

<!--
- **No protection in a demo:** why not?
- **HTTP basic auth:** why not?
- **A real identity provider:** why not yet?
- **Restricting by network:** why not?
-->

## Result

<!--
- What this does not give you (named operators, revoking one person) and what a real deployment needs (README, known limitations).
-->

## Troubleshooting

<!--
- Anything that went wrong while building it?
-->

<!--
Evidence to link:
- backend/app/main.py (operator_allowed)
- tests/test_operator.py: test_operator_endpoints_need_the_token
-->
