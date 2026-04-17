variable "name" {
  type        = string
  description = "Base name used for resources."
}

variable "domain_name" {
  type        = string
  description = "Primary domain for CloudFront."
}

variable "additional_domain_names" {
  type        = list(string)
  description = "Additional domain names for CloudFront/ACM."
  default     = []
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID."
}

variable "enable_cloudfront" {
  type        = bool
  description = "Whether to create CloudFront distribution and Route53 records."
  default     = true
}

variable "api_alb_dns_name" {
  type        = string
  description = "ALB DNS name for API/WebSocket origin (used for /api/*, /game-api/*, /ws, and /game-ws)."
  default     = ""
}

variable "s3_force_destroy" {
  type        = bool
  description = "Allow Terraform to delete S3 bucket with objects."
  default     = false
}

variable "cloudfront_price_class" {
  type        = string
  description = "CloudFront price class."
  default     = "PriceClass_200"
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}
