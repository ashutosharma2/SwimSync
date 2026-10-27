# Two app instances, one in each zone's private app subnet. Each runs the API and the outbox worker
# from the baked image. No public IP, no SSH key: administration is through Session Manager.

resource "aws_instance" "app" {
  count = length(var.azs)

  ami                         = var.app_ami_id
  instance_type               = var.app_instance_type
  subnet_id                   = local.app_subnet_ids[count.index]
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = false

  # IMDSv2 only: a request to the metadata service must first get a session token with a PUT.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    encrypted   = true
  }

  # Where to find the database. Not secrets: the password stays in Secrets Manager, and the app reads
  # it at start-up (not implemented yet; the app reads DATABASE_URL today).
  user_data = <<-EOT
    #!/bin/bash
    mkdir -p /etc/swimsync
    cat > /etc/swimsync/env <<'ENV'
    SWIMSYNC_INSTANCE=app-${count.index}
    SWIMSYNC_DB_HOST=${aws_db_instance.main.address}
    SWIMSYNC_DB_NAME=${aws_db_instance.main.db_name}
    SWIMSYNC_DB_SECRET_ARN=${aws_db_instance.main.master_user_secret[0].secret_arn}
    ENV
  EOT

  tags = { Name = "swimsync-app-${count.index}" }
}
