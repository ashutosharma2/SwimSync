<!-- Skeleton. The comments are questions for you to answer; delete each one as you write. -->

# ADR-009: Reach AWS services through VPC endpoints, not a NAT gateway

- Status: Proposed
- Date: 2026-10-27 (commit d5948db)

## Scenario

<!--
- The app instances sit in private subnets with no public IP, but still need Session Manager and S3.
-->

## Obstacle

<!--
- A NAT gateway is charged by the hour and by the GB. Quote both prices with their source and the date you checked.
-->

## Action

<!--
- Interface endpoints for ssm and ssmmessages (ec2messages optional), a gateway endpoint for S3, a secretsmanager endpoint (17db140); no port 22.
-->

Alternatives considered:

<!--
- **NAT gateway:** why not?
- **NAT instance:** why not?
- **Public IPs on the instances:** why not?
- **A bastion host:** why not?
-->

## Result

<!--
- What can't the instances reach now (for example package downloads), and how would you handle that?
-->

## Troubleshooting

<!--
- Anything that went wrong?
-->

<!--
Evidence to link:
- infra/terraform/endpoints.tf
- infra/terraform/network.tf
- infra/terraform/security.tf
-->
