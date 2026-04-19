variable "name_prefix" {
  type        = string
  description = "ECS ファミリー名・ログ名の接頭辞（英小文字推奨）"
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "ALB 用サブネット（internet-facing ALB のときのみ使用）"
}

variable "task_subnet_ids" {
  type        = list(string)
  default     = []
  description = "ECS タスク配置サブネット。空なら public_subnet_ids を使用（後方互換）"
}

variable "cluster_arn" {
  type = string
}

variable "container_image" {
  type        = string
  description = "ECR または DockerHub のフルイメージ参照"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "health_check_path" {
  type    = string
  default = "/"
}

variable "health_check_grace_period_seconds" {
  type        = number
  default     = 60
  description = "ECS が ALB ヘルスチェック失敗を無視する起動猶予秒数"
}

variable "environment" {
  type        = map(string)
  default     = {}
  description = "非機密の環境変数"
}

variable "secrets" {
  type        = map(string)
  default     = {}
  description = "Secrets Manager / SSM の ARN（valueFrom）"
  sensitive   = true
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "bedrock_invoke_model_arns" {
  type        = list(string)
  default     = []
  description = "ECS タスクロールに bedrock:InvokeModel を付与する対象（foundation-model ARN のリスト）"
}

# ============ New Architecture Variables ============

variable "assign_public_ip" {
  type        = bool
  default     = false
  description = "ECS タスクにパブリック IP を割り当てる（private subnet 配置時は false）"
}

variable "internal" {
  type        = bool
  default     = false
  description = "ALB を内部専用にする（Agent 用）"
}

variable "alb_idle_timeout" {
  type        = number
  default     = 60
  description = "ALB idle timeout 秒（WebSocket 向けに大きくする）"
}

variable "alb_ssl_certificate_arn" {
  type        = string
  default     = ""
  description = "ALB に HTTPS listener を追加する場合の ACM 証明書 ARN"
}

variable "enable_https" {
  type        = bool
  default     = false
  description = "ALB HTTPS リスナーを有効にする（alb_ssl_certificate_arn と併せて設定）"
}

variable "extra_task_security_group_ids" {
  type        = list(string)
  default     = []
  description = "ECS タスクに追加でアタッチする SG ID（Redis や VPC Endpoint 接続用）"
}

variable "extra_alb_ingress_rules" {
  type = list(object({
    from_port       = number
    to_port         = number
    protocol        = string
    cidr_blocks     = optional(list(string), [])
    security_groups = optional(list(string), [])
    description     = optional(string, "")
  }))
  default     = []
  description = "ALB SG に追加する ingress ルール"
}

# ============ Auto Scaling Variables ============

variable "enable_autoscaling" {
  type        = bool
  default     = false
  description = "ECS Service Auto Scaling を有効にする"
}

variable "autoscaling_min_capacity" {
  type    = number
  default = 1
}

variable "autoscaling_max_capacity" {
  type    = number
  default = 10
}

variable "autoscaling_cpu_target" {
  type        = number
  default     = 60
  description = "CPU 使用率ターゲット (%)"
}

variable "autoscaling_memory_target" {
  type        = number
  default     = 70
  description = "メモリ使用率ターゲット (%)"
}

variable "autoscaling_requests_per_target" {
  type        = number
  default     = 0
  description = "ALB RequestCountPerTarget ターゲット（0 = 無効）"
}

# ============ ALB Access Logs ============

variable "enable_alb_access_logs" {
  type        = bool
  default     = false
  description = "ALB アクセスログを S3 に保存する"
}

variable "alb_access_logs_bucket" {
  type        = string
  default     = ""
  description = "ALB アクセスログ保存先の S3 バケット名"
}

variable "alb_access_logs_prefix" {
  type        = string
  default     = ""
  description = "ALB アクセスログの S3 プレフィックス"
}
