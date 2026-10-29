<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-008: Design and validate the AWS stack, never apply it

- Status: Proposed
- Date: 2026-10-27 (commit d5948db)

## Scenario

<!--
- The project must cost nothing, and the AWS account bills usage beyond credits automatically.
-->

## Obstacle

<!--
- A design that's never deployed is weaker evidence. How do you still show it is sound?
- Any price you quote needs its source and the date you checked it.
-->

## Action

<!--
- Terraform written; terraform fmt and validate run locally and in CI with no credentials; plan run only by you; apply only after a written cost check (docs/research/initial-research.md, section 12).
-->

Alternatives considered:

<!--
- **Deploy, test and tear down the same day:** why not?
- **LocalStack:** why not?
- **Free tier only:** why not?
-->

## Result

<!--
- What does validate prove (syntax and references) and what doesn't it (that it works, what it costs)?
-->

## Troubleshooting

<!--
- Anything that went wrong, such as running validate without AWS credentials?
-->

<!--
Evidence to link:
- infra/terraform/
- .github/workflows/tests.yml (commit 5924a6c)
- docs/research/initial-research.md, section 12
- docs/architecture.md, the AWS sections
-->
