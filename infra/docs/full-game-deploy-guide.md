# WaniAR 完全デプロイ手順（ゲームを実際に遊べる状態まで）

この手順は、Terraformでのインフラ構築だけでなく、Kubernetesへのゲームバックエンド配備とフロント配信まで含めて、`https://<あなたのドメイン>` で遊べる状態にするための実運用手順です。

対象環境:

- OS: Windows PowerShell
- AWSリージョン: `ap-northeast-1`
- Terraformルート: `infra/env/prod`
- 取得済みドメイン例: `motinondile.net`

## 0. 前提

事前に必要なもの:

- AWS CLI（認証済み）
- Terraform
- `kubectl`
- `helm`
- Docker Desktop（起動済み）
- Node.js / npm（フロントビルド用）

確認コマンド:

```powershell
aws sts get-caller-identity
terraform version
kubectl version --client
helm version
docker version
npm -v
```

DNS前提:

- Route53 Hosted Zone作成済み
- レジストラ（お名前.com等）のネームサーバーが Route53 NS に委任済み

## 1. Terraform変数設定（第1段階: CloudFrontなし）

`infra/env/prod/terraform.tfvars` を以下の方針で設定:

- `enable_cloudfront = false`（先にALBを作るため）
- `api_alb_dns_name = ""`（未取得のため空）
- `kubernetes_version = "1.30"`（1.29はNodeGroup AMIで失敗するケースがある）

例:

```hcl
project_name = "waniar"
environment  = "prod"
aws_region   = "ap-northeast-1"

domain_name      = "motinondile.net"
route53_zone_id  = "Zxxxxxxxxxxxx"
api_alb_dns_name = ""

enable_cloudfront = false
kubernetes_version = "1.30"

node_desired_capacity = 1
node_min_size         = 1
node_max_size         = 1

# EKS APIアクセス（Terraform実行主体を自動でcluster-admin化）
enable_current_caller_cluster_admin = true
eks_cluster_admin_principal_arns    = []
```

## 2. Terraform apply（第1段階）

```powershell
cd c:\Users\clgin\Documents\WaniAR\infra\env\prod
terraform init
terraform validate
terraform plan -out tfplan.phase1
terraform apply tfplan.phase1
terraform output
```

主要な出力値を控える:

- `cluster_name`
- `alb_controller_role_arn`
- `ecr_game_backend`
- `frontend_bucket_name`

## 3. kubectl接続

```powershell
$REGION="ap-northeast-1"
$CLUSTER="<terraform outputのcluster_name>"
aws eks update-kubeconfig --region $REGION --name $CLUSTER
kubectl get nodes
```

`kubectl get nodes` が成功すれば EKS API 認証は正常です。

## 4. AWS Load Balancer Controller 導入

```powershell
$ALB_ROLE_ARN="<terraform outputのalb_controller_role_arn>"
$VPC_ID=$(aws eks describe-cluster --region $REGION --name $CLUSTER --query "cluster.resourcesVpcConfig.vpcId" --output text)

helm repo add eks https://aws.github.io/eks-charts
helm repo update

kubectl apply -f - @"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: aws-load-balancer-controller
  namespace: kube-system
  annotations:
    eks.amazonaws.com/role-arn: $ALB_ROLE_ARN
"@

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller `
  -n kube-system `
  --set clusterName=$CLUSTER `
  --set serviceAccount.create=false `
  --set serviceAccount.name=aws-load-balancer-controller `
  --set region=$REGION `
  --set vpcId=$VPC_ID

kubectl get deployment -n kube-system aws-load-balancer-controller
```

## 5. game-backend イメージをECRへpush

`game/backend/Dockerfile` を使います。

