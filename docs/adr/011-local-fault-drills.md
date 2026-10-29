<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-011: Run the fault drills locally

- Status: Proposed
- Date: 2026-10-22 (commit 49ea89c)

## Scenario

<!--
- The guarantees must hold when an app instance dies mid-request or the database fails, and testing must cost nothing.
-->

## Obstacle

<!--
- Fault testing on AWS would cost money. Local drills don't reproduce a real network or a managed database, so label them as local experiments.
-->

## Action

<!--
- HAProxy in front of two app processes; Toxiproxy for down, slow and swallowed-commit phases; PostgreSQL; a prediction written before each run; an evidence rule; analysis scripts.
-->

Alternatives considered:

<!--
- **AWS Fault Injection Service:** why not?
- **Chaos testing a deployed stack:** why not?
- **Unit tests only:** why not?
-->

## Result

<!--
- What do drills A and B show, and what can't a local drill show?
-->

## Troubleshooting

<!--
- Drill A: three inconclusive runs on 2026-10-23 until the victim request was targeted (1fc14d7). Drill B: the outbox worker crash (ebf9719). Problem, cause, fix, lesson for each.
-->

<!--
Evidence to link:
- drills/01-instance-failure.md
- drills/02-database-connectivity.md
- drills/a/
- drills/b/
- drills/results/
-->
