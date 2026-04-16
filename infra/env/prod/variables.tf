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
}

variable "additional_domain_names" {
  type        = list(string)
  description = "Optional additional domain names for CloudFront ACM certificate."
  default     = []
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for domain validation and alias record."
}

variable "enable_cloudfront" {
  type        = bool
  description = "Whether to create CloudFront distribution and Route53 records."
  default     = true
}

variable "api_alb_dns_name" {
  type        = string
  description = "ALB DNS name created by AWS Load Balancer Controller (used as CloudFront origin for /api/*, /game-api/*, /ws, and /game-ws)."
  default     = ""
  validation {
    condition     = var.enable_cloudfront == false || length(var.api_alb_dns_name) > 0
    error_message = "api_alb_dns_name must be set when enable_cloudfront is true."
  }
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
  default     = "1.29"
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
  default     = false
}

variable "cloudfront_price_class" {
  type        = string
  description = "CloudFront price class."
  default     = "PriceClass_200"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags to apply to resources."
  default     = {}
}
