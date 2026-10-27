output "vpc_id" {
  value = aws_vpc.main.id
}

output "subnet_ids" {
  description = "Subnet IDs by tier, in zone order."
  value = {
    for tier in keys(var.subnet_cidrs) : tier => [
      for i in range(length(var.azs)) : aws_subnet.this["${tier}-${i}"].id
    ]
  }
}

output "security_group_ids" {
  value = {
    alb       = aws_security_group.alb.id
    app       = aws_security_group.app.id
    db        = aws_security_group.db.id
    endpoints = aws_security_group.endpoints.id
  }
}

output "app_instance_profile" {
  value = aws_iam_instance_profile.app.name
}

output "alb_dns_name" {
  description = "The public address of the app (HTTP)."
  value       = aws_lb.main.dns_name
}

output "db_address" {
  value = aws_db_instance.main.address
}

output "db_secret_arn" {
  description = "Where the database password lives. The ARN is not the password."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}
