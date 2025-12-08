# RSS to Discord Lambda (SAM / TypeScript)

RSS フィードを定期取得し、新着記事を Discord Webhook へ投稿する AWS SAM プロジェクトです。前回処理時刻とフィード設定は DynamoDB に保存され、EventBridge のスケジュールで定期実行されます。

## 前提
- AWS アカウントとデプロイ権限
- AWS CLI / SAM CLI インストール済み
- Node.js 18+（ローカルビルド用）

## セットアップ
1. 依存パッケージをインストール
   ```bash
   npm install
   ```
2. 環境変数は `sam deploy --guided` で入力できます。事前に `.env` は不要です。
   - `DISCORD_WEBHOOK_URL` : （フォールバック用、通常は未使用）DynamoDB の各アイテムに `webhookUrl` があればそれを使用します。未設定でも可。

## デプロイ
1. ビルド
   ```bash
   sam build
   ```
2. デプロイ（初回は guided 推奨）
   ```bash
   sam deploy --guided
   ```
   プロンプトで上記環境変数とスケジュール（デフォルト `rate(5 minutes)`) を指定してください。

## 運用方法
- RSS フィードの追加/変更  
  DynamoDB テーブル（`StateTableName`）にアイテムを追加/更新します。`feedUrl` ごとに `webhookUrl` / `categoryTerm` / `titleIncludes` / `lastPublishedAt` を保持します。
- 実行間隔を変更  
  テンプレートの `ScheduleExpression` パラメータ（例: `rate(15 minutes)` や cron 式）を変更して再デプロイします。
- 状態管理（DynamoDB）  
  各フィードの設定と最終処理時刻を DynamoDB テーブル（`StateTableName` 出力を参照）で管理します。キー: `feedUrl`。属性例: `webhookUrl`(必須)、`categoryTerm`、`titleIncludes`、`lastPublishedAt`。
- フィード単位の Webhook・フィルタ  
  DynamoDB テーブル（`StateTableName`）の各アイテムに `webhookUrl` / `categoryTerm` / `titleIncludes` を設定します。`webhookUrl` は必須（未設定ならそのフィードはスキップ）。`lastPublishedAt` も同じアイテムで管理します。

### DynamoDB での設定（例）
```
TABLE_NAME=<StateTableName>
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item '{
    "feedUrl": {"S": "https://jp.finalfantasyxiv.com/lodestone/news/news.xml"},
    "webhookUrl": {"S": "https://discord.com/api/webhooks/xxx/yyy"},
    "categoryTerm": {"S": "メンテナンス"},
    "titleIncludes": {"S": "全ワールド メンテナンス作業のお知らせ"}
  }'
```
`lastPublishedAt` を入れれば初期状態も指定できます（ISO 文字列）。

## 構成ファイル
- `template.yaml` : SAM テンプレート（Lambda / DynamoDB / EventBridge / IAM）
- `src/handler.ts` : Lambda ハンドラ（RSS 取得・Discord 投稿・DynamoDB 状態管理）
- `package.json`, `tsconfig.json` : 依存と TypeScript 設定
