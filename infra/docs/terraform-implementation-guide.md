# WaniAR Terraform 実装ガイド

このドキュメントは、`infra/` 配下の Terraform 実装を「何を作っているか」「なぜその実装か」「どう使うか」の順で整理した解説です。  
対象は `infra/env/prod` と `infra/modules/*` です。

## 1. 何を作る構成か

この Terraform は、以下の AWS 基盤をまとめて作成します。

- ネットワーク: VPC / Public Subnet / Private Subnet / NAT Gateway
- Kubernetes 実行基盤: EKS + Managed Node Group
- Ingress 用 IAM: AWS Load Balancer Controller 向け IRSA ロール
- フロント配信: S3 + CloudFront + ACM + Route53
- コンテナレジストリ: game backend 用 ECR

通信イメージ:

- ブラウザの静的ファイルは CloudFront -> S3 から配信
- API / WebSocket は CloudFront -> ALB(Ingress) -> game backend へ転送
- EKS 内の Ingress は AWS Load Balancer Controller が管理

## 2. ディレクトリと責務

```text
infra/
  env/prod/                 # ルートモジュール（この階層で init/plan/apply）
    versions.tf             # Terraform / Provider バージョン制約
    providers.tf            # AWS provider（ap-northeast-1 と us-east-1）
    data.tf                 # 利用可能 AZ 取得
    locals.tf               # 共通命名・共通タグ
    main.tf                 # 各 module 呼び出し
    variables.tf            # ルート入力変数
    outputs.tf              # ルート出力値
  modules/
    network/                # VPC
    eks/                    # EKS
    iam_alb_controller/     # ALB Controller 用 IAM
    frontend/               # S3/CloudFront/ACM/Route53
    ecr/                    # ECR
```

## 3. ルートモジュール (`env/prod`) の実装

### 3.1 `versions.tf`

- Terraform: `>= 1.6.0`
- Provider:
  - `hashicorp/aws >= 5.50.0`
  - `hashicorp/random >= 3.6.0`

### 3.2 `providers.tf`

- デフォルト provider: `var.aws_region`（通常 `ap-northeast-1`）
- `aws.us_east_1` alias: CloudFront 用 ACM 証明書のため `us-east-1` を定義

### 3.3 `data.tf`

- `aws_availability_zones.available` を取得
- `main.tf` 側で、private subnet 数に合わせて AZ を切り出し利用

### 3.4 `locals.tf`

- `local.name = "${project_name}-${environment}"`
- `local.tags` に `Project` / `Environment` を必ず含め、`var.tags` を merge

### 3.5 `main.tf`（依存順）

1. `module.network`
1. `module.eks`（`network` の VPC / private subnet を入力）
1. `module.alb_controller`（`eks` の OIDC 情報を入力）
1. `module.frontend`（S3+CloudFront+Route53+ACM）
1. `module.ecr_game_backend`

この順で、ネットワーク -> クラスター -> Ingress IAM -> 配信 -> レジストリの流れになります。

### 3.6 `variables.tf`

主な入力:

- 必須（実運用で必ず設定）
  - `domain_name`
  - `route53_zone_id`
  - `api_alb_dns_name`（`enable_cloudfront=true` の場合）
- 主要デフォルト
  - `aws_region = "ap-northeast-1"`
  - `kubernetes_version = "1.29"`
  - ノード数は単一運用向けに `desired/min/max = 1`

検証ロジック:

- `enable_cloudfront=true` なら `api_alb_dns_name` 必須

### 3.7 `outputs.tf`

- `cluster_name`, `cluster_endpoint`
- `frontend_bucket_name`, `cloudfront_domain`
- `alb_controller_role_arn`
- `ecr_game_backend`

## 4. 各 module の実装詳細

## 4.1 `modules/network`

実体は `terraform-aws-modules/vpc/aws (v5.8.1)` を利用。

主要設定:

- VPC CIDR と Public/Private subnet を作成
- DNS hostnames/support 有効
- NAT は `single_nat_gateway = true`（コストを抑えやすい構成）
- subnet tag:
  - Public: `kubernetes.io/role/elb=1`
  - Private: `kubernetes.io/role/internal-elb=1`
  - 両方に `kubernetes.io/cluster/<name>=shared`

このタグにより、EKS + ALB Controller が subnet を自動認識しやすくなります。

出力:

- `vpc_id`, `public_subnets`, `private_subnets`

## 4.2 `modules/eks`

実体は `terraform-aws-modules/eks/aws (v20.8.2)` を利用。

主要設定:

- `cluster_name` は `local.name`
- `enable_irsa = true`（ServiceAccount と IAM ロール連携に必須）
- `cluster_endpoint_public_access = true`
- Managed Node Group `default` を 1 グループ作成
  - instance type, desired/min/max, disk size を可変化

