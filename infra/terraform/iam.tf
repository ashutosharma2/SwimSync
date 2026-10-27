# The app instances' role: Session Manager access and nothing else.

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "swimsync-app"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# AWS-managed policy for SSM Agent: registering with Systems Manager and Session Manager channels.
resource "aws_iam_role_policy_attachment" "app_ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "swimsync-app"
  role = aws_iam_role.app.name
}
