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
  type = list(string)
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
