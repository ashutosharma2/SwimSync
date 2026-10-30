# ADR-016: The operator reads who holds a place, in the order a cut would take it

- Status: Accepted
- Date: 2026-10-29

## Scenario

The operator screen shows a session's places as floats on a rope, in booking order, with the wall at the new capacity. The floats past the wall are the bookings a cut would cancel ([ADR-006](006-capacity-cuts-newest-first.md)), and tapping one shows who booked it and when. The API had no way to read that: `GET /sessions` gives counts only, and `GET /me/bookings` shows a swimmer their own bookings and nobody else's.

## Obstacle

- The list has to be in exactly the order a cut uses, or the preview shows the wrong people losing their places. The cut takes `created_at DESC, id DESC`.
- Reading the session's booked count and its bookings in two statements could catch a booking arriving in between. The screen would then show, say, "5 booked" beside four floats.
- Swimmer ids belong to swimmers. They must not reach the public sessions list.

## Action

`GET /operator/sessions/{id}/bookings` ([main.py](../../backend/app/main.py), [operator.py](../../backend/app/operator.py)):

- It sits behind the operator token like the other operator endpoints ([ADR-007](007-operator-shared-token.md)), and answers `database_unavailable` through `read()` when the database is down. An unknown session gets 404.
- It returns the session's name, capacity, booked count and status, and its confirmed bookings, oldest first (`created_at, id`). That's the cut's order reversed, so the last booking listed is the first a cut cancels.
- It reads everything in one statement, the session joined to its confirmed bookings, so the count and the list come from the same snapshot. A session with no bookings still comes back as one row.
- Confirmed bookings only (Ashu's choice, 2026-10-29).

Alternatives considered:

- **Include cancelled bookings with their reasons.** The change log (`GET /operator/audit`) already records which bookings each change cancelled, so the rope only needs the places that are held.
- **List newest first, the same as the cut.** The screen would have to reverse it to read "booked first" on the left and "booked last" on the right.
- **Two queries, the session and then its bookings.** The count and the list could disagree.
- **Add the bookings to `GET /sessions`.** Every swimmer would see every other swimmer's id.

## Result

- Four tests in [test_operator.py](../../tests/test_operator.py): the token check, oldest first, confirmed only, and an empty or unknown session. In the order test, four bookings are made and capacity is cut to 2. The cut cancels the last two in the list, and afterwards the booked count equals the length of the list.
- The full backend suite passes: 52 tests.
- Trade-offs: the list isn't paged. A capacity can be at most 500, so one session's list stays small. The swimmer ids are only as protected as the one shared operator token.
- Follow-up: the operator screen (step 4) reads this endpoint and the change log.

## Troubleshooting

- **Three files had quietly gone back to an older version.** Before editing, `git status` showed uncommitted changes to `main.py`, `operator.py` and `test_operator.py` that undid the change-log commit, f966ebe, line for line. All three had the same modification time, 19:50:34. The cause was a checkpoint restore in the development tool: an interrupted step was retried, and the retry put back the files that step had edited, while the commit stayed in git. Committing on top would have deleted the change-log endpoint. With Ashu's OK, the files were restored to the committed version first. Lesson: after any retry or restore, check `git status` and `git diff` before editing files that are already committed.
