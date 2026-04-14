variable "name" {
  type        = string
  description = "Base name for resources."
}

variable "cluster_oidc_provider" {
  type        = string
  description = "OIDC provider URL for the cluster."
}

variable "cluster_oidc_provider_arn" {
  type        = string
  description = "OIDC provider ARN for the cluster."
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}
