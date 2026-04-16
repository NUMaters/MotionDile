# Terraform（AWS 向け雛形）

`game/backend`（Gin + WebSocket）と `Agent`（`/hint`）を **ECS Fargate + ALB** で動かす前提の **dev 向け最小構成** です。本番は WAF / HTTPS 必須・マルチ AZ・Redis 共有状態などを追加してください。

## 前提

- AWS CLI と Terraform（1.5+）が使えること
- コンテナイメージを ECR に push 済み（初回は `terraform apply` 後に push）

## ディレクトリ

| パス | 内容 |
|------|------|
| `modules/vpc` | VPC・パブリックサブネット・IGW |
| `modules/ecr` | ECR リポジトリ 1 個 |
| `modules/fargate_service` | ECS Fargate 1 サービス + ALB 1 台 |
| `modules/static_frontend` | フロント用 S3（OAC）+ CloudFront。任意で `/api/*`・`/ws*`・`/healthz` を game-backend ALB へプロキシ（HTTPS ページから HTTP ALB への混合コンテンツを避ける） |
| `environments/dev` | dev 環境の束ね |

## 使い方（例）

```bash
cd infra/terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars で project_name / aws_region 等を調整

terraform init
terraform plan
terraform apply
```

## apply 後の作業

1. ECR に Docker イメージを push（`game/backend/Dockerfile` / `Agent/Dockerfile`）。**Fargate 既定は linux/amd64** のため、Dockerfile では `GOOS=linux GOARCH=amd64` でビルド済み（Apple Silicon のみでビルドしても `exec format error` にならない）
2. `game-backend` サービスのタスク定義で使うイメージタグを `terraform.tfvars` の `*_image` に反映して再 apply、または ECS で強制デプロイ
3. フロントは **`npm run build:aws`**（`VITE_GAME_CLOUDFRONT_PROXY=true` で `/api/v1` と同一オリジンの `/ws` を使う）のあと、`terraform output frontend_s3_bucket_id` へ **`aws s3 sync`**。一括ならリポジトリルートの **`scripts/deploy-aws.sh`**（Terraform apply → build → sync → 無効化）。URL は `terraform output frontend_cloudfront_url`（CloudFront が API をプロキシするため、別途 `VITE_GAME_API_BASE` を ALB 直指定する必要はない）
4. Agent は **`AWS_REGION`**（`terraform.tfvars` の `aws_region`）と **`BEDROCK_MODEL_ID`**（`agent_bedrock_model_id`、既定は Claude 3 Haiku）を ECS 環境変数で渡し、**タスクロール**に **`bedrock:InvokeModel`** を付与する。**AWS コンソールで Bedrock のモデルアクセス**（該当モデル）を有効化すること。任意で **OpenAI** を使う場合のみ `agent_openai_api_key` を設定し **Secrets Manager** 経由で注入（実行ロールに `GetSecretValue`）

## 現行ソースとの対応

| コンポーネント | ローカル | AWS（この雛形） |
|------------------|----------|-----------------|
| ゲーム API + WS | `:8090` `/api/v1` `/ws` | ALB → `game-backend` :8090 |
| Agent | `:8091` `/hint` | 別 ALB → `agent` :8091 |
| フロント | Vite | `modules/static_frontend`（S3 + CloudFront、OAC） |

`game/backend` の `AGENT_URL` は **Agent ALB の DNS**（`http://xxx.elb.amazonaws.com:80` はリスナー 80 なのでスキームは http）を設定します。

## 注意

- 現状の Go は **インメモリ状態**のため、タスク再起動でルームが消えます。本番水平スケール前に Redis 等への外出しが必要です。
- `Agent` の **Bedrock** は IAM タスクロールで制御。任意の **OpenAI** は `agent_openai_api_key` 設定時に Secrets Manager へ保存し ECS で参照（tfstate に秘密が含まれる点に注意）。
- カスタムドメイン + HTTPS 利用時は **ACM を us-east-1** で発行し、`frontend_acm_certificate_arn` と `frontend_domain_aliases` を `terraform.tfvars` に設定すること（CloudFront は証明書リージョンの制約あり）。
