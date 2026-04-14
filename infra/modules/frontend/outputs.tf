output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend.bucket
  description = "S3 bucket for frontend assets."
}

output "cloudfront_domain" {
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].domain_name : null
  description = "CloudFront distribution domain name."
}
