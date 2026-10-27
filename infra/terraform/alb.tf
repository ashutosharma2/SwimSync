# The load balancer: the only thing reachable from the internet. Drill A's HAProxy, in AWS form.

locals {
  public_subnet_ids = [for key, s in local.subnets : aws_subnet.this[key].id if s.tier == "public"]
}

resource "aws_lb" "main" {
  name               = "swimsync"
  load_balancer_type = "application"
  internal           = false
  subnets            = local.public_subnet_ids # one per zone; an ALB needs at least two zones
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "app" {
  name     = "swimsync-app"
  port     = var.app_port
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  # As close to drill A's HAProxy settings as the ALB allows: HAProxy checked every 1 s, and the
  # ALB's shortest interval is 5 s (check the target group docs before relying on it).
  health_check {
    path                = "/health" # shallow on purpose: a database outage shouldn't remove every instance
    matcher             = "200"
    interval            = 5
    timeout             = 2
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP" # HTTPS needs a certificate, which needs a domain: a production item

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_target_group_attachment" "app" {
  count = length(aws_instance.app)

  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app[count.index].id
  port             = var.app_port
}
