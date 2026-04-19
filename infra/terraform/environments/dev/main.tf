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
  tags = local.default_tags
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
  autoscaling_min_capacity   = 1
  autoscaling_max_capacity   = 5
  autoscaling_cpu_target     = 60

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
  alb_idle_timeout       = 120 # WebSocket 向け
  alb_ssl_certificate_arn = local.effective_alb_acm_arn

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
  autoscaling_min_capacity        = var.enable_redis ? 2 : 1
  autoscaling_max_capacity        = 20
  autoscaling_cpu_target          = 60
  autoscaling_memory_target       = 70
  autoscaling_requests_per_target = 1000

  tags = local.default_tags
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
  # CloudFront → ALB は HTTP で接続（ALB 証明書は motiondile.net 用で *.elb.amazonaws.com に一致しないため）
  alb_origin_protocol_policy = "http-only"
  waf_acl_arn                = var.waf_acl_arn
}
