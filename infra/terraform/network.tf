# The VPC, six subnets (public, private app, private DB, in each of two zones) and three route tables.

locals {
  subnets = merge([
    for tier, cidrs in var.subnet_cidrs : {
      for i, cidr in cidrs : "${tier}-${i}" => { tier = tier, cidr = cidr, az = var.azs[i] }
    }
  ]...)
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  # Both needed for the interface endpoints' private DNS names to resolve inside the VPC.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "swimsync" }
}

resource "aws_subnet" "this" {
  for_each = local.subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.az
  # No automatic public IPs, even in the public subnets: only the ALB lives there, and it manages its own.
  map_public_ip_on_launch = false

  tags = { Name = "swimsync-${each.key}", Tier = each.value.tier }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "swimsync" }
}

# Public: the only route to the internet in the whole VPC.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "swimsync-public" }
}

# App: local traffic only, plus the S3 gateway endpoint route added in endpoints.tf. No internet route.
resource "aws_route_table" "app" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "swimsync-app" }
}

# DB: local traffic only, permanently. The database never needs to reach anything outside the VPC.
resource "aws_route_table" "db" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "swimsync-db" }
}

resource "aws_route_table_association" "this" {
  for_each = local.subnets

  subnet_id = aws_subnet.this[each.key].id
  route_table_id = {
    public = aws_route_table.public.id
    app    = aws_route_table.app.id
    db     = aws_route_table.db.id
  }[each.value.tier]
}
