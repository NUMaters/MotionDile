module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.8.2"

  cluster_name    = var.name
  cluster_version = var.kubernetes_version

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  enable_irsa = true
  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_instance_type]
      desired_size   = var.node_desired_capacity
      min_size       = var.node_min_size
      max_size       = var.node_max_size
      disk_size      = var.node_disk_size
    }
  }

  tags = var.tags
}
