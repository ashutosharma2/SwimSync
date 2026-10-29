# ADR-010: Keep the database password in an RDS-managed secret

- Status: Accepted
- Date: 2026-10-27

## Scenario

The app needs to log in to the private RDS PostgreSQL database ([ADR-008](008-aws-designed-not-applied.md)) without a password in the code, in the repo or in Terraform state.

## Obstacle

- A password passed to Terraform as a variable is stored in Terraform state in plain text.
- IAM database authentication avoids passwords, but the RDS docs say: "You must have between 300 and 1000 MiB extra memory on your database for reliable connectivity" ([IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html), checked 2026-10-29). On the smallest instance classes, that's a large share of the memory.

## Action

- `manage_master_user_password = true`: RDS creates the password and keeps it in Secrets Manager, so Terraform never sees it.
- An IAM policy lets the app instances call `secretsmanager:GetSecretValue` on that one secret and nothing else.
- A `secretsmanager` interface endpoint keeps the call inside the VPC ([ADR-009](009-vpc-endpoints-not-nat.md)).
- The database is private (`publicly_accessible = false`) and encrypted at rest.

Alternatives considered:

- **A password variable.** Ends up in Terraform state, and in the shell history of whoever typed it.
- **IAM database authentication.** No stored password, but the memory overhead above, and a token that lasts 15 minutes (same page), so the app has to keep fetching new ones.
- **SSM Parameter Store.** Could hold the password, but someone would have to create it and put it there by hand. With a managed secret, RDS creates it.

## Result

- No password exists in the repo, the code or Terraform state.
- Follow-up: the app doesn't read the secret yet. Today it takes `DATABASE_URL` from the environment; on AWS it would fetch the secret at start-up. Not yet in BACKLOG.md.

## Troubleshooting

- None. The stack is validated and never applied ([ADR-008](008-aws-designed-not-applied.md)), so this hasn't met a real database yet.
