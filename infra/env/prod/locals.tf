locals {
  name = "${var.project_name}-${var.environment}"
  tags = merge({
    Project     = var.project_name
    Environment = var.environment
  }, var.tags)
}