```powershell
$ECR_REPO="<terraform outputのecr_game_backend>"
$IMAGE_TAG="latest"
$IMAGE_URI="$ECR_REPO`:$IMAGE_TAG"

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ($ECR_REPO -replace '/.*$','')
docker build -t $IMAGE_URI c:\Users\clgin\Documents\WaniAR\game\backend
docker push $IMAGE_URI
```

## 6. game-backend の Deployment / Service / Ingress 作成

```powershell
$NAMESPACE="waniar"
$IMAGE_URI="<ECRのimage URI>"

kubectl apply -f - @"
apiVersion: v1
kind: Namespace
metadata:
  name: $NAMESPACE
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: game-backend
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: game-backend
  template:
    metadata:
      labels:
        app: game-backend
    spec:
      containers:
        - name: game-backend
          image: $IMAGE_URI
          imagePullPolicy: Always
          ports:
            - containerPort: 8090
          env:
            - name: GAME_BACKEND_ADDR
              value: "0.0.0.0:8090"
---
apiVersion: v1
kind: Service
metadata:
  name: game-backend
  namespace: $NAMESPACE
spec:
  selector:
    app: game-backend
  ports:
    - name: http
      port: 80
      targetPort: 8090
      protocol: TCP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: game-backend
  namespace: $NAMESPACE
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80}]'
    alb.ingress.kubernetes.io/healthcheck-path: /healthz
spec:
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: game-backend
                port:
                  number: 80
          - path: /ws
            pathType: Prefix
            backend:
              service:
                name: game-backend
                port:
                  number: 80
"@
```

確認:

```powershell
kubectl get pods -n $NAMESPACE
kubectl get svc -n $NAMESPACE
kubectl get ingress -n $NAMESPACE
```

ALB DNS取得:

```powershell
$ALB_DNS=$(kubectl get ingress -n $NAMESPACE game-backend -o jsonpath="{.status.loadBalancer.ingress[0].hostname}")
$ALB_DNS
```

## 7. Terraform apply（第2段階: CloudFront有効化）

`terraform.tfvars` を更新:

```hcl
api_alb_dns_name  = "<上で取得したALB DNS>"
enable_cloudfront = true
```

適用:

```powershell
cd c:\Users\clgin\Documents\WaniAR\infra\env\prod
terraform plan -out tfplan.phase2
terraform apply tfplan.phase2
terraform output
```

`cloudfront_domain` が出力されれば配信経路は完成です。

## 8. フロント資産ビルドとS3配備

```powershell
cd c:\Users\clgin\Documents\WaniAR
npm ci
npm run build:model
npm run build
```

S3へ配備:

```powershell
$BUCKET="<terraform outputのfrontend_bucket_name>"
aws s3 sync dist/ s3://$BUCKET --delete
```

CloudFront無効化（キャッシュ削除）:

```powershell
$DOMAIN="<terraform.tfvars の domain_name>"
$DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

## 9. 動作確認

確認URL:

- `https://<domain_name>`（例: `https://motinondile.net`）

最低チェック:

- 画面表示される
- ルーム参加できる
- WebSocket接続される（ブラウザ開発者ツールで `/game-ws` が `101`）
- API呼び出し成功（`/game-api/...` が `2xx`）

## 10. Optional: Agent（LLMヒント）を有効化する場合

この手順では game-backend 単体でもプレイ可能です（Agent失敗時はバックエンドのフォールバックヒントに切替）。  
LLMヒントを本番有効化する場合は、`Agent` サービスもコンテナ化・配備し、`game-backend` の `AGENT_URL` をクラスタ内URLへ設定してください。

## 11. よくあるエラー

`kubectl: the server has asked for the client to provide credentials`

- `aws eks update-kubeconfig` を再実行
- Terraformの `enable_current_caller_cluster_admin = true` が有効か確認

`InvalidParameterException: Requested AMI for this version 1.29 is not supported`

- `kubernetes_version = "1.30"` へ変更して再apply

`kubectl get ingress -A` が `No resources found`

- Ingress未作成。手順6を実行

`docker ... daemon is running` エラー

- Docker Desktop起動・`docker version` で確認

