output "ecr_game_backend_repository_url" {
  value = module.ecr_game.repository_url
}

output "ecr_agent_repository_url" {
  value = module.ecr_agent.repository_url
}

output "game_backend_alb_dns" {
  value       = module.game_backend.alb_dns_name
  description = "フロントの VITE_GAME_API_BASE / プロキシのベースに使うホスト（http://<dns>/api/v1）"
}

output "agent_alb_dns" {
  value       = module.agent.alb_dns_name
  description = "game-backend の環境変数 AGENT_URL に設定（例: http://<dns>）"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "frontend_cloudfront_url" {
  value       = length(module.static_frontend) > 0 ? module.static_frontend[0].cloudfront_url : null
  description = "フロント配信 URL（https://xxx.cloudfront.net）。ビルド成果物を S3 に sync 後、必要なら CloudFront 無効化"
}

output "frontend_s3_bucket_id" {
  value       = length(module.static_frontend) > 0 ? module.static_frontend[0].s3_bucket_id : null
  description = "フロント用 S3 バケット名（aws s3 sync の宛先）"
}

output "frontend_cloudfront_distribution_id" {
  value       = length(module.static_frontend) > 0 ? module.static_frontend[0].cloudfront_distribution_id : null
  description = "デプロイ後のキャッシュ無効化に使用（aws cloudfront create-invalidation）"
}
