output "redis_endpoint" {
  value       = aws_elasticache_cluster.this.cache_nodes[0].address
  description = "Redis プライマリエンドポイント（host のみ）"
}

output "redis_port" {
  value = aws_elasticache_cluster.this.cache_nodes[0].port
}

output "redis_addr" {
  value       = "${aws_elasticache_cluster.this.cache_nodes[0].address}:${aws_elasticache_cluster.this.cache_nodes[0].port}"
  description = "GAME_REDIS_ADDR に渡す host:port"
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
