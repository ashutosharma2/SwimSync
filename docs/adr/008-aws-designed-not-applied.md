# ADR-008: Design and validate the AWS stack, never apply it

- Status: Accepted
- Date: 2026-10-27
- Written: 2026-10-29

## Scenario

SwimSync should show how it would run on AWS: two Availability Zones, a load balancer, private app instances and a private database. The whole project has to cost ₹0, and credits and free trials don't count.

## Obstacle

- The AWS account is on the Paid plan. The AWS FAQ says usage beyond the credit balance is charged automatically (quoted in [initial-research.md, section 12](../research/initial-research.md#12-cost-audit), 2026-10-21).
- The load balancer, instances, database and interface endpoints all bill by the hour (same source).
- A design that never runs is weaker evidence than one that does.

## Action

- Write the stack in Terraform ([infra/terraform/](../../infra/terraform/)) and check it with `terraform fmt` and `terraform validate`, which need no AWS credentials. Locally they ran with the AWS config files pointed at `/dev/null`, so no credentials could be picked up by accident. CI runs them on every push, also without credentials ([tests.yml](../../.github/workflows/tests.yml)).
- `terraform plan` is only ever run by hand. `apply` needs a written cost check first, following the checklist in section 12: read the plan line by line, set a budget alert, apply and destroy in the same sitting, then check for anything left behind.
- Prove the guarantees locally instead, with tests and with drills that break instances and the database on purpose ([ADR-011](011-local-fault-drills.md)).
- Where a default saves cost, say what it gives up. The database is single-zone by default (`db_multi_az = false`), a known single point of failure that one variable changes.

Alternatives considered:

- **Deploy, test and destroy in one sitting.** Still bills by the hour, and a forgotten resource keeps billing.
- **LocalStack.** It emulates the APIs, but says little about how the real network, load balancer or database behave.
- **Free tier only.** This account is on the Paid plan, where usage beyond the credits is billed, and credits don't count as ₹0 here.

## Result

- `validate` proves the configuration is well formed and its references resolve. It doesn't prove the stack works, or what it would cost.
- The design is drawn in [docs/architecture.md](../architecture.md), sections 15 to 17, marked as designed and never deployed.
- The cost stays at ₹0. Prices change, so any number quoted needs its source and the date it was checked.

## Troubleshooting

- None.
