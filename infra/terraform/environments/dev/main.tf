locals {
  default_tags = merge(
    {
      Project   = var.project_name
      ManagedBy = "terraform"
    },
    var.tags,
  )

  # dns モジュール有効時は自動で ACM ARN が入る
  effective_frontend_acm_arn = var.domain_name != "" ? module.dns[0].cloudfront_acm_arn : var.frontend_acm_certificate_arn
  effective_alb_acm_arn      = var.domain_name != "" ? module.dns[0].alb_acm_arn : var.alb_acm_certificate_arn
  effective_domain_aliases   = var.domain_name != "" ? [var.domain_name] : var.frontend_domain_aliases
}

# ==================== DNS (Route 53 + ACM) ====================

module "dns" {
  count  = var.domain_name != "" ? 1 : 0
  source = "../../modules/dns"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  domain_name = var.domain_name
  tags        = local.default_tags
}

# CloudFront ALIAS レコード（ドメイン → CloudFront ディストリビューション）
resource "aws_route53_record" "frontend" {
  count   = var.domain_name != "" && var.enable_static_frontend ? 1 : 0
  zone_id = module.dns[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.static_frontend[0].cloudfront_domain_name
    zone_id                = module.static_frontend[0].cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# ==================== VPC ====================

module "vpc" {
  source = "../../modules/vpc"

  name_prefix          = var.project_name
  cidr_block           = "10.0.0.0/16"
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24"]
  enable_vpc_endpoints = true
  tags                 = local.default_tags
}

# ==================== ECR ====================

module "ecr_game" {
  source = "../../modules/ecr"

  repository_name = "${var.project_name}-game-backend"
  tags            = local.default_tags
}

module "ecr_agent" {
  source = "../../modules/ecr"

  repository_name = "${var.project_name}-agent"
  tags            = local.default_tags
}

# ==================== ECS Cluster ====================

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.default_tags
}

# ==================== ALB Access Logs S3 Bucket ====================

data "aws_caller_identity" "current" {}

data "aws_elb_service_account" "main" {}

resource "aws_s3_bucket" "alb_logs" {
  bucket = "${var.project_name}-alb-logs-${data.aws_caller_identity.current.account_id}"
  tags   = local.default_tags
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = data.aws_elb_service_account.main.arn
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.alb_logs.arn}/*"
      }
    ]
  })
}

# ==================== Redis (ElastiCache) ====================

module "redis" {
  count  = var.enable_redis ? 1 : 0
  source = "../../modules/redis"

  name_prefix        = var.project_name
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type

  # game-backend タスクからのみ Redis へアクセス許可
  allowed_security_group_ids = [module.game_backend.task_security_group_id]

  tags = local.default_tags
}

# ==================== Agent (Internal, Private, Bedrock 専用) ====================

module "agent" {
  source = "../../modules/fargate_service"

  name_prefix       = "${var.project_name}-agent"
  aws_region        = var.aws_region
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  task_subnet_ids   = module.vpc.private_subnet_ids
  cluster_arn       = aws_ecs_cluster.main.id

  container_image = var.agent_image
  container_port  = 8091
  cpu             = 256
  memory          = 512

  health_check_path = "/health"

  # Private subnet + Internal ALB + no public IP
  assign_public_ip = false
  internal         = true

  environment = {
    AGENT_PORT       = "8091"
    AWS_REGION       = var.aws_region
    BEDROCK_MODEL_ID = var.agent_bedrock_model_id
  }

  bedrock_invoke_model_arns = [
    "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.agent_bedrock_model_id}",
  ]

  # Auto Scaling: Agent
  enable_autoscaling         = true
  autoscaling_min_capacity   = var.agent_autoscaling_min
  autoscaling_max_capacity   = var.agent_autoscaling_max
  autoscaling_cpu_target     = 60

  # ALB Access Logs
  enable_alb_access_logs = true
  alb_access_logs_bucket = aws_s3_bucket.alb_logs.id
  alb_access_logs_prefix = "agent"

  tags = local.default_tags
}

# ==================== Game Backend (Public ALB, Private Tasks) ====================

module "game_backend" {
  source = "../../modules/fargate_service"

  name_prefix       = "${var.project_name}-game"
  aws_region        = var.aws_region
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  task_subnet_ids   = module.vpc.private_subnet_ids
  cluster_arn       = aws_ecs_cluster.main.id

  container_image = var.game_backend_image
  container_port  = 8090
  cpu             = 512
  memory          = 1024

  health_check_path = "/healthz"

  # Private subnet + public-facing ALB + no public IP on tasks
  assign_public_ip       = false
  internal               = false
  alb_idle_timeout        = 120
  alb_ssl_certificate_arn = local.effective_alb_acm_arn
  enable_https            = var.domain_name != ""

  desired_count = var.enable_redis ? 2 : 1

  environment = merge(
    {
      "GAME_BACKEND_ADDR" = "0.0.0.0:8090"
    },
    var.game_agent_url != "" ? { "AGENT_URL" = var.game_agent_url } : (
      # Agent Internal ALB の DNS を自動設定
      { "AGENT_URL" = "http://${module.agent.alb_dns_name}" }
    ),
    var.enable_redis && length(module.redis) > 0 ? {
      "GAME_REDIS_ADDR"       = module.redis[0].redis_addr
      "GAME_REDIS_KEY_PREFIX" = var.project_name
    } : {},
        length(local.effective_domain_aliases) > 0 ? {
      "CORS_ALLOWED_ORIGINS"  = join(",", [for d in local.effective_domain_aliases : "https://${d}"])
      "WS_ALLOWED_ORIGINS"    = join(",", [for d in local.effective_domain_aliases : "https://${d}"])
    } : {},
  )

  # Auto Scaling: Game Backend
  enable_autoscaling              = true
  autoscaling_min_capacity        = var.enable_redis ? var.game_autoscaling_min : 1
  autoscaling_max_capacity        = var.game_autoscaling_max
  autoscaling_cpu_target          = 60
  autoscaling_memory_target       = 70
  autoscaling_requests_per_target = 1000

  # ALB Access Logs
  enable_alb_access_logs = true
  alb_access_logs_bucket = aws_s3_bucket.alb_logs.id
  alb_access_logs_prefix = "game"

  tags = local.default_tags
}

# ==================== WAF ====================

module "waf" {
  count  = var.enable_waf ? 1 : 0
  source = "../../modules/waf"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = var.project_name
  rate_limit  = var.waf_rate_limit
  tags        = local.default_tags
}

# ==================== Static Frontend (S3 + CloudFront + WAF) ====================

module "static_frontend" {
  count  = var.enable_static_frontend ? 1 : 0
  source = "../../modules/static_frontend"

  name_prefix                = var.project_name
  tags                       = local.default_tags
  acm_certificate_arn        = local.effective_frontend_acm_arn
  domain_aliases             = local.effective_domain_aliases
  spa_error_fallback         = var.frontend_spa_error_fallback
  cloudfront_price_class     = var.frontend_cloudfront_price_class
  game_backend_alb_dns       = module.game_backend.alb_dns_name
  alb_origin_protocol_policy = "http-only"
  waf_acl_arn                = var.enable_waf ? module.waf[0].web_acl_arn : var.waf_acl_arn
}

# ==================== Monitoring (CloudWatch Alarms + Dashboard) ====================

module "monitoring" {
  source = "../../modules/monitoring"

  name_prefix      = var.project_name
  aws_region       = var.aws_region
  ecs_cluster_name = aws_ecs_cluster.main.name
  alarm_email      = var.alarm_email

  ecs_services = {
    "${var.project_name}-game" = {
      service_name     = module.game_backend.service_name
      alb_arn_suffix   = module.game_backend.alb_arn_suffix
      cpu_threshold    = 80
      memory_threshold = 85
    }
    "${var.project_name}-agent" = {
      service_name     = module.agent.service_name
      alb_arn_suffix   = module.agent.alb_arn_suffix
      cpu_threshold    = 80
      memory_threshold = 85
    }
  }

  redis_cluster_id           = var.enable_redis && length(module.redis) > 0 ? module.redis[0].cluster_id : ""
  enable_redis_alarms        = var.enable_redis
  cloudfront_distribution_id = var.enable_static_frontend && length(module.static_frontend) > 0 ? module.static_frontend[0].cloudfront_distribution_id : ""
  enable_cloudfront_alarms   = var.enable_static_frontend

  tags = local.default_tags
}
