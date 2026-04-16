locals {
  default_tags = merge(
    {
      Project   = var.project_name
      ManagedBy = "terraform"
    },
    var.tags,
  )

  # カスタムドメインと ACM は両方セットか、両方空（デフォルト CloudFront ドメイン）
  frontend_cert_aliases_ok = (length(var.frontend_domain_aliases) == 0 && var.frontend_acm_certificate_arn == "") || (length(var.frontend_domain_aliases) > 0 && var.frontend_acm_certificate_arn != "")
}

check "frontend_cert_aliases" {
  assert {
    condition     = local.frontend_cert_aliases_ok
    error_message = "カスタムドメインを使う場合は frontend_domain_aliases と frontend_acm_certificate_arn の両方を設定し、デフォルト *.cloudfront.net のみなら両方空にしてください。"
  }
}

module "vpc" {
  source = "../../modules/vpc"

  name_prefix         = var.project_name
  cidr_block          = "10.0.0.0/16"
  public_subnet_cidrs = ["10.0.1.0/24", "10.0.2.0/24"]
  tags                = local.default_tags
}

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

resource "aws_secretsmanager_secret" "agent_openai" {
  count = var.agent_openai_api_key != "" ? 1 : 0
  name  = "${var.project_name}/agent/openai-api-key"
  tags  = local.default_tags
}

resource "aws_secretsmanager_secret_version" "agent_openai" {
  count         = var.agent_openai_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.agent_openai[0].id
  secret_string = var.agent_openai_api_key
}

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"
  tags = local.default_tags
}

module "agent" {
  source = "../../modules/fargate_service"

  name_prefix       = "${var.project_name}-agent"
  aws_region        = var.aws_region
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  cluster_arn       = aws_ecs_cluster.main.id

  container_image = var.agent_image
  container_port  = 8091
  cpu             = 256
  memory          = 512

  health_check_path = "/health"

  environment = {
    AGENT_PORT       = "8091"
    AWS_REGION       = var.aws_region
    BEDROCK_MODEL_ID = var.agent_bedrock_model_id
  }

  bedrock_invoke_model_arns = [
    "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.agent_bedrock_model_id}",
  ]

  secrets = var.agent_openai_api_key != "" ? {
    OPENAI_API_KEY = aws_secretsmanager_secret.agent_openai[0].arn
  } : {}

  tags = local.default_tags
}

module "game_backend" {
  source = "../../modules/fargate_service"

  name_prefix       = "${var.project_name}-game"
  aws_region        = var.aws_region
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  cluster_arn       = aws_ecs_cluster.main.id

  container_image = var.game_backend_image
  container_port  = 8090
  cpu             = 512
  memory          = 1024

  health_check_path = "/healthz"

  environment = merge(
    {
      "GAME_BACKEND_ADDR" = "0.0.0.0:8090"
    },
    var.game_agent_url != "" ? { "AGENT_URL" = var.game_agent_url } : {},
  )

  tags = local.default_tags
}

module "static_frontend" {
  count  = var.enable_static_frontend ? 1 : 0
  source = "../../modules/static_frontend"

  name_prefix            = var.project_name
  tags                   = local.default_tags
  acm_certificate_arn    = var.frontend_acm_certificate_arn
  domain_aliases         = var.frontend_domain_aliases
  spa_error_fallback     = var.frontend_spa_error_fallback
  cloudfront_price_class = var.frontend_cloudfront_price_class
  game_backend_alb_dns   = module.game_backend.alb_dns_name
}
