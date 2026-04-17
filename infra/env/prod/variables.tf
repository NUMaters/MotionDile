variable "project_name" {
  type        = string
  description = "Project name used for tagging and resource naming."
  default     = "waniar"
}

variable "environment" {
  type        = string
  description = "Environment name."
  default     = "prod"
}

variable "aws_region" {
  type        = string
  description = "AWS region for primary resources."
  default     = "ap-northeast-1"
}

variable "domain_name" {
  type        = string
  description = "Primary domain for CloudFront (same domain for frontend and API paths)."
  default     = ""
  validation {
    condition     = var.enable_cloudfront == false || trimspace(var.domain_name) != ""
    error_message = "domain_name must be set when enable_cloudfront is true."
  }
}

variable "additional_domain_names" {
  type        = list(string)
  description = "Optional additional domain names for CloudFront ACM certificate."
  default     = []
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for domain validation and alias record."
  default     = ""
  validation {
    condition     = var.enable_cloudfront == false || trimspace(var.route53_zone_id) != ""
    error_message = "route53_zone_id must be set when enable_cloudfront is true."
  }
}

variable "enable_cloudfront" {
  type        = bool
  description = "Whether to create CloudFront distribution and Route53 records."
  default     = true
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block."
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "Public subnet CIDR blocks."
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "Private subnet CIDR blocks."
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "kubernetes_version" {
  type        = string
  description = "EKS Kubernetes version."
  default     = "1.30"
}

variable "enable_current_caller_cluster_admin" {
  type        = bool
  description = "Whether to grant current Terraform caller cluster-admin access via EKS Access Entry."
  default     = true
}

variable "eks_cluster_admin_principal_arns" {
  type        = list(string)
  description = "Additional IAM principal ARNs to grant cluster-admin access via EKS Access Entries."
  default     = []
  validation {
    condition     = var.enable_current_caller_cluster_admin || length(var.eks_cluster_admin_principal_arns) > 0
    error_message = "Set at least one eks_cluster_admin_principal_arns entry when enable_current_caller_cluster_admin is false."
  }
}

variable "node_instance_type" {
  type        = string
  description = "Instance type for EKS managed node group."
  default     = "t3.medium"
}

variable "node_desired_capacity" {
  type        = number
  description = "Desired node count (set to 1 for single replica operations)."
  default     = 1
}

variable "node_min_size" {
  type        = number
  description = "Minimum node count."
  default     = 1
}

variable "node_max_size" {
  type        = number
  description = "Maximum node count."
  default     = 1
}

variable "node_disk_size" {
  type        = number
  description = "Node root volume size (GiB)."
  default     = 20
}

variable "s3_force_destroy" {
  type        = bool
  description = "Allow Terraform to delete the frontend bucket even if it contains objects."
  default     = true
}

variable "cloudfront_price_class" {
  type        = string
  description = "CloudFront price class."
  default     = "PriceClass_200"
}

variable "ecr_force_delete" {
  type        = bool
  description = "Allow Terraform to delete ECR repository even if images remain."
  default     = true
}

variable "backend_namespace" {
  type        = string
  description = "Kubernetes namespace for the game backend."
  default     = "waniar"
}

variable "backend_name" {
  type        = string
  description = "Kubernetes resource name for the game backend."
  default     = "game-backend"
}

variable "backend_replicas" {
  type        = number
  description = "Replica count for the game backend deployment."
  default     = 1
}

variable "backend_port" {
  type        = number
  description = "Container port exposed by game backend."
  default     = 8090
}

variable "backend_service_port" {
  type        = number
  description = "Service port exposed inside the cluster."
  default     = 80
}

variable "backend_image_uri" {
  type        = string
  description = "Explicit backend image URI. Leave empty to use ECR repository + backend_image_tag."
  default     = ""
}

variable "backend_image_tag" {
  type        = string
  description = "Image tag used when backend_image_uri is empty."
  default     = "latest"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags to apply to resources."
  default     = {}
}
