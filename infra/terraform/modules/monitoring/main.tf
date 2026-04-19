locals {
  create_sns    = var.sns_topic_arn == ""
  sns_topic_arn = local.create_sns ? aws_sns_topic.alarms[0].arn : var.sns_topic_arn
}

# ==================== SNS Topic ====================

resource "aws_sns_topic" "alarms" {
  count = local.create_sns ? 1 : 0
  name  = "${var.name_prefix}-alarms"
  tags  = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = local.create_sns && var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# ==================== ECS Alarms ====================

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  for_each = var.ecs_services

  alarm_name          = "${each.key}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = each.value.cpu_threshold
  alarm_description   = "${each.key} CPU > ${each.value.cpu_threshold}% for 3 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value.service_name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  for_each = var.ecs_services

  alarm_name          = "${each.key}-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = each.value.memory_threshold
  alarm_description   = "${each.key} Memory > ${each.value.memory_threshold}% for 3 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value.service_name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "ecs_running_count" {
  for_each = var.ecs_services

  alarm_name          = "${each.key}-no-running-tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "${each.key} has 0 running tasks"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = each.value.service_name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

# ==================== ALB Alarms ====================

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  for_each = var.ecs_services

  alarm_name          = "${each.key}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "${each.key} ALB 5xx > 10/min for 2 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = each.value.alb_arn_suffix
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_target_5xx" {
  for_each = var.ecs_services

  alarm_name          = "${each.key}-target-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "${each.key} Target 5xx > 10/min for 2 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = each.value.alb_arn_suffix
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "alb_latency" {
  for_each = var.ecs_services

  alarm_name          = "${each.key}-alb-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 5
  alarm_description   = "${each.key} ALB latency > 5s for 3 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = each.value.alb_arn_suffix
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

# ==================== Redis Alarms ====================

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  count = var.enable_redis_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-redis-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Redis CPU > 80% for 3 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    CacheClusterId = var.redis_cluster_id
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  count = var.enable_redis_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-redis-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Redis memory > 80% for 3 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    CacheClusterId = var.redis_cluster_id
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  count = var.enable_redis_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-redis-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "Redis evictions > 100/5min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    CacheClusterId = var.redis_cluster_id
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

# ==================== CloudFront Alarms ====================

resource "aws_cloudwatch_metric_alarm" "cf_5xx" {
  count = var.enable_cloudfront_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-cloudfront-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 60
  statistic           = "Average"
  threshold           = 5
  alarm_description   = "CloudFront 5xx rate > 5% for 3 min"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = var.cloudfront_distribution_id
    Region         = "Global"
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]

  tags = var.tags
}

# ==================== Dashboard ====================

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = concat(
      [for idx, entry in [for k, v in var.ecs_services : { key = k, val = v }] :
        {
          type   = "metric"
          x      = (idx % 2) * 12
          y      = floor(idx / 2) * 6
          width  = 12
          height = 6
          properties = {
            title   = "${entry.key} - CPU / Memory"
            region  = var.aws_region
            metrics = [
              ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", entry.val.service_name, { stat = "Average", label = "CPU %" }],
              ["AWS/ECS", "MemoryUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", entry.val.service_name, { stat = "Average", label = "Memory %" }],
            ]
            view   = "timeSeries"
            period = 60
            yAxis  = { left = { min = 0, max = 100 } }
          }
        }
      ],
      [for idx, entry in [for k, v in var.ecs_services : { key = k, val = v }] :
        {
          type   = "metric"
          x      = (idx % 2) * 12
          y      = (ceil(length(var.ecs_services) / 2) + floor(idx / 2)) * 6
          width  = 12
          height = 6
          properties = {
            title   = "${entry.key} - ALB"
            region  = var.aws_region
            metrics = [
              ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", entry.val.alb_arn_suffix, { stat = "Sum", label = "Requests" }],
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", entry.val.alb_arn_suffix, { stat = "Average", label = "Latency (s)" }],
              ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", entry.val.alb_arn_suffix, { stat = "Sum", label = "5xx" }],
            ]
            view   = "timeSeries"
            period = 60
          }
        }
      ],
      var.enable_redis_alarms ? [
        {
          type   = "metric"
          x      = 0
          y      = 24
          width  = 12
          height = 6
          properties = {
            title   = "Redis"
            region  = var.aws_region
            metrics = [
              ["AWS/ElastiCache", "EngineCPUUtilization", "CacheClusterId", var.redis_cluster_id, { stat = "Average", label = "CPU %" }],
              ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "CacheClusterId", var.redis_cluster_id, { stat = "Average", label = "Memory %" }],
              ["AWS/ElastiCache", "CurrConnections", "CacheClusterId", var.redis_cluster_id, { stat = "Average", label = "Connections" }],
            ]
            view   = "timeSeries"
            period = 60
          }
        }
      ] : [],
      var.enable_cloudfront_alarms ? [
        {
          type   = "metric"
          x      = 12
          y      = 24
          width  = 12
          height = 6
          properties = {
            title   = "CloudFront"
            region  = "us-east-1"
            metrics = [
              ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Sum", label = "Requests" }],
              ["AWS/CloudFront", "5xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average", label = "5xx %" }],
              ["AWS/CloudFront", "4xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average", label = "4xx %" }],
            ]
            view   = "timeSeries"
            period = 60
          }
        }
      ] : [],
    )
  })
}
