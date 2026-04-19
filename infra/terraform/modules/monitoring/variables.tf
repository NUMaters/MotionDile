variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_services" {
  type = map(object({
    service_name     = string
    alb_arn_suffix   = string
    cpu_threshold    = number
    memory_threshold = number
  }))
  description = "ECS サービスごとの監視設定"
}

variable "redis_cluster_id" {
  type        = string
  default     = ""
  description = "ElastiCache クラスター ID。空なら Redis アラームをスキップ"
}

variable "cloudfront_distribution_id" {
  type        = string
  default     = ""
  description = "CloudFront ディストリビューション ID"
}

variable "enable_cloudfront_alarms" {
  type        = bool
  default     = false
  description = "CloudFront アラームを作成する"
}

variable "enable_redis_alarms" {
  type        = bool
  default     = false
  description = "Redis アラームを作成する"
}

variable "sns_topic_arn" {
  type        = string
  default     = ""
  description = "アラーム通知先の SNS Topic ARN。空なら SNS Topic を自動作成"
}

variable "alarm_email" {
  type        = string
  default     = ""
  description = "アラーム通知メールアドレス。sns_topic_arn が空の場合に SNS サブスクリプションを作成"
}

variable "tags" {
  type    = map(string)
  default = {}
}
