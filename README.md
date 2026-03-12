# RSS to Discord Lambda (SAM / TypeScript)

RSS フィードを定期取得し、新着記事を Discord Webhook へ投稿する AWS SAM プロジェクトです。前回処理時刻とフィード設定は DynamoDB に保存され、EventBridge のスケジュールで定期実行されます。  
実装は 2 Lambda で責務分離しています:

- `src/handler.ts`（取得・差分抽出・SQS投入）
- `src/summary.ts`（本文取得→Bedrock で要約→Discord 投稿→成功時のみ状態更新）

## 前提

- AWS アカウントとデプロイ権限
- AWS CLI / SAM CLI インストール済み
- Node.js 18+（ローカルビルド用）
- Bedrock で Nova 2 Lite を実行できる（推論プロファイル作成済みで、該当リージョンにアクセス可能）

## セットアップ

1. 依存パッケージをインストール
   ```bash
   npm install
   ```
2. パラメータは `sam deploy --guided` で入力できます。事前に `.env` は不要で、Lambda の環境変数へ反映されます。
   - `InferenceProfileArn` : Nova 2 Lite の推論プロファイル ARN。例: `arn:aws:bedrock:us-east-2:<AccountId>:inference-profile/global.amazon.nova-2-lite-v1:0`。Nova 2 Lite は現状 inference profile 経由のみ呼び出せるため、原則ここに値を設定してください。
   - `BedrockRegion` : 上記プロファイル/モデルが存在する Bedrock 実行リージョン（例: us-east-2 のグローバル推論プロファイル）。Lambda を ap-northeast-1 に置いたままクロスリージョンで呼び出すケースも想定しています。
   - `FoundationModelId` : 推論プロファイル未指定時に使うモデル ID。デフォルト `amazon.nova-2-lite-v1:0`。対象リージョンでオンデマンド提供されている場合のみ有効です。

   `MODEL_ID` 環境変数には、`InferenceProfileArn` を指定した場合はその ARN、未指定の場合は `FoundationModelId` が入ります。

## デプロイ

1. ビルド
   ```bash
   sam build
   ```
2. デプロイ（初回は guided 推奨）

   ```bash
   make deploy-guided
   ```

   プロンプトで上記環境変数とスケジュール（デフォルト `cron(0/15 0-14 * * ? *)`）を指定してください。

3. 2回目以降のデプロイ
   ```bash
   make deploy
   ```

## Nova 2 Lite 利用時の注意

- Nova 2 Lite は推論プロファイル経由のみで呼び出せるため、`InferenceProfileArn` を必ず指定してください。未指定だと `MODEL_ID` が `amazon.nova-2-lite-v1:0` となり、オンデマンド未提供リージョンでは Bedrock で失敗します。
- Bedrock の実行リージョンは `BedrockRegion` で指定します。Lambda 配置リージョン（例: ap-northeast-1）と異なるリージョン（例: us-east-2 のグローバル推論プロファイル）でも動作しますが、クロスリージョンのレイテンシ/転送料が増えます。
- 推論プロファイルを変更する場合は ARN を更新し、再デプロイしてください。

## 運用方法

- RSS フィードの追加/変更  
  DynamoDB テーブル（`StateTableName`）にアイテムを追加/更新します。`feedUrl` ごとに `webhookUrls` / `categoryTerm` / `titleIncludes` / `lastPublishedAt` を保持します。
- 実行間隔を変更  
  テンプレートの `ScheduleExpression` パラメータ（例: `rate(15 minutes)` や cron 式）を変更して再デプロイします。
- 状態管理（DynamoDB）  
  各フィードの設定と最終処理時刻を DynamoDB テーブル（`StateTableName` 出力を参照）で管理します。キー: `feedUrl`。属性例: `webhookUrls`、`webhookUrl`(後方互換)、`categoryTerm`、`titleIncludes`、`lastPublishedAt`。`lastPublishedAt` は要約＋送信 Lambda が Discord 送信成功後にのみ更新します。
- フィード単位の Webhook・フィルタ  
  DynamoDB テーブル（`StateTableName`）の各アイテムに `webhookUrls` / `categoryTerm` / `titleIncludes` を設定します。`webhookUrls` を優先し、未設定時のみ `webhookUrl` を参照します。どちらも未設定ならそのフィードはスキップします。

### DynamoDB での設定（例）

```
TABLE_NAME=<StateTableName>
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item '{
    "feedUrl": {"S": "https://jp.finalfantasyxiv.com/lodestone/news/news.xml"},
    "webhookUrls": {"L": [
      {"S": "https://discord.com/api/webhooks/xxx/yyy"},
      {"S": "https://discord.com/api/webhooks/aaa/bbb"}
    ]},
    "categoryTerm": {"S": "メンテナンス"},
    "titleIncludes": {"S": "全ワールド メンテナンス作業のお知らせ"}
  }'
```

`lastPublishedAt` を入れれば初期状態も指定できます（ISO 文字列）。

## 構成ファイル

- `template.yaml` : SAM テンプレート（Lambda / DynamoDB / SQS / EventBridge / IAM / Bedrock 権限）
- `src/handler.ts` : Lambda ハンドラ（RSS 取得・差分抽出・SQS 投入・DynamoDB 状態管理）
- `src/summary.ts` : Lambda ハンドラ（本文取得・Bedrock 要約・Discord 投稿・成功時のみ状態更新）
- `package.json`, `tsconfig.json` : 依存と TypeScript 設定
