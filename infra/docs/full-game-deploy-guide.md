# WaniAR Deploy Guide (Terraform One-Flow)

このガイドは `infra/env/prod` の Terraform だけで、
EKS / ALB Controller / backend Deployment+Ingress / CloudFront まで一括で作成・削除する手順です。

## 1. 前提

- OS: Windows PowerShell
- AWS認証済み (`aws sts get-caller-identity` が成功)
- Docker Desktop 起動済み
- 事前に `game-backend` のイメージを ECR に push できること

確認:

```powershell
aws sts get-caller-identity
terraform version
docker version
```

## 2. 設定ファイル

`infra/env/prod/terraform.tfvars` の最小例:

```hcl
project_name       = "waniar"
environment        = "prod"
aws_region         = "ap-northeast-1"
kubernetes_version = "1.30"

domain_name      = "example.com"
route53_zone_id  = "Z0000000000000"
enable_cloudfront = true

# backend image は空なら <terraformで作るECR>:latest を使用
backend_image_uri = ""
backend_image_tag = "latest"

# destroyを単純化
s3_force_destroy = true
ecr_force_delete = true

node_desired_capacity = 1
node_min_size         = 1
node_max_size         = 1
```

## 3. 初回デプロイ

```powershell
cd c:\Users\clgin\Documents\WaniAR\infra\env\prod
terraform init
terraform plan
terraform apply
```

これで以下が Terraform 管理下で作成されます。

- VPC / EKS / NodeGroup
- AWS Load Balancer Controller (Helm)
- `waniar` Namespace の backend Deployment/Service/Ingress
- S3 / CloudFront / ACM / Route53
- ECR Repository

確認:

```powershell
terraform output
```

主な出力:

- `cloudfront_domain`
- `api_alb_dns_name`
- `ecr_game_backend`
- `backend_image_uri`

## 4. backendイメージ更新

Terraformは Kubernetes Deployment の image を `backend_image_uri` (または `backend_image_tag`) で管理します。

### 4.1 画像をpush

```powershell
$REGION = "ap-northeast-1"
$ECR_REPO = terraform output -raw ecr_game_backend
$IMAGE_TAG = "latest"
$IMAGE_URI = "$ECR_REPO`:$IMAGE_TAG"

$ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text).Trim()
$REGISTRY = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# PowerShell 7+
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY

# Windows PowerShell 5.1 で 400 が出る場合
# $PASSWORD = aws ecr get-login-password --region $REGION
# docker login --username AWS --password $PASSWORD $REGISTRY

docker build -t $IMAGE_URI c:\Users\clgin\Documents\WaniAR\game\backend
docker push $IMAGE_URI
```

### 4.2 Terraform反映

`backend_image_tag` を変えた場合だけ `terraform apply` してください。
`latest` を使い続ける場合は、必要なら以下で再起動します。

```powershell
kubectl rollout restart deployment/game-backend -n waniar
kubectl rollout status deployment/game-backend -n waniar
```

## 5. 再デプロイ

インフラ変更・設定変更時は通常どおり:

```powershell
cd c:\Users\clgin\Documents\WaniAR\infra\env\prod
terraform plan
terraform apply
```

## 6. Destroy

Terraform管理下に統合済みなので、基本はこれだけです。

```powershell
cd c:\Users\clgin\Documents\WaniAR\infra\env\prod
terraform destroy
```

`s3_force_destroy=true` と `ecr_force_delete=true` のため、
S3バケット内オブジェクト/ECRイメージ残存で止まりにくい構成です。

## 7. 旧構成からの移行注意

過去に手動で作成したリソースが残っている場合は、初回 `apply` 前に削除してください。

- `helm` 手動導入の `aws-load-balancer-controller`
- `kubectl apply` した `waniar` namespace 内の `game-backend` Deployment/Service/Ingress

例:

```powershell
helm uninstall aws-load-balancer-controller -n kube-system
kubectl delete namespace waniar --ignore-not-found
```
