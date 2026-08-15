# 再開ガイド

このプロジェクトは 2026-08-15 に凍結した。再開時は、当時の判断と動作状態を壊さずに新しい検証を始める。

## まず読むもの

1. `README.md`
2. `docs/PROJECT_CLOSEOUT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/FUTURE_REUSE.md`

## 保存ブランチ

### `archive/final-v0.1.19-2026-08-15`

凍結前の最終実験アプリそのもの。新しい凍結案内や資料変更を加える前のスナップショット。

### `backup/v0.1.18-review-first`

各明細を1件ずつ人間が確認してから集計する旧方式。最終v0.1.19の「先に集計して要確認だけ直す」UXと比較したい場合に使用する。

## 再開方法

mainを直接書き換えず、目的別の新ブランチを作る。

例:

```text
feat/receipt-tax-ingestion
experiment/handwriting-v2
prototype/document-batch-import
```

凍結版を完全に維持したい場合は `archive/final-v0.1.19-2026-08-15` を参照用に残す。

## 手書き注文票を再開する場合

コード変更より先に、現在利用可能なモデルで実データの認識テストを行う。

最低限測るもの:

- 商品名完全一致率
- 数量正解率
- 注文者所属正解率
- 注文行の欠落率
- 重複率
- order正解率
- 人間が修正しなければならない割合

UIを再開発する前に、このベンチマークが業務上許容できることを確認する。

## 領収書・PDF用途へ転換する場合

推奨方針:

1. PWA shellを流用
2. SCAN_IDをdocument job IDとして流用
3. Custom GPT ActionまたはサーバーAIから共通schemaを返す
4. `instant-results-core.js` 相当を経費集計ロジックへ交換
5. 要確認方式は維持
6. セッション履歴 / backupを流用
7. 重複検出を新規追加
8. PDFのnative text抽出を優先できる場合はVisionだけに依存しない

## 現在の外部依存

### Custom GPT

手書き注文票解析専用GPTが存在する。再利用時にはInstructions/schemaを新用途へ変更する必要がある。

### Cloudflare Worker

実証用Action API:

`https://order-sheet-action-api.tamafit-takamatsu.workers.dev`

Worker/KVは将来も存在する保証をしない。再開時に `/health` とOpenAPIを確認すること。

Secretはリポジトリに存在しない。再デプロイ時は適切なSecretを再設定する。

### GitHub Pages

公開PWA:

`https://tamafit.github.io/order-sheet-pwa/`

凍結後は実証資料として残す。再開する場合、公開版をそのまま変更するより、新ブランチ/別repository/preview環境で検証してから切り替える。

## ローカルデータに注意

商品DB・aliases・recognition history・sessions等は端末側に保持される。

ブラウザのサイトデータ削除、PWAのデータ削除、端末変更等で失われる可能性があるため、必要な既存データがある場合はアプリのJSON exportを使用する。

## 再開時にやらないこと

- archive branchを直接開発ブランチとして使う
- SecretをGitHubへcommitする
- OCR/Vision精度を未検証のままUIだけ作り込む
- Custom GPTの出力を唯一の永続データとして扱う
- 手書き注文票専用schemaを別用途へ無理に流用する

## 新プロジェクトとして切り出す判断

領収書・確定申告用途が本格化する場合は、このrepositoryを永久に名前だけ変えて使うより、新repositoryを作り、必要なモジュールだけ移植する方が履歴を理解しやすい。

推奨:

```text
order-sheet-pwa
  = 実証・技術資料として凍結

future receipt/tax app
  = 新repository
     ↑ 必要な基盤をorder-sheet-pwaから移植
```

このrepositoryは「なぜその設計になったか」を確認できる一次資料として残す。
