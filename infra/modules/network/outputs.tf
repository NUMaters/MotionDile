output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPC ID."
}

output "public_subnets" {
  value       = module.vpc.public_subnets
  description = "Public subnet IDs."
}

output "private_subnets" {
  value       = module.vpc.private_subnets
  description = "Private subnet IDs."
}
