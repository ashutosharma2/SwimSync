# The database: RDS PostgreSQL in the private DB subnets, never publicly accessible.

locals {
  db_subnet_ids = [for key, s in local.subnets : aws_subnet.this[key].id if s.tier == "db"]
}

# RDS requires subnets in at least two zones, even for a single-zone database.
resource "aws_db_subnet_group" "main" {
  name       = "swimsync"
  subnet_ids = local.db_subnet_ids
}

resource "aws_db_instance" "main" {
  identifier     = "swimsync"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "swimsync"
  username = "swimsync_admin"
  # RDS generates the password and keeps it in Secrets Manager. Terraform only sees the secret's ARN,
  # so the password never lands in Terraform state.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  # Single zone by default: a known single point of failure, chosen for cost. One switch to change.
  multi_az = var.db_multi_az

  backup_retention_period   = var.db_backup_retention_days
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "swimsync-final"
}
