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

variable "agent_openai_api_key" {
  type        = string
  description = "任意: OpenAI にフォールバックする場合のキー。空でなければ Secrets Manager に保存し ECS が注入（Bedrock 優先時は未設定でよい）"
  sensitive   = true
  default     = ""
}

variable "agent_bedrock_model_id" {
  type        = string
  default     = "anthropic.claude-3-haiku-20240307-v1:0"
  description = "Amazon Bedrock のモデル ID（コスト重視なら Claude 3 Haiku 推奨。コンソールでモデルアクセスを有効化すること）"
}

variable "game_agent_url" {
  type        = string
  description = "game-backend に渡す AGENT_URL（apply 後に Agent ALB DNS を入れて再 apply するか、空で手動設定）"
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
  description = "カスタムドメイン用 ACM 証明書 ARN（us-east-1）。空なら CloudFront デフォルト証明書（*.cloudfront.net）"
}

variable "frontend_domain_aliases" {
  type        = list(string)
  default     = []
  description = "CloudFront の代替ドメイン（証明書と一致させること。デフォルト証明書時は空）"
}

variable "frontend_spa_error_fallback" {
  type        = bool
  default     = true
  description = "403/404 を /index.html にフォールバック（クライアントルーティング向け）"
}

variable "frontend_cloudfront_price_class" {
  type        = string
  default     = "PriceClass_200"
  description = "CloudFront PriceClass（例: PriceClass_100 / 200 / All）"
}

variable "tags" {
  type    = map(string)
  default = {}
}
