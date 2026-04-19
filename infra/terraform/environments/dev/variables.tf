variable "domain_name" {
  type        = string
  default     = ""
  description = "独自ドメイン名（例: motiondile.net）。設定すると Route 53 + ACM を自動作成。空なら *.cloudfront.net のみ"
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "project_name" {
  type        = string
  description = "リソース名の接頭辞（英小文字・短め推奨）"
  default     = "waniar"
}

variable "game_backend_image" {
  type        = string
  description = "game-backend コンテナイメージ（ECR の digest 推奨）"
}

variable "agent_image" {
  type        = string
  description = "Agent コンテナイメージ"
}

variable "agent_bedrock_model_id" {
  type        = string
  default     = "anthropic.claude-3-haiku-20240307-v1:0"
  description = "Amazon Bedrock のモデル ID"
}

variable "game_agent_url" {
  type        = string
  description = "game-backend に渡す AGENT_URL（Agent Internal ALB の http://... を設定）"
  default     = ""
}

variable "enable_static_frontend" {
  type        = bool
  default     = true
  description = "S3 + CloudFront で game/frontend の静的配信リソースを作成する"
}

variable "frontend_acm_certificate_arn" {
  type        = string
  default     = ""
  description = "カスタムドメイン用 ACM 証明書 ARN（us-east-1）"
}

variable "frontend_domain_aliases" {
  type        = list(string)
  default     = []
  description = "CloudFront の代替ドメイン（お名前.com で管理する独自ドメイン）"
}

variable "frontend_spa_error_fallback" {
  type        = bool
  default     = true
  description = "403/404 を /index.html にフォールバック（クライアントルーティング向け）"
}

variable "frontend_cloudfront_price_class" {
  type        = string
  default     = "PriceClass_200"
  description = "CloudFront PriceClass"
}

variable "alb_acm_certificate_arn" {
  type        = string
  default     = ""
  description = "game ALB 用 HTTPS 証明書 ARN（ap-northeast-1 の ACM）"
}

variable "waf_acl_arn" {
  type        = string
  default     = ""
  description = "CloudFront に関連付ける WAF Web ACL ARN"
}

variable "enable_redis" {
  type        = bool
  default     = true
  description = "ElastiCache Redis を作成する"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.micro"
}

variable "tags" {
  type    = map(string)
  default = {}
}
