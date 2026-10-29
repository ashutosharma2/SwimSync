# ADR-009: Reach AWS services through VPC endpoints, not a NAT gateway

- Status: Accepted
- Date: 2026-10-27

## Scenario

The app instances sit in private subnets with no public IP ([ADR-008](008-aws-designed-not-applied.md)). They still need Session Manager for administration, S3 for SSM Agent updates, and Secrets Manager for the database password ([ADR-010](010-rds-managed-secret.md)).

## Obstacle

Private instances can't reach AWS services' public endpoints on their own. The usual answer is a NAT gateway, which gives them a route to the whole internet and is charged by the hour and by the GB.

## Action

- Interface endpoints for `ssm`, `ssmmessages` and `secretsmanager`, each with a network interface in both app subnets, so losing a zone doesn't lose admin access. `ec2messages` is optional, for older SSM agents.
- A gateway endpoint for S3. The AWS docs say "There is no additional charge for using gateway endpoints" ([gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html), checked 2026-10-29).
- The endpoints' security group accepts HTTPS only from the app. There's no port 22 anywhere: administration is through Session Manager only.
- The app subnets have no internet route at all.

Alternatives considered:

- **A NAT gateway.** Gives every instance a path to the internet it doesn't need, which widens what an attacker could reach. One NAT gateway also lives in one zone.
- **A NAT instance.** Cheaper, but one more server to patch, and still an internet path.
- **Public IPs on the instances.** Puts the app tier on the internet.
- **A bastion host with SSH.** A server and an open port 22 just for administration, when Session Manager needs neither.

## Result

- The instances can reach only the services they need, and nothing on the internet.
- No package downloads at boot: the app and its dependencies have to be baked into the machine image.
- The cost is about the same. With the US East example prices recorded in [initial-research.md](../research/initial-research.md) on 2026-10-21 ($0.01 an hour per interface endpoint per zone; $0.045 an hour plus $0.045 per GB for a NAT gateway), three endpoints in two zones come to $0.06 an hour. That's more than one NAT gateway, and less than one per zone ($0.09). Recheck the prices for ap-south-1 before relying on them. On price the two options are close, so the choice comes down to security and access.

## Troubleshooting

- **The cost reasoning was wrong at first.** The comment in endpoints.tf said the endpoints cost less per hour than a NAT gateway. Working through the numbers for this ADR showed that isn't true against a single NAT gateway, so the comment now gives the real reasons.
