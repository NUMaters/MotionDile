# medea-pipeline

右手ジェスチャーでワニを操作するための学習ディレクトリです。
このディレクトリでは、以下を行います。

- 学習データ収集（ブラウザ + MediaPipe）
- 口開閉と首傾きのパラメータ学習
- 学習済みモデル JSON の出力
- ゲーム本体への反映（`public/models/hand-control-model.json`）

## 構成

- `collect.html`: 収集UI（日本語）。右手を映してサンプルを記録
- `backend/cmd/server/main.go`: 学習データ保存 + 学習実行 API（Go）
- `scripts/train-hand-control-model.ts`: 学習スクリプト（TypeScript、`npx tsx` で実行）
- `data/`: 収集した学習データ
- `models/`: 学習済みモデルのローカル出力

## 使い方

1. 収集ページを開く
   - `npm run dev` 実行後、`https://<PC-IP>:5173/medea-pipeline/collect.html` を開く
2. 学習データを記録
   - 手の開閉ラベル（開く/閉じる）を記録
   - **向きラベリングスティック**で yaw/pitch を指定して首傾きサンプルを記録
3. JSON を出力
   - 「JSON出力（前回分に追加）」で、既存データ + 今回データをマージした JSON を作成
   - 出力後に `POST /api/pipeline/train`（Go backend）を呼び、**自動で学習**して `public/models/hand-control-model.json` へ反映
   - ブラウザの `localStorage` にも保存され、次回アクセス時に自動復元
4. 学習実行
   - `npm run pipeline:train`
5. ゲーム反映
   - `public/models/hand-control-model.json` が更新される
   - 既存モデルがある場合、`pipeline:train` は**重み付きで前モデルに追加学習**される

収集画面の手特徴量（`tiltAngle` / `pitchAngle` / `avgCurl`）は、映像を CSS 反転しない前提で、**制御用にランドマークを `(x,y)→(1-x,1-y)` してから**ゲーム本体と同じ式で算出しています（既存 JSON を流用する場合は再収集または学習の再実行を推奨）。

## データ形式（概要）

```json
{
  "version": 1,
  "samples": [
    {
      "avgCurl": 0.74,
      "tiltAngle": 0.12,
      "pitchAngle": -0.03,
      "mouthLabel": 1,
      "targetYaw": 0.20,
      "targetPitch": -0.10
    }
  ]
}
```

