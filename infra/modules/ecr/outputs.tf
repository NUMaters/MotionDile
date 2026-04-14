output "repository_url" {
  value       = aws_ecr_repository.game_backend.repository_url
  description = "ECR repository URL."
}
