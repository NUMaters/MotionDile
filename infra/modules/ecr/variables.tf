variable "name" {
  type        = string
  description = "ECR repository name."
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}
