resource "aws_ecr_repository" "game_backend" {
  name                 = var.name
  image_tag_mutability = "MUTABLE"
  force_delete         = var.force_delete

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}
