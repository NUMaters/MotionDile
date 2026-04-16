locals {
  name = "${var.project_name}-${var.environment}"
  tags = merge({
    Project     = var.project_name
    Environment = var.environment
  }, var.tags)

  eks_cluster_admin_principal_arns = distinct(concat(
    var.enable_current_caller_cluster_admin ? [data.aws_caller_identity.current.arn] : [],
    var.eks_cluster_admin_principal_arns
  ))

  eks_access_entries = {
    for idx, principal_arn in local.eks_cluster_admin_principal_arns :
    "cluster_admin_${idx}" => {
      principal_arn = principal_arn
      policy_associations = {
        admin = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  }
}
