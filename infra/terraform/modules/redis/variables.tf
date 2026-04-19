variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "ElastiCache を配置する private subnet"
}

variable "allowed_security_group_ids" {
  type        = list(string)
  description = "Redis へのアクセスを許可する SG ID（game task 等）"
}

variable "node_type" {
  type        = string
  default     = "cache.t3.micro"
  description = "ElastiCache ノードタイプ（最小コスト: cache.t3.micro）"
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "num_cache_nodes" {
  type    = number
  default = 1
}

variable "tags" {
  type    = map(string)
  default = {}
}
