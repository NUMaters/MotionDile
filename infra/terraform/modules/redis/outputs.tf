output "redis_endpoint" {
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
  description = "Redis プライマリエンドポイント（host のみ）"
}

output "redis_port" {
  value = aws_elasticache_replication_group.this.port
}

output "redis_addr" {
  value       = "${aws_elasticache_replication_group.this.primary_endpoint_address}:${aws_elasticache_replication_group.this.port}"
  description = "GAME_REDIS_ADDR に渡す host:port"
}

output "security_group_id" {
  value = aws_security_group.redis.id
}

output "cluster_id" {
  value       = aws_elasticache_replication_group.this.id
  description = "ElastiCache Replication Group ID（CloudWatch メトリクス用）"
}
