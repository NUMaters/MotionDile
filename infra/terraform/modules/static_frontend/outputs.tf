output "s3_bucket_id" {
  value = aws_s3_bucket.site.id
}

output "s3_bucket_arn" {
  value = aws_s3_bucket.site.arn
}

output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "フロント配信用（https://<この値>）"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_hosted_zone_id" {
  value       = aws_cloudfront_distribution.site.hosted_zone_id
  description = "Route 53 ALIAS レコード用"
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.site.domain_name}"
}
