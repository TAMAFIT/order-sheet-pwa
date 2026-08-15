# 最終アーキテクチャ

この文書は 2026-08-15 時点の凍結版 `v0.1.19` の構成を記録する。

## 全体フロー

```text
[スマホ / PWA]
  撮影・画像選択
        |
        v
[SCAN_ID生成 + 共有画像作成]
        |
        v
[専用Custom GPT]
  Vision解析
        |
        | submitScanResult
        v
[Cloudflare Worker]
  Bearer認証
  payload検証
        |
        v
[Cloudflare KV: RESULTS]
  SCAN_IDをkeyに一時保存
        ^
        |
[PWAへ戻る]
  GET /scan/{scan_id}
        |
        v
[構造化items]
        |
        +--> 商品別即時集計
        +--> 要確認抽出
        +--> 明細編集 / 削除 / 追加 / 並べ替え
        +--> ローカルDB学習 / 履歴
```

## PWA

公開先:

- https://tamafit.github.io/order-sheet-pwa/

主な役割:

- 画像入力
- SCAN_ID lifecycle
- Custom GPTへの引き渡し
- Action結果の取得
- itemsのパース
- 商品別集計
- 要確認表示
- 明細修正
- セッション履歴
- 商品DB / alias学習
- バックアップ
- GitHub Pages/PWA配信

主要ファイル:

- `index.html` — UI
- `app.js` — メイン画面・集計・編集フロー
- `ai.js` — Custom GPTへの共有用画像と指示生成
- `scan-session.js` — SCAN_ID管理
- `action-return.js` / `action-return-core.js` — Worker結果の復帰処理
- `instant-results-core.js` — 即時集計と要確認判定
- `review-edit-core.js` — 明細追加・削除等
- `review-reorder-v18.js` — タッチ並べ替え
- `session-history-core.js` — セッション保存・復元
- `db.js` — ローカル学習DB
- `lib.js` — 正規化・候補判定等
- `catalog-db.js` / `catalog-core.js` — 商品カタログ
- `sw.js` — PWAキャッシュ

## Custom GPT

役割:

- 固定フォーマット画像の読み取り
- 商品名・数量・注文者・取消・order等を構造化
- SCAN_IDをそのまま保持
- 最後に `submitScanResult` Actionを1回実行

重要な運用上の制約:

- Android/iOSでPWAから特定Custom GPTへ画像を完全自動添付する経路は保証できない
- GPT Actionの実行時にユーザー承認が表示される場合がある
- GPTから元のPWAへ自動的に画面遷移させる仕組みは前提にしない
- ユーザーがPWAへ戻った後、PWA側が結果を取得する

## Action API / Cloudflare Worker

参照実装:

- `cloudflare-action-api/`

公開endpointの実証先:

- `https://order-sheet-action-api.tamafit-takamatsu.workers.dev`

主なendpoint:

- `GET /health`
- `GET /openapi.json`
- `POST /scan-result`
- `GET /scan/{scan_id}`

ストレージ:

- Cloudflare KV binding: `RESULTS`

認証:

- Bearer API key
- Secret値そのものはリポジトリへ保存しない

結果は長期DBではなく一時受け渡し用途として設計した。

## Action payload

最終的にPWAが扱う明細の中心フィールド:

```json
{
  "order": 1,
  "place": "",
  "time": "",
  "person": "",
  "name": "商品名",
  "quantity": 1,
  "confidence": 0.95,
  "cancelled": false,
  "note": ""
}
```

重要事項:

- GPT側では商品を合算せず、紙面明細単位で返す
- 集計はPWA側で行う
- `cancelled=true` は集計対象外
- 数量不明時は運用上1として残す設計に変更された
- `order` は紙面順修正に利用

## 即時集計方式 v0.1.19

最終UXでは「全件確定」を廃止し、結果受信時点で商品別集計を表示する。

概念:

```text
AI items
  |
  +-- 読めている ------------------> 集計へ即反映
  |
  +-- 低confidence / noteあり ------> 集計 + 要確認
  |
  +-- 判読不明 ---------------------> 要確認のみ
  |
  +-- cancelled --------------------> 明細保持・集計除外
```

ユーザーが修正すると、同じstateから集計を再計算する。

## ローカルデータ

主な用途:

- products
- aliases
- recognitionHistory
- locationHistory
- sessions
- settings

商品辞書と訂正履歴は端末側データであり、ブラウザのサイトデータを消すと失われる可能性がある。そのためJSON export/importを用意している。

商品カタログは学習DBと別のIndexedDB領域へ保存する構成。

## イオン綾川カタログ実験

公開商品カタログを静的shardとしてPWAへ組み込み、ローカル検索できるようにした。

目的:

- AIの手書き結果を既存商品候補へ寄せる
- 選択された商品だけローカル学習DBへ登録
- 大規模カタログを通常localStorageへ直接持ち込まない

ただし、カタログ照合で手書きVisionの根本的な誤読を完全に補えるわけではなかった。

## セキュリティ境界

### クライアントへ置いてよいもの

- 公開API endpoint
- SCAN_ID
- 非Secret設定
- 商品辞書
- UI状態

### クライアントへ置かないもの

- Action API key
- OpenAI API key
- Cloudflare Secret
- OAuth token
- パスワード

## 再利用時に切り離せる層

このアーキテクチャは入力解析層を交換できる。

```text
[入力]
  手書き画像  ← 今回はここがボトルネック
        |
        v
[AI構造化層]  ← 別VLM/OCR/APIへ差替可能
        |
        v
[Action / Result transport]  ← 再利用可能
        |
        v
[PWA result/review layer]     ← 再利用可能
        |
        v
[集計 / export]               ← 用途別に交換
```

将来の領収書・PDFアプリでは、主に「入力スキーマ」「解析プロンプト」「集計ロジック」を交換し、SCAN_ID結果返却・例外確認・履歴・バックアップの考え方を再利用する。
