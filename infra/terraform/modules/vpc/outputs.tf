output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "vpc_endpoints_security_group_id" {
  value       = var.enable_vpc_endpoints ? aws_security_group.vpc_endpoints[0].id : ""
  description = "VPC Endpoint 用 SG ID（enable_vpc_endpoints=false のときは空）"
}
