# WaniAR インフラ（Terraform）

- EKS（単一ノードグループ）
- S3 + CloudFront（フロントエンド配信）
- Route53 + ACM（us-east-1）
- AWS Load Balancer Controller 用 IAM（IRSA）
- ゲームバックエンド用 ECR

## ディレクトリ構成

- `env/prod/` : ルートモジュール（ここで `terraform init/apply`）
- `modules/` : 再利用モジュール
- `docs/architecture.drawio` : 構成図

## このリポジトリ固有の注意

- ゲームバックエンドはメモリに部屋状態を保持するため、**本番は 1 レプリカ運用**にしてください。
- `medea-pipeline` は **ビルド時のみ**。生成した `hand-control-model.json` は S3 に配置します。

## 前提条件

- Terraform 1.6 以上
- AWS 認証情報が設定済み
- 対象ドメインの Route53 ホストゾーン
- Kubernetes の Deployment/Ingress マニフェスト（本構成には含めていません）

## 必須変数

`infra/env/prod/terraform.tfvars` に以下を設定します。

- `domain_name`（フロントと API を同一ドメインで運用）
- `route53_zone_id`
- `api_alb_dns_name`（ALB Controller が作成した ALB の DNS 名）

## tfvars の例

`infra/env/prod/terraform.tfvars.example` を参照してください。

## 適用手順（2 ステップ）

1. EKS + S3 を先に作成
- `enable_cloudfront = false`
- `terraform apply`

2. AWS Load Balancer Controller を導入し、Ingress を作成
- `api_alb_dns_name` に ALB の DNS 名を設定
- `enable_cloudfront = true`
- `terraform apply`

## Ingress のルーティング要件

Ingress は以下を game-backend（8090）に転送します。

- `/api/*` -> game-backend
- `/ws` -> game-backend

バックエンドは `GAME_BACKEND_ADDR=0.0.0.0:8090` で待受します。

## フロントエンドのデプロイ

ビルドとアップロードの流れ：

- `npm run build:model`
- `npm run build`
- `aws s3 sync dist/ s3://<frontend_bucket>`

`.glb` を独自ツールでアップロードする場合は `Content-Type: model/gltf-binary` を設定してください。
