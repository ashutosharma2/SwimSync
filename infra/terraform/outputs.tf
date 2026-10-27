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
