variable "name" {
  type        = string
  description = "EKS cluster name."
}

variable "vpc_id" {
  type        = string
  description = "VPC ID."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the cluster."
}

variable "kubernetes_version" {
  type        = string
  description = "Kubernetes version."
}

variable "node_instance_type" {
  type        = string
  description = "EC2 instance type for nodes."
}

variable "node_desired_capacity" {
  type        = number
  description = "Desired node count."
}

variable "node_min_size" {
  type        = number
  description = "Minimum node count."
}

variable "node_max_size" {
  type        = number
  description = "Maximum node count."
}

variable "node_disk_size" {
  type        = number
  description = "Node root volume size (GiB)."
}

variable "access_entries" {
  type        = any
  description = "EKS access entries to create for cluster authentication/authorization."
  default     = {}
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply."
  default     = {}
}
