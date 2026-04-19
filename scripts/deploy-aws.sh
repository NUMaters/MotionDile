#!/usr/bin/env bash
# Terraform 適用 → 本番向けフロントビルド → S3 同期 → CloudFront 無効化
# Agent は Bedrock 専用。OpenAI は削除済み。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform/environments/dev"

echo "==> terraform apply ($TF_DIR)"
# wait_for_steady_state=true により ECS が安定するまで待機してから次へ進む
(cd "$TF_DIR" && terraform apply -auto-approve)

# enable_static_frontend=false の場合、S3/CloudFront 出力は null になる
BUCKET="$(cd "$TF_DIR" && terraform output -raw frontend_s3_bucket_id 2>/dev/null || echo "")"

if [[ -n "$BUCKET" && "$BUCKET" != "null" ]]; then
  echo "==> npm run build:aws"
  (cd "$ROOT" && npm run build:aws)

  DIST_ID="$(cd "$TF_DIR" && terraform output -raw frontend_cloudfront_distribution_id)"

  echo "==> aws s3 sync -> s3://${BUCKET}/"
  aws s3 sync "$ROOT/dist/" "s3://${BUCKET}/" --delete

  echo "==> CloudFront invalidation ${DIST_ID}"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --output text

  CF_URL="$(cd "$TF_DIR" && terraform output -raw frontend_cloudfront_url)"
  echo "==> フロント URL: ${CF_URL}"
  echo "==> ヘルス確認例: curl -sS '${CF_URL}/healthz'"
else
  echo "==> フロント配信は無効（enable_static_frontend=false）: S3/CloudFront 操作をスキップ"
fi
