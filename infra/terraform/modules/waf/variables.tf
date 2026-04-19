variable "name_prefix" {
  type = string
}

variable "rate_limit" {
  type        = number
  default     = 2000
  description = "5分間あたりの IP ごとリクエスト上限"
}

variable "tags" {
  type    = map(string)
  default = {}
}
