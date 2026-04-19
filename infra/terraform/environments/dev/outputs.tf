output "ecr_game_backend_repository_url" {
  value = module.ecr_game.repository_url
}

output "ecr_agent_repository_url" {
  value = module.ecr_agent.repository_url
}

output "game_backend_alb_dns" {
  value       = module.game_backend.alb_dns_name
  description = "フロントの VITE_GAME_API_BASE / プロキシのベースに使うホスト"
}

output "agent_alb_dns" {
  value       = module.agent.alb_dns_name
  description = "Agent Internal ALB DNS（外部非公開）。game-backend の AGENT_URL に自動設定済み"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "frontend_cloudfront_url" {
  value       = length(module.static_frontend) > 0 ? module.static_frontend[0].cloudfront_url : null
  description = "フロント配信 URL"
}

output "frontend_s3_bucket_id" {
  value       = length(module.static_frontend) > 0 ? module.static_frontend[0].s3_bucket_id : null
  description = "フロント用 S3 バケット名"
}

output "frontend_cloudfront_distribution_id" {
  value       = length(module.static_frontend) > 0 ? module.static_frontend[0].cloudfront_distribution_id : null
  description = "デプロイ後のキャッシュ無効化に使用"
}

output "redis_addr" {
  value       = var.enable_redis && length(module.redis) > 0 ? module.redis[0].redis_addr : ""
  description = "ElastiCache Redis エンドポイント (host:port)"
}

output "vpc_private_subnet_ids" {
  value = module.vpc.private_subnet_ids
}

# ==================== DNS ====================

output "name_servers" {
  value       = var.domain_name != "" ? module.dns[0].name_servers : []
  description = "お名前.com に設定するネームサーバー一覧"
}

output "custom_domain_url" {
  value       = var.domain_name != "" ? "https://${var.domain_name}" : null
  description = "独自ドメイン URL"
}

output "cloudwatch_dashboard_url" {
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${module.monitoring.dashboard_name}"
  description = "CloudWatch ダッシュボード URL"
}

output "waf_web_acl_arn" {
  value       = var.enable_waf ? module.waf[0].web_acl_arn : ""
  description = "WAF Web ACL ARN"
}
