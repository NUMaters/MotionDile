output "cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name."
}

output "cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS cluster endpoint."
}

output "frontend_bucket_name" {
  value       = module.frontend.frontend_bucket_name
  description = "S3 bucket for frontend assets."
}

output "cloudfront_domain" {
  value       = module.frontend.cloudfront_domain
  description = "CloudFront distribution domain name."
}

output "alb_controller_role_arn" {
  value       = module.alb_controller.role_arn
  description = "IAM role ARN for AWS Load Balancer Controller service account."
}

output "ecr_game_backend" {
  value       = module.ecr_game_backend.repository_url
  description = "ECR repository for game backend image."
}

output "backend_image_uri" {
  value       = local.backend_image_uri
  description = "Resolved backend image URI used by Kubernetes deployment."
}

output "backend_namespace" {
  value       = kubernetes_namespace_v1.backend.metadata[0].name
  description = "Namespace where game backend is deployed."
}

output "api_alb_dns_name" {
  value       = local.api_alb_dns_name
  description = "ALB DNS name created from Kubernetes ingress."
}
