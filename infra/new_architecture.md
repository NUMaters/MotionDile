# WaniAR New AWS Architecture (Bedrock-First)

## 1. 目的

このドキュメントは、現行 `infra/terraform` と `game/backend` の実装を前提に、次の要件を満たす具体アーキテクチャを定義する。

- 複雑すぎない
- 低コスト
- 参加者が多い場合でも成立する
- セキュリティを最低限担保する
- Agent は Bedrock 本命（OpenAI は削除）
- フロントドメインはお名前.comで取得した独自ドメインを使う

---

## 2. 現行構成の要点と制約

## 2.1 現行構成（要点）

- VPC は public subnet のみ
- `game-backend` / `agent` は ECS Fargate + 各サービスごとに公開 ALB
- CloudFront が `/api/*`, `/ws*` を game ALB へプロキシ
- game のルーム状態・ゲーム進行・WS接続情報はプロセス内メモリ保持

## 2.2 制約（高負荷時の問題）

- タスクを増やすと部屋状態が分断される（インメモリのため）
- WS の room ブロードキャストがタスクローカルに閉じる
- Agent が外部公開されている
- OpenAI fallback 用の秘密情報運用が残っている

---

## 3. 新アーキテクチャ（採用案）

## 3.1 全体像

```text
Users
  -> CloudFront (custom domain, WAF)
    -> S3 (static frontend)
    -> ALB(public, game only, HTTPS)
      -> ECS Fargate game-backend (private subnets, autoscaling)
        -> ElastiCache Redis (private subnets)
        -> ECS Fargate agent (private, internal ALB or Service Connect)
          -> Amazon Bedrock Runtime
```

## 3.2 重要方針

- game の状態管理は Redis に移す（水平スケール可能化）
- room イベント配信は Redis Pub/Sub を使う（タスク跨ぎ配信）
- Agent は外部公開しない（内部通信専用）
- OpenAI 経路は削除し Bedrock のみ
- ECS タスクは private subnet 配置
- NAT は原則置かず、必要な VPC Endpoint を使ってコスト抑制

---

## 4. スケーリング設計（多人数対応）

## 4.1 game-backend の分散

- `RoomRepository` を Redis 実装へ差し替え
- room ごとの状態を Redis に集約
- WebSocket イベントは Redis Pub/Sub で共有
- ゲームタイマー実行は Redis ロックで room 単位の単一実行に制御

## 4.2 Redis 利用方針（最小）

- `room:{roomId}:snapshot` (Hash or JSON)
- `room:{roomId}:game` (String/Hash)
- `rooms:lobby` (Set)
- `room:{roomId}:events` (Pub/Sub channel)
- `room:{roomId}:timer_lock` (SET NX EX)

## 4.3 ECS Auto Scaling

- game service
- min `2`, max `20`（初期値）
- target tracking: `ECSServiceAverageCPUUtilization=60`
- target tracking: `ECSServiceAverageMemoryUtilization=70`
- ALB `RequestCountPerTarget` も追加（急増対策）

- agent service
- min `1`, max `5`（初期値）
- CPU ベースでスケール
- game とは独立スケール

---

## 5. ネットワーク・セキュリティ方針（シンプル版）

## 5.1 サブネット方針

- Public subnet (2AZ)
- internet-facing ALB のみ配置
- Private subnet (2AZ)
- ECS tasks, Redis, internal ALB を配置

## 5.2 通信制御

- SG `alb-game`
- 443 ingress: `0.0.0.0/0`
- SG `task-game`
- ingress: `alb-game` から app port のみ
- egress: `task-agent`, `redis`, `bedrock endpoint` のみ
- SG `task-agent`
- ingress: `task-game` から 8091 のみ
- SG `redis`
- ingress: `task-game` から 6379 のみ

## 5.3 外部露出

- 外部公開は CloudFront と game ALB のみ
- agent は非公開化
- CloudFront に WAF（AWS Managed Rules + rate limit）を付与
- CORS と `WS_ALLOWED_ORIGINS` を独自ドメインに固定

## 5.4 NAT と VPC Endpoint

- Bedrock 専用なら NAT なし運用を優先
- Interface/Gateway Endpoint を追加
- `com.amazonaws.ap-northeast-1.ecr.api`
- `com.amazonaws.ap-northeast-1.ecr.dkr`
- `com.amazonaws.ap-northeast-1.logs`
- `com.amazonaws.ap-northeast-1.secretsmanager`（将来用）
- `com.amazonaws.ap-northeast-1.bedrock-runtime`
- `s3` (Gateway endpoint)

---

## 6. ドメイン運用（お名前.com）

## 6.1 推奨ドメイン設計

- 公開用: `game.example.com` -> CloudFront
- オリジン用: `origin-game.example.com` -> game ALB

## 6.2 証明書

- CloudFront 用証明書: `us-east-1` の ACM
- `game.example.com` を検証
- ALB 用証明書: `ap-northeast-1` の ACM
- `origin-game.example.com` を検証

## 6.3 お名前.com 側の設定

- `game.example.com` を CloudFront ドメインへ CNAME
- `origin-game.example.com` を ALB DNS 名へ CNAME
- ACM の DNS 検証レコード（CNAME）を登録

注記:
ルートドメイン直下（`example.com`）は DNS 仕様上 CNAME を貼れないケースがあるため、まずはサブドメイン運用を前提にする。

