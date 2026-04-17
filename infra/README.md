# WaniAR Terraform

## 実行ルート

Terraform の実行は `infra/env/prod` で行います。

```powershell
cd c:\Users\clgin\Documents\WaniAR\infra\env\prod
terraform init
terraform plan
terraform apply
terraform destroy
```

## この構成で管理するもの

- VPC / EKS / NodeGroup
- AWS Load Balancer Controller (Helm)
- game-backend の Deployment / Service / Ingress
- ECR
- S3 / CloudFront / ACM / Route53

詳細手順は以下を参照:

- `infra/docs/full-game-deploy-guide.md`
- `infra/docs/terraform-implementation-guide.md`
