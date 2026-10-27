# Four security groups, each allowing only the tier in front of it. No port 22 anywhere: administration
# goes through Session Manager. Rules reference other security groups, not IP addresses.
#
# Terraform removes AWS's default "allow all outbound" rule from these groups, so the only traffic
# allowed is what's written here.

resource "aws_security_group" "alb" {
  name        = "swimsync-alb"
  description = "Load balancer: HTTP in from the internet, out only to the app"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "app" {
  name        = "swimsync-app"
  description = "App instances: in only from the load balancer"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "swimsync-db"
  description = "Database: PostgreSQL in only from the app"
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "endpoints" {
  name        = "swimsync-endpoints"
  description = "Interface endpoints: HTTPS in only from the app"
  vpc_id      = aws_vpc.main.id
}

# Load balancer. HTTP only: HTTPS needs a certificate, a certificate needs a domain, and a domain
# costs money. HTTPS is listed as a production requirement.
resource "aws_vpc_security_group_ingress_rule" "alb_http_from_internet" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
}

# App instances.
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "app_to_endpoints" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.endpoints.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "app_to_s3" {
  security_group_id = aws_security_group.app.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# Database: one inbound rule, no outbound rules. Security groups are stateful, so replies to the app
# are allowed without an outbound rule.
resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

# Interface endpoints.
resource "aws_vpc_security_group_ingress_rule" "endpoints_from_app" {
  security_group_id            = aws_security_group.endpoints.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}
