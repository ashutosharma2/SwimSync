<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-004: Answer database failures with two different 503s

- Status: Proposed
- Date: 2026-10-24 (commit ef561a8)

## Scenario

<!--
- The database is down, slow, or the reply to a commit is lost. What can the API honestly tell the app?
-->

## Obstacle

<!--
- Why would a generic 500, or a single 503, force the app to guess?
- Once the commit has been sent, why can't the API know whether it was saved?
-->

## Action

<!--
- Timeouts, and an explicit commit so the code knows which side of the commit a failure happened on.
- database_unavailable: nothing was saved, so "not booked" is true. outcome_unknown: it may have been saved, so retry with the same key.
- How does the app treat each one?
-->

Alternatives considered:

<!--
- **One 503 for every failure:** why not?
- **Retry inside the API before answering:** why not?
- **Two-phase commit:** why not?
-->

## Result

<!--
- What do the tests and drill B show? What's left uncertain, and how does the app close that gap?
-->

## Troubleshooting

<!--
- Anything that went wrong while building it?
-->

<!--
Evidence to link:
- backend/app/db.py
- backend/app/booking.py
- tests/test_db_failures.py: test_database_down_gives_503_and_books_nothing, test_commit_saved_but_reply_lost_is_outcome_unknown_then_retry_finds_it, test_commit_not_saved_is_also_outcome_unknown_then_retry_books
- drills/02-database-connectivity.md
-->
