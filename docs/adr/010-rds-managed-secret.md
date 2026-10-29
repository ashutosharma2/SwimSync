<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-010: Keep the database password in an RDS-managed secret

- Status: Proposed
- Date: 2026-10-27 (commit 17db140)

## Scenario

<!--
- The app needs database credentials without a password in the code or in Terraform state.
-->

## Obstacle

<!--
- A password variable ends up in Terraform state.
- IAM database authentication needs extra database memory according to the AWS docs: cite the page and the date you read it.
-->

## Action

<!--
- RDS manages the master password in Secrets Manager; an IAM policy lets the app read that one secret; a secretsmanager endpoint keeps the call private.
-->

Alternatives considered:

<!--
- **A password variable:** why not?
- **IAM database authentication:** why not?
- **SSM Parameter Store:** why not?
-->

## Result

<!--
- What is still to do (the app code that reads the secret was deferred)? Add it to BACKLOG.md.
-->

## Troubleshooting

<!--
- Anything that went wrong?
-->

<!--
Evidence to link:
- infra/terraform/database.tf
- infra/terraform/iam.tf
- infra/terraform/endpoints.tf
-->
