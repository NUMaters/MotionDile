output "web_acl_arn" {
  value       = aws_wafv2_web_acl.this.arn
  description = "CloudFront に関連付ける WAF Web ACL ARN"
}

output "web_acl_id" {
  value = aws_wafv2_web_acl.this.id
}
