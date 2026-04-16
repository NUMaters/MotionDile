data "aws_caller_identity" "current" {}

locals {
  alb_origin_id = "alb-game-backend"
  has_alb_proxy = var.game_backend_alb_dns != ""
}

resource "aws_s3_bucket" "site" {
  bucket = "${var.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name_prefix}-oac"
  description                       = "OAC for ${var.name_prefix} frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix} frontend"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.site.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  dynamic "origin" {
    for_each = local.has_alb_proxy ? [var.game_backend_alb_dns] : []
    content {
      domain_name = origin.value
      origin_id   = local.alb_origin_id
      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "http-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = 120
        origin_keepalive_timeout = 5
      }
    }
  }

  # ALB 経由（API / WS / ヘルス）。S3 静的は default に任せる
  dynamic "ordered_cache_behavior" {
    for_each = local.has_alb_proxy ? toset(["/healthz", "/api/*", "/ws*"]) : []
    content {
      path_pattern           = ordered_cache_behavior.value
      allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = local.alb_origin_id
      compress               = true
      viewer_protocol_policy = "redirect-to-https"
      min_ttl                = 0
      default_ttl            = 0
      max_ttl                = 0

      forwarded_values {
        query_string = true
        headers      = ["*"]
        cookies {
          forward = "all"
        }
      }
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "s3-${aws_s3_bucket.site.id}"

    forwarded_values {
      query_string = false
      headers      = []
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  dynamic "custom_error_response" {
    for_each = var.spa_error_fallback ? [403, 404] : []
    content {
      error_code         = custom_error_response.value
      response_code      = 200
      response_page_path = "/index.html"
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == ""
    acm_certificate_arn            = var.acm_certificate_arn != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  # カスタムドメイン＋ ACM を使う場合のみ。デフォルト証明書のときは空にすること
  aliases = var.domain_aliases

  tags = var.tags

  depends_on = [aws_s3_bucket_public_access_block.site]
}

data "aws_iam_policy_document" "s3_cloudfront" {
  statement {
    sid    = "AllowCloudFrontRead"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.s3_cloudfront.json

  depends_on = [aws_cloudfront_distribution.site]
}
