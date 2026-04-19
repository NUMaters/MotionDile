resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "ElastiCache Redis (${var.name_prefix})"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = var.allowed_security_group_ids
    content {
      description     = "Redis from ${ingress.value}"
      from_port       = 6379
      to_port         = 6379
      protocol        = "tcp"
      security_groups = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis-sg" })
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis-subnet"
  subnet_ids = var.private_subnet_ids

  tags = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = substr(replace("${var.name_prefix}-redis", "_", "-"), 0, 40)
  description          = "${var.name_prefix} Redis replication group"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_nodes
  port                 = 6379
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = var.transit_encryption_enabled

  automatic_failover_enabled = var.num_cache_nodes > 1
  multi_az_enabled           = var.num_cache_nodes > 1

  snapshot_retention_limit = var.snapshot_retention_days
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:07:00"

  auto_minor_version_upgrade = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis" })
}
