<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-002: Idempotency keys that store the first answer

- Status: Proposed
- Date: 2026-10-21 (commit 729800f)

## Scenario

<!--
- A phone on poolside wifi sends Book, the reply is lost, and the app asks again. What must the second request get back?
-->

## Obstacle

<!--
- Why isn't "one confirmed booking per swimmer per session" (the partial unique index) enough on its own?
- What about a retry that arrives while the first request is still running, or after the session has filled?
-->

## Action

<!--
- What is stored with the key, and why does a replay return 200 with the same booking instead of a new 201?
- Why does a "full" answer stay full on retry, even if a place frees up later?
- Who creates the key (the app, once per tap) and where is it kept?
-->

Alternatives considered:

<!--
- **Deduplicate only by swimmer and session:** why not?
- **Server-generated request ids:** why not?
- **No automatic retries at all:** why not?
-->

## Result

<!--
- What do the tests prove? How long are keys kept, and is there a clean-up? Note any follow-up in BACKLOG.md.
-->

## Troubleshooting

<!--
- Anything that went wrong while building it?
-->

<!--
Evidence to link:
- backend/app/booking.py
- db/schema.sql
- tests/test_booking.py: test_retry_with_same_key_returns_the_first_booking, test_ten_simultaneous_retries_with_one_key_book_once, test_retry_of_a_full_answer_stays_full_even_after_a_place_frees_up, test_same_key_for_a_different_session_is_rejected, test_double_tap_with_two_keys_books_once
- tests/test_api.py: test_booking_returns_201_then_200_on_retry
- drills/a/load.py (retries with the same key)
-->
