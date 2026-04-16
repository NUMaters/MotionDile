variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "spa_error_fallback" {
  type        = bool
  default     = true
  description = "403/404 を index.html にフォールバック（Vue 等のクライアントルーティング向け）"
}

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_200"
}

variable "acm_certificate_arn" {
  type        = string
  default     = ""
  description = "カスタムドメイン用。us-east-1 の ACM ARN。空なら *.cloudfront.net のデフォルト証明書"
}

variable "domain_aliases" {
  type        = list(string)
  default     = []
  description = "CloudFront の代替ドメイン名（証明書と整合させること）"
}

variable "game_backend_alb_dns" {
  type        = string
  default     = ""
  description = "game-backend ALB の DNS 名（例: xxx.elb.amazonaws.com）。空でなければ CloudFront が /api /ws /healthz を ALB にプロキシ（HTTPS ページからの混合コンテンツ回避）"
}
