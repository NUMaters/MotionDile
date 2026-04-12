# modeling — ワニモデル調整・プレビュー

ゲーム用 GLB の生成元データとビューアをこのディレクトリにまとめています。

| ファイル / ディレクトリ | 説明 |
|---|---|
| `Walking_wani.glb` | ソースモデル（リグ＋歩行クリップ） |
| `Wani_game.glb` | `npm run build:model` で生成するゲーム用モデル（8 クリップ） |
| `Wani_game.meta.json` | 生成時のメタ情報 |
| `viewer.html` | Three.js プレビュー（HTTP 経由で開くこと） |
| `scripts/build-wani-game-model.mjs` | 顎分割・口腔・アニメ生成パイプライン |
| `Meshy_AI_*_fbx/` | 参考用テクスチャ・FBX（任意） |

ルートの `package.json` から実行します（依存はリポジトリルートの `node_modules`）。

```bash
# リポジトリルートで
npm run build:model   # このディレクトリへ Wani_game.glb を出力
npm run viewer        # modeling を静的配信 → http://localhost:3000/viewer
```

詳細な操作・技術説明はリポジトリルートの [README.md](../README.md) を参照してください。
