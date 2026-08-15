# 手書き注文 集計アシスタント

手書きの個人別注文票を商品単位へ集約し、同じ商品の表記揺れ・略称・売り場A〜Eを人間の訂正から蓄積していくPWAです。

## 現在のプロトタイプでできること

- スマホで注文票を撮影 / 複数画像選択
- 無料ChatGPTモード用の専用解析プロンプト生成
- Android等の共有シート経由で画像＋プロンプトをChatGPTへ送る
- ChatGPTが返したJSONを貼り付けて商品別に自動集計
- 既存商品・別表記との類似度から候補を提示
- 人間が一度商品を確定すると、その表記を別名DBへ保存
- 記入者タグ別の表記履歴を保持し、同じ記入者の一致を候補順位へ反映
- 商品ごとの売り場 A / B / C / D / E / 未設定 を保存
- 売り場変更履歴を保存
- 合計数量を売り場順で表示、共有、印刷
- 商品DBの検索・追加・別表記追加
- 学習DBをJSONでエクスポート / インポート
- PWAとしてホーム画面へインストール
- 静的部分はオフライン利用可能

## 重要: OCR / AIについて

このGitHub Pages版だけでは、OpenAIやGeminiのAPIキーを安全に保持できないため、APIキーをブラウザへ直接埋め込んでいません。

現在は以下の2経路です。

1. **無料ChatGPTモード**: 画像＋プロンプトをChatGPTへ送り、返却JSONをPWAへ貼り戻す。API料金不要。
2. **安全なバックエンド自動モード**: GAS / Cloudflare Worker / Cloud Run等のHTTPS中継を別途接続すると、撮影→解析→集計をワンタップ化できる。PWAには中継URLのみ設定し、AI APIキーはサーバー側Secretへ置く。

APIキー、OAuth token、パスワードはこのrepositoryへ保存しないでください。

## 学習DB設計

端末内DBには以下を保持します。

- `products`: 正式商品。固定ID、正式名、現在売り場、active状態
- `aliases`: 略称・OCR誤読・人ごとの書き方と正式商品IDの対応
- `recognitionHistory`: AI候補と人間が選んだ最終正解
- `locationHistory`: 商品の売り場変更履歴
- `writers`: 任意の記入者タグ
- `sessions`: 集計単位の要約
- `settings`: AIバックエンドURL等の非Secret設定

画像そのものは学習DBへ保存しません。個人名等を長期保存しない設計です。

## データが育つ流れ

1. 新しい表記をAIが読む
2. 既存の正式名・別表記と文字列類似度で候補を出す
3. 高信頼一致は自動採用、曖昧なものだけ確認画面へ出す
4. 人間が「この表記 = この商品」と一度選ぶ
5. その表記をverified aliasとして保存
6. 次回から候補順位が上がる
7. 新商品なら正式商品として追加し、必要なら売り場を登録

## クライアント移植

PWA本体はVoiceDev Masterへruntime依存しません。

納品時の基本手順:

1. クライアント所有GitHub repositoryへコードを移す
2. 現場で育てたDBを「DBを書き出す」でJSONエクスポート
3. クライアント環境で「DBを読み込む」
4. 完全自動解析が必要ならクライアント所有の安全なAIバックエンドを接続
5. APIキーはバックエンドSecretへ配置し、PWAへは置かない

このため、試験運用で育てた商品辞書・別表記・売り場履歴を捨てずに移管できます。

## AIバックエンド契約

PWAは設定されたHTTPS endpointへ以下のJSONをPOSTします。

```json
{
  "prompt": "...",
  "writerTag": "担当A",
  "images": [
    {
      "name": "sheet.jpg",
      "type": "image/jpeg",
      "dataUrl": "data:image/jpeg;base64,..."
    }
  ]
}
```

返却は次の形にします。

```json
{
  "items": [
    {
      "name": "らくれん",
      "quantity": 2,
      "confidence": 0.95,
      "cancelled": false,
      "note": ""
    }
  ]
}
```

プロバイダ固有ロジックはバックエンド側へ閉じ込めるため、OpenAI / Gemini等を差し替えてもPWAと学習DBは維持できます。

## 開発

依存パッケージなしのES Modules構成です。GitHub Pagesでそのまま配信できます。

- `index.html` UI
- `app.js` 画面・集計フロー
- `db.js` ローカル学習DB
- `lib.js` 正規化・類似度・候補判定・集計
- `ai.js` ChatGPT共有 / secure backend adapter
- `sw.js` オフラインキャッシュ

