variable "name" {
  type        = string
  description = "ECR repository name."
}

variable "force_delete" {
  type        = bool
  description = "Allow deleting repository even when images remain."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}
