output "sns_topic_arn" {
  value = local.sns_topic_arn
}

output "dashboard_name" {
  value       = aws_cloudwatch_dashboard.main.dashboard_name
  description = "CloudWatch ダッシュボード名"
}
