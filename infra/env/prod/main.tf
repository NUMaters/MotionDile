module "network" {
  source = "../../modules/network"

  name                 = local.name
  vpc_cidr             = var.vpc_cidr
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  azs                  = slice(data.aws_availability_zones.available.names, 0, length(var.private_subnet_cidrs))
  tags                 = local.tags
}

module "eks" {
  source = "../../modules/eks"

  name                  = local.name
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnets
  kubernetes_version    = var.kubernetes_version
  node_instance_type    = var.node_instance_type
  node_desired_capacity = var.node_desired_capacity
  node_min_size         = var.node_min_size
  node_max_size         = var.node_max_size
  node_disk_size        = var.node_disk_size
  access_entries        = local.eks_access_entries
  tags                  = local.tags
}

module "alb_controller" {
  source = "../../modules/iam_alb_controller"

  name                     = local.name
  cluster_oidc_provider     = module.eks.oidc_provider
  cluster_oidc_provider_arn = module.eks.oidc_provider_arn
  tags                      = local.tags
}

module "frontend" {
  source = "../../modules/frontend"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                    = local.name
  domain_name             = var.domain_name
  additional_domain_names = var.additional_domain_names
  route53_zone_id         = var.route53_zone_id
  enable_cloudfront       = var.enable_cloudfront
  api_alb_dns_name        = var.api_alb_dns_name
  s3_force_destroy        = var.s3_force_destroy
  cloudfront_price_class  = var.cloudfront_price_class
  tags                    = local.tags
}

module "ecr_game_backend" {
  source = "../../modules/ecr"

  name = "${local.name}-game-backend"
  tags = local.tags
}
