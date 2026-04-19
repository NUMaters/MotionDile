output "zone_id" {
  value       = aws_route53_zone.main.zone_id
  description = "Route 53 ホストゾーン ID"
}

output "name_servers" {
  value       = aws_route53_zone.main.name_servers
  description = "お名前.com に設定するネームサーバー一覧"
}

output "cloudfront_acm_arn" {
  value       = aws_acm_certificate_validation.cloudfront.certificate_arn
  description = "CloudFront 用 ACM 証明書 ARN (us-east-1)"
}

output "alb_acm_arn" {
  value       = aws_acm_certificate_validation.alb.certificate_arn
  description = "ALB 用 ACM 証明書 ARN (ap-northeast-1)"
}