出力:

- `cluster_name`, `cluster_endpoint`
- `oidc_provider`, `oidc_provider_arn`（次の IAM module で使用）

## 4.3 `modules/iam_alb_controller`

EKS 上の `aws-load-balancer-controller` ServiceAccount 用 IRSA を作成します。

作成リソース:

- `aws_iam_policy.alb_controller`
  - `policy.json` をそのまま適用
  - ELB 作成/更新、SG 操作、タグ操作など ALB Controller に必要な権限
- `aws_iam_role.alb_controller`
  - `sts:AssumeRoleWithWebIdentity`
  - 信頼条件は OIDC の `sub` を
    `system:serviceaccount:kube-system:aws-load-balancer-controller`
    に限定
- `aws_iam_role_policy_attachment.alb_controller`

出力:

- `role_arn`

## 4.4 `modules/frontend`

この module は最もリソースが多く、フロント配信と API 中継をまとめて管理します。

### S3 側

- バケット名: `${name}-frontend-<random suffix>`
- `force_destroy` は変数化（本番は通常 `false` 推奨）
- Public Access Block を全有効
- Versioning 有効
- SSE-S3 (`AES256`) 有効

### CloudFront 側（`enable_cloudfront=true` のとき）

- Origin 1: S3（OAC で private access）
- Origin 2: ALB（`api_alb_dns_name`）
- `default_cache_behavior`: S3 向け（静的配信）
- API/WS 向け `ordered_cache_behavior`:
  - `/api/*`
  - `/ws`
  - `/game-api/*`
  - `/game-ws`

### `/game-api` `/game-ws` のリライト

- `aws_cloudfront_function.api_path_rewrite` を作成
- `viewer-request` で以下を変換:
  - `/game-api/*` -> `/api/*`
  - `/game-ws` -> `/ws`
  - `/game-ws/*` -> `/ws/*`

これにより、フロント実装のパス（`/game-api`, `/game-ws`）と、バックエンド実装の実パス（`/api`, `/ws`）を CloudFront で吸収できます。

### TLS / DNS

- ACM 証明書を `us-east-1` で作成（CloudFront要件）
- Route53 で DNS 検証レコードを作成
- 検証完了後、CloudFront に証明書を紐付け
- `domain_name` に A/AAAA Alias を作成

### SPA 対応

- 403/404 を `index.html` にフォールバックして `200` 返却

### バケットポリシー

- CloudFront Distribution ARN 条件付きで `s3:GetObject` のみ許可
- 直接公開はしない

出力:

- `frontend_bucket_name`
- `cloudfront_domain`（CloudFront無効時は `null`）

## 4.5 `modules/ecr`

game backend 用 ECR を 1 リポジトリ作成。

- `image_tag_mutability = "MUTABLE"`
- `scan_on_push = true`

出力:

- `repository_url`

## 5. 変数の実運用での考え方

`infra/env/prod/terraform.tfvars.example` の最小セット:

```hcl
project_name      = "waniar"
environment       = "prod"
aws_region        = "ap-northeast-1"
domain_name       = "example.com"
route53_zone_id   = "Z0000000000000"
api_alb_dns_name  = "example-alb-123456.ap-northeast-1.elb.amazonaws.com"
enable_cloudfront = true
```

補足:

- `api_alb_dns_name` は Ingress 作成後に確定するケースが多い
- そのため、初回は `enable_cloudfront=false` で apply し、ALB DNS 確定後に `true` へ切り替える運用が安全

## 6. 実行手順（推奨）

`infra/env/prod` で実行します。

```bash
terraform init
terraform plan -out tfplan
terraform apply tfplan
```

段階適用の例:

1. `enable_cloudfront = false` で apply（EKS・IAM・S3・ECR 先行）
1. Kubernetes 側で ALB ができたら `api_alb_dns_name` を設定
1. `enable_cloudfront = true` で apply（CloudFront/ACM/Route53 を作成）

## 7. 運用時の注意点

- CloudFront + ACM の反映は時間がかかる（数分〜十数分）
- `s3_force_destroy = true` は誤削除リスクがあるため通常は `false`
- Node Group を 1 台固定にしているので、可用性強化時は `min/max` と AZ 設計を見直す
- `cluster_endpoint_public_access = true` は運用要件に応じて制限検討
- ALB Controller の IAM policy は権限が広いため、将来は最小権限化を継続検討

## 8. この実装の要点まとめ

- ルートモジュールは「依存順に module を組む」シンプルな構造
- Network/EKS は公式 community module を利用して保守性を確保
- Frontend module に配信・TLS・DNS・API中継を集約
- `/game-api` `/game-ws` を CloudFront Function で吸収し、フロントとバックエンドのパス差異を解消
- 出力値（bucket/domain/ecr/role）で後続デプロイと接続しやすい構成

