output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "alb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "target_group_arn" {
  value = aws_lb_target_group.this.arn
}

output "task_security_group_id" {
  value       = aws_security_group.task.id
  description = "ECS タスク用 SG ID（他モジュールから ingress 先として参照）"
}

output "alb_security_group_id" {
  value       = aws_security_group.alb.id
  description = "ALB 用 SG ID"
}

output "service_name" {
  value       = aws_ecs_service.this.name
  description = "ECS サービス名"
}
