# How private app instances reach the AWS services they need without any route to the internet.
# Chosen over a NAT gateway: Session Manager still works (goal 3) and the instances get no internet path
# at all. The hourly cost is similar, not lower (docs/adr/009-vpc-endpoints-not-nat.md). Trade-off: no
# package downloads at boot, so the app and its dependencies are baked into the machine image.

locals {
  # secretsmanager: the app reads the database password, which RDS keeps in Secrets Manager.
  interface_endpoints = concat(["ssm", "ssmmessages", "secretsmanager"], var.enable_ec2messages_endpoint ? ["ec2messages"] : [])
  app_subnet_ids      = [for key, s in local.subnets : aws_subnet.this[key].id if s.tier == "app"]
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_endpoints)

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.app_subnet_ids # one network interface per zone, so losing a zone keeps admin access
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true

  tags = { Name = "swimsync-${each.key}" }
}

# S3 gateway endpoint: no additional charge. SSM Agent uses S3 for its updates.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.app.id]

  tags = { Name = "swimsync-s3" }
}
