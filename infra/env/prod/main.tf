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

  name                      = local.name
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
  api_alb_dns_name        = local.api_alb_dns_name
  s3_force_destroy        = var.s3_force_destroy
  cloudfront_price_class  = var.cloudfront_price_class
  tags                    = local.tags

  depends_on = [kubernetes_ingress_v1.game_backend]
}

module "ecr_game_backend" {
  source = "../../modules/ecr"

  name         = "${local.name}-game-backend"
  force_delete = var.ecr_force_delete
  tags         = local.tags
}

resource "helm_release" "aws_load_balancer_controller" {
  name             = "aws-load-balancer-controller"
  repository       = "https://aws.github.io/eks-charts"
  chart            = "aws-load-balancer-controller"
  namespace        = "kube-system"
  create_namespace = false
  timeout          = 600

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.alb_controller.role_arn
  }

  set {
    name  = "region"
    value = var.aws_region
  }

  set {
    name  = "vpcId"
    value = module.network.vpc_id
  }

  depends_on = [module.eks, module.alb_controller]
}

resource "kubernetes_namespace_v1" "backend" {
  metadata {
    name = var.backend_namespace
  }

  depends_on = [module.eks]
}

resource "kubernetes_deployment_v1" "game_backend" {
  metadata {
    name      = var.backend_name
    namespace = kubernetes_namespace_v1.backend.metadata[0].name
    labels = {
      app = var.backend_name
    }
  }

  spec {
    replicas = var.backend_replicas

    selector {
      match_labels = {
        app = var.backend_name
      }
    }

    template {
      metadata {
        labels = {
          app = var.backend_name
        }
      }

      spec {
        container {
          name              = var.backend_name
          image             = local.backend_image_uri
          image_pull_policy = "Always"

          port {
            container_port = var.backend_port
          }

          env {
            name  = "GAME_BACKEND_ADDR"
            value = "0.0.0.0:${var.backend_port}"
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace_v1.backend]
}

resource "kubernetes_service_v1" "game_backend" {
  metadata {
    name      = var.backend_name
    namespace = kubernetes_namespace_v1.backend.metadata[0].name
  }

  spec {
    selector = {
      app = var.backend_name
    }

    port {
      name        = "http"
      port        = var.backend_service_port
      target_port = var.backend_port
      protocol    = "TCP"
    }
  }

  depends_on = [kubernetes_deployment_v1.game_backend]
}

resource "kubernetes_ingress_v1" "game_backend" {
  wait_for_load_balancer = true

  metadata {
    name      = var.backend_name
    namespace = kubernetes_namespace_v1.backend.metadata[0].name

    annotations = {
      "alb.ingress.kubernetes.io/scheme"           = "internet-facing"
      "alb.ingress.kubernetes.io/target-type"      = "ip"
      "alb.ingress.kubernetes.io/listen-ports"     = "[{\"HTTP\":80}]"
      "alb.ingress.kubernetes.io/healthcheck-path" = "/healthz"
    }
  }

  spec {
    ingress_class_name = "alb"

    rule {
      http {
        path {
          path      = "/api"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.game_backend.metadata[0].name
              port {
                number = var.backend_service_port
              }
            }
          }
        }

        path {
          path      = "/ws"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.game_backend.metadata[0].name
              port {
                number = var.backend_service_port
              }
            }
          }
        }
      }
    }
  }

  depends_on = [
    helm_release.aws_load_balancer_controller,
    kubernetes_service_v1.game_backend
  ]
}
