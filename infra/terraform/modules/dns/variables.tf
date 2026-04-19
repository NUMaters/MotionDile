variable "domain_name" {
  type        = string
  description = "ルートドメイン名（例: motiondile.net）"
}

variable "tags" {
  type    = map(string)
  default = {}
}