---

## 7. Bedrock 専用化（OpenAI 削除）

- Agent コードから `OPENAI_API_KEY` と openai client 分岐を削除
- Terraform から `agent_openai_api_key` と Secrets Manager 作成を削除
- ECS task role には `bedrock:InvokeModel` のみ付与

---

## 8. 実装時の変更箇所（具体）

以下は「どこを変更するか」の実作業リスト。

## 8.1 Terraform: ネットワーク

対象:

- `infra/terraform/modules/vpc/variables.tf`
- `infra/terraform/modules/vpc/main.tf`
- `infra/terraform/modules/vpc/outputs.tf`

変更:

- `private_subnet_cidrs` 変数追加
- private route table 追加
- VPC endpoint 用 SG/endpoint リソース追加
- outputs に `private_subnet_ids` 追加

## 8.2 Terraform: Fargate サービスモジュール

対象:

- `infra/terraform/modules/fargate_service/variables.tf`
- `infra/terraform/modules/fargate_service/main.tf`
- `infra/terraform/modules/fargate_service/outputs.tf`

変更:

- `subnet_ids` を受ける（現行 `public_subnet_ids` 固定を廃止）
- `assign_public_ip` を変数化（デフォルト false）
- `internal` を変数化（agent 用）
- HTTPS listener 対応変数を追加
- Auto Scaling（`aws_appautoscaling_target`, `aws_appautoscaling_policy`）追加
- ALB idle timeout 変数化（WS向けに調整）

## 8.3 Terraform: Redis モジュール追加

新規追加:

- `infra/terraform/modules/redis/main.tf`
- `infra/terraform/modules/redis/variables.tf`
- `infra/terraform/modules/redis/outputs.tf`

内容:

- ElastiCache for Redis（最小構成）
- private subnet group
- SG で game task からのみ許可
- endpoint 出力

## 8.4 Terraform: static_frontend

対象:

- `infra/terraform/modules/static_frontend/main.tf`
- `infra/terraform/modules/static_frontend/variables.tf`

変更:

- CloudFront origin を `origin-game.example.com` へ向けられるように変数化
- origin protocol policy を `https-only` に切替
- optional で WAF ACL ARN を受け取り関連付け

## 8.5 Terraform: dev 環境定義

対象:

- `infra/terraform/environments/dev/main.tf`
- `infra/terraform/environments/dev/variables.tf`
- `infra/terraform/environments/dev/outputs.tf`
- `infra/terraform/environments/dev/terraform.tfvars.example`

変更:

- vpc module に private subnet を渡す
- redis module を追加
- `game_backend` は private subnet + no public IP
- `agent` は internal 構成 + private subnet
- `game_backend` の env に `REDIS_ADDR` を追加
- `WS_ALLOWED_ORIGINS` を独自ドメインに設定
- `agent_openai_api_key` 関連の変数と secrets 作成を削除
- `frontend_domain_aliases` と ACM ARN 設定例を「お名前.com運用」に更新

## 8.6 Game Backend: Redis 化と分散WS

対象:

- `game/backend/cmd/server/main.go`
- `game/backend/internal/domain/repository/room_repository.go`（I/Fは維持）
- `game/backend/internal/infrastructure/redis/room_repository.go`（新規）
- `game/backend/internal/interface/ws/gateway.go`
- `game/backend/internal/config/*`（Redis接続設定の追加）

変更:

- repository 実装選択を env で切替（`memory` / `redis`）
- Redis repository 実装追加
- WS broadcast を Redis Pub/Sub 経由に変更
- timer 実行を分散ロックで単一化
- move/vote/game_state/hint の配信経路を全タスク共有化

## 8.7 Agent: Bedrock 専用化

対象:

- `Agent/cmd/server/main.go`
- `Agent/internal/config/config.go`
- `Agent/internal/infrastructure/openai/client.go`（削除）
- `Agent/internal/usecase/*`（必要があればテスト修正）

変更:

- OpenAI fallback 分岐削除
- `OPENAI_API_KEY` 読み込み削除
- Bedrock 未設定時は fallback-only（非LLM）か起動エラーのどちらかに統一

## 8.8 ドキュメント更新

対象:

- `infra/terraform/README.md`
- `game/backend/README.md`
- `Agent/README.md`（存在する場合）

変更:

- 新ネットワーク構成
- Bedrock 専用運用
- ドメイン設定（お名前.com）
- デプロイ手順（証明書検証含む）

---

## 9. 段階導入プラン（推奨）

## Phase 1

- Bedrock 専用化（OpenAI 削除）
- ドメイン + CloudFront 証明書運用開始

## Phase 2

- Redis 導入
- game の repository を Redis 化
- ただし WS はまだ単一タスク運用

## Phase 3

- WS Pub/Sub 化
- game タスクの水平スケール有効化

## Phase 4

- private subnet 化
- agent 非公開化
- VPC endpoint 化
- WAF 適用

---

## 10. 受け入れ基準

- game service を `desired_count=2` 以上にしても同一 room の同期が崩れない
- 投票やゲーム進行イベントがタスク跨ぎで欠損しない
- Agent が外部公開されていない
- OpenAI シークレット/コード経路が残っていない
- お名前.com管理ドメインで CloudFront 経由アクセスが安定する

