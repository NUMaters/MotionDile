variable "name_prefix" {
  type        = string
  description = "リソース名の接頭辞"
}

variable "cidr_block" {
  type    = string
  default = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "パブリックサブネット CIDR（AZ 数と同じ個数）"
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
