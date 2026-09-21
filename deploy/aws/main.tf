data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }
data "aws_ami" "linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023*-kernel-6.1-x86_64"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_vpc" "game" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
  lifecycle { prevent_destroy = true }
}

resource "aws_subnet" "game" {
  vpc_id                  = aws_vpc.game.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 0)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name}-public" }
}

resource "aws_internet_gateway" "game" {
  vpc_id = aws_vpc.game.id
  tags   = { Name = var.name }
}

resource "aws_route_table" "game" {
  vpc_id = aws_vpc.game.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.game.id
  }
  tags = { Name = var.name }
}

resource "aws_route_table_association" "game" {
  subnet_id      = aws_subnet.game.id
  route_table_id = aws_route_table.game.id
}

resource "aws_security_group" "game" {
  name        = var.name
  description = "Farfield HTTPS and certificate issuance only; administration through SSM"
  vpc_id      = aws_vpc.game.id
  ingress {
    description = "HTTP redirect and ACME"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP/3"
    from_port   = 443
    to_port     = 443
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = var.name }
}

resource "aws_s3_bucket" "backups" {
  bucket = "${var.name}-backups-${data.aws_caller_identity.current.account_id}"
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "RequireTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_iam_role" "game" {
  name = var.name
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "ssm" {
  name = "farfield-ssm-agent"
  role = aws_iam_role.game.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AgentRegistrationAndChannels"
        Effect = "Allow"
        Action = [
          "ssm:UpdateInstanceInformation",
          "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel",
          "ec2messages:AcknowledgeMessage", "ec2messages:DeleteMessage",
          "ec2messages:FailMessage", "ec2messages:GetEndpoint",
          "ec2messages:GetMessages", "ec2messages:SendReply"
        ]
        Resource = "*"
      },
      {
        Sid      = "ReadAWSRunShellDocument"
        Effect   = "Allow"
        Action   = ["ssm:GetDocument", "ssm:DescribeDocument"]
        Resource = "arn:aws:ssm:${var.region}::document/AWS-RunShellScript"
      }
    ]
  })
}

resource "aws_iam_role_policy" "backups" {
  name = "farfield-backup-write-only"
  role = aws_iam_role.game.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.backups.arn}/backups/*"
    }]
  })
}

resource "aws_iam_instance_profile" "game" {
  name = var.name
  role = aws_iam_role.game.name
}

resource "aws_instance" "game" {
  ami                         = data.aws_ami.linux.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.game.id
  vpc_security_group_ids      = [aws_security_group.game.id]
  iam_instance_profile        = aws_iam_instance_profile.game.name
  associate_public_ip_address = true
  disable_api_termination     = true
  user_data                   = file("${path.module}/bootstrap.sh")
  user_data_replace_on_change = false
  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 40
    encrypted             = true
    delete_on_termination = false
    tags                  = { Name = "${var.name}-data", Project = "Farfield", Environment = "production" }
  }
  tags = { Name = var.name }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [ami]
  }
  depends_on = [aws_route_table_association.game, aws_iam_role_policy.ssm]
}

resource "aws_eip" "game" {
  domain   = "vpc"
  instance = aws_instance.game.id
  tags     = { Name = var.name }
  lifecycle { prevent_destroy = true }
  depends_on = [aws_internet_gateway.game]
}

resource "aws_cloudwatch_metric_alarm" "status" {
  alarm_name          = "${var.name}-status"
  alarm_description   = "Farfield instance status failure; inspect through SSM. Configure notifications separately."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  dimensions          = { InstanceId = aws_instance.game.id }
  treat_missing_data  = "breaching"
}

resource "aws_cloudwatch_metric_alarm" "cpu_credits" {
  alarm_name          = "${var.name}-cpu-credits"
  alarm_description   = "Low burst credits can slow matches. Standard credits prevent surplus charges."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUCreditBalance"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Minimum"
  threshold           = 24
  dimensions          = { InstanceId = aws_instance.game.id }
  treat_missing_data  = "notBreaching"
}
