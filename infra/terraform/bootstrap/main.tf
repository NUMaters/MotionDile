terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "project_name" {
  type    = string
  default = "waniar"
}

# State を保存する S3 バケット
resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.project_name}-terraform-state-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name      = "Terraform State"
    Project   = var.project_name
    ManagedBy = "terraform-bootstrap"
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 排他ロック用 DynamoDB テーブル
resource "aws_dynamodb_table" "tflock" {
  name         = "${var.project_name}-terraform-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name      = "Terraform Lock"
    Project   = var.project_name
    ManagedBy = "terraform-bootstrap"
  }
}

output "s3_bucket_name" {
  value = aws_s3_bucket.tfstate.id
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.tflock.name
}

output "backend_config" {
  value = <<-EOT
    # infra/terraform/environments/dev/backend.tf に追加:
    terraform {
      backend "s3" {
        bucket         = "${aws_s3_bucket.tfstate.id}"
        key            = "dev/terraform.tfstate"
        region         = "${var.aws_region}"
        dynamodb_table = "${aws_dynamodb_table.tflock.name}"
        encrypt        = true
      }
    }
  EOT
}
