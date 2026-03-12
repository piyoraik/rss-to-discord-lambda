# RSS / HTML 差分判定仕様（個人用途向け）

## 1. 目的

本仕様は、個人用途の RSS / Atom および HTML 一覧ページ監視において、新着判定ルールをシンプルに運用するための方針を定義する。

本仕様の目的は以下とする。

- 監視対象ごとの差分判定基準を DynamoDB で管理できるようにする
- コード側を過度に複雑にせず、少数の設定で運用できるようにする
- 標準的な RSS / Atom は `auto` で処理し、例外的な対象のみ設定で上書きする
- 個人用途として扱いやすさを優先する

---

## 2. 基本方針

- 差分判定の基準は対象ごとに DynamoDB で管理する
- 判定方式は少数の選択肢に限定する
- `sourceType` を指定しない場合は `rss` を使う
- `dedupeStrategy` を指定しない場合は `auto` を使う
- 複雑な仕様完全準拠より、少ない対象を安定運用できることを優先する
- 問題が起きた対象だけ設定を追加する

---

## 3. 設計方針

### 3.1 なぜ DynamoDB 管理にするか

個人用途では以下の要件が優先される。

- 新しい feed や一覧ページをすぐ追加したい
- 対象ごとの癖に簡単に対応したい
- コード修正や再デプロイを極力減らしたい

そのため、差分判定基準と取得方式は DynamoDB の設定値で切り替えられるようにする。

### 3.2 なぜ設定項目を少なくするか

設定の自由度を上げすぎると以下の問題が起きる。

- 設定ミスが増える
- 運用時に何を選べばよいか分かりにくくなる
- コードの検証パターンが増えすぎる

そのため、設定項目は必要最小限に絞る。

---

## 4. 監視対象設定

各対象の設定は DynamoDB に 1 item で保存する。

```ts
type SourceType = 'rss' | 'html';

type FeedConfig = {
  feedUrl: string;
  sourceType?: SourceType;
  webhookUrl?: string;
  webhookUrls?: string[];
  categoryTerm?: string;
  titleIncludes?: string | string[];
  baselineTitle?: string;
  lastPublishedAt?: string;
  latestTitle?: string;
  processedItemKeys?: string[];
  baselineItemKey?: string;
  dedupeStrategy?: DedupeStrategy;
  dateField?: DateField;
  htmlItemSelector?: string;
  htmlLinkSelector?: string;
  htmlTitleSelector?: string;
};
```

---

## 5. 設定項目

### 5.1 必須項目

- `feedUrl`

### 5.2 取得方式

- `sourceType`

```ts
type SourceType = 'rss' | 'html';
```

- 未設定時は `rss`
- `rss` は RSS / Atom XML として取得する
- `html` は HTML 一覧ページとして取得する

### 5.3 通知先

- `webhookUrl`
- `webhookUrls`

`webhookUrls` を優先し、未設定時のみ `webhookUrl` を参照する。

### 5.4 フィルタ

- `categoryTerm`
- `titleIncludes`
- `baselineTitle`
- `latestTitle`

`titleIncludes` は文字列、文字列配列、String Set を許可し、OR 条件で評価する。

`baselineTitle` と `latestTitle` は主に `sourceType = html` の一覧ページ監視で使う。

### 5.5 差分判定関連

- `lastPublishedAt`
- `processedItemKeys`
- `baselineItemKey`
- `dedupeStrategy`
- `dateField`

`baselineItemKey` は、初回実行時に「ここまでは既知」と見なす itemKey を表す。

- 主に `html + id_only` や `html + link_only` の初回全件通知を避けるために使う
- `processedItemKeys` が空、かつ `lastPublishedAt` も空のときだけ有効
- 現在の取得結果で `baselineItemKey` より前に並ぶ item のみを新着候補とする
- `baselineItemKey` 自体と、それ以降の item は既知として扱う

例:

```json
{
  "feedUrl": "https://forum.square-enix.com/ffxiv/forums/537-%E3%83%97%E3%83%AD%E3%83%87%E3%83%A5%E3%83%BC%E3%82%B5%E3%83%BC%E3%83%AC%E3%82%BF%E3%83%BCLIVE",
  "sourceType": "html",
  "htmlItemSelector": "li.threadbit",
  "htmlLinkSelector": "a.title",
  "htmlTitleSelector": "a.title",
  "dedupeStrategy": "id_only",
  "baselineItemKey": "524736"
}
```

この場合、現在一覧に `id:524736` が含まれていれば、それより新しい上側の item のみが通知対象になる。

### 5.5.1 HTML タイトル基準

`sourceType = "html"` の場合は、`processedItemKeys` を増やし続ける代わりに `baselineTitle` と `latestTitle` を基準にできる。

- `baselineTitle`
  - 初回実行時の既知タイトル
- `latestTitle`
  - 前回正常通知時点で一覧先頭だったタイトル

判定ルール:

1. `latestTitle` があればそれを優先する
2. `latestTitle` が無ければ `baselineTitle` を使う
3. 一覧上でそのタイトルより上にある item のみを新着候補とする
4. 一致タイトルが取得結果に無い場合は全件通知せず、今回の候補をスキップする

この方式は、forum のように一覧が新しい順で安定している HTML ページ向けとする。

### 5.6 HTML selector

`sourceType = "html"` の場合、以下 3 項目を必須とする。

- `htmlItemSelector`
- `htmlLinkSelector`
- `htmlTitleSelector`

各項目の意味は以下の通り。

- `htmlItemSelector`
  - 1 件分の記事やスレッドを表す要素を抽出する selector
- `htmlLinkSelector`
  - 各 item 要素の中からリンク要素を抽出する selector
- `htmlTitleSelector`
  - 各 item 要素の中からタイトル文字列を抽出する selector

forum 一覧ページの例:

```json
{
  "feedUrl": "https://forum.square-enix.com/ffxiv/forums/537-%E3%83%97%E3%83%AD%E3%83%87%E3%83%A5%E3%83%BC%E3%82%B5%E3%83%BC%E3%83%AC%E3%82%BF%E3%83%BCLIVE",
  "sourceType": "html",
  "htmlItemSelector": "li.threadbit",
  "htmlLinkSelector": "a.title",
  "htmlTitleSelector": "a.title",
  "dedupeStrategy": "id_only"
}
```

---

## 6. dedupeStrategy

差分判定方式は以下の少数の選択肢に限定する。

```ts
type DedupeStrategy = 'auto' | 'link_only' | 'date_only' | 'id_only';
```

### 6.1 auto

標準的な RSS / Atom 用の既定値。

判定順:

1. `id`
2. `guid`
3. `link`
4. `title + link` のハッシュ
5. `title` のハッシュ

日時取得順:

1. `published`
2. `updated`
3. `pubDate`
4. `dc:date`
5. `date`

用途:

- 通常はこれを使う
- `sourceType = rss` の既定値として使う

### 6.2 link_only

`link` を主キーとして判定する。

用途:

- `guid` や `id` が不安定な feed
- URL が安定していて分かりやすい feed
- HTML 一覧ページでリンクを一意キーとして使いたい場合

### 6.3 date_only

日時のみで判定する。

用途:

- 記事 ID や link が信用できない feed
- 更新日時ベースで拾いたい feed

注意:

- 個人用途では便利だが、再投稿や見逃しが起こりやすいため例外的に使う
- HTML 一覧ページには通常向かない

### 6.4 id_only

`id` または `guid` のみで判定する。

用途:

- Atom の `id` や RSS の `guid` が安定している feed
- HTML 一覧ページで DOM の id 属性から安定した識別子を取得できる場合

---

## 7. dateField

`date_only` のときに優先して使用する日時項目。

```ts
type DateField = 'published' | 'updated' | 'pubDate' | 'dc:date';
```

未設定時は以下の順で取得する。

1. `published`
2. `updated`
3. `pubDate`
4. `dc:date`
5. `date`

---

## 8. processedItemKeys

`processedItemKeys` は処理済み記事の識別子一覧を保持する。

```ts
type processedItemKeys = string[];
```

### 8.1 役割

- 二重投稿防止
- 日時が不安定な feed の補助
- `auto` / `link_only` / `id_only` の主判定
- RSS / Atom の重複防止

### 8.2 更新タイミング

- Discord 投稿成功後に更新する

### 8.3 保持件数

推奨:

- 50 件

---

## 9. lastPublishedAt

`lastPublishedAt` は日時判定の補助情報として保持する。

### 9.1 用途

- `date_only` の主判定
- `auto` の補助判定
- 初回実行時の境界管理

### 9.2 注意

- `lastPublishedAt` 単独で全対象を処理しない
- 主判定は原則 `processedItemKeys` または記事キーとする
- `lastBuildDate` や feed ルートの `updated` は記事単位の新着判定に使わない

---

## 10. 判定ルール

### 10.1 取得方式の切り替え

1. `sourceType` が未設定なら `rss` として扱う
2. `sourceType = rss` の場合は RSS / Atom パーサで item を抽出する
3. `sourceType = html` の場合は HTML を取得し、selector で item を抽出する
4. 差分判定と通知処理は取得方式にかかわらず共通ロジックで処理する

### 10.2 HTML item の抽出ルール

`sourceType = html` の場合、以下の手順で item を生成する。

1. `htmlItemSelector` で item 要素を列挙する
2. 各 item の中から `htmlLinkSelector` でリンク要素を取得する
3. 各 item の中から `htmlTitleSelector` でタイトル文字列を取得する
4. `href` は `feedUrl` を基準に絶対 URL 化する
5. 記事識別子は以下の順で取得する
   1. リンク要素の `id`
   2. item 要素の `id`
   3. `href`
6. DOM の `id` が `thread_title_524736` や `thread_524736` の場合は末尾数値を識別子として使う

HTML 監視では通常 `publishedAt` を持たないため、一覧順とタイトル基準を使う。

### 10.2.1 HTML タイトル基準の適用

1. `latestTitle` があれば、それを基準タイトルとする
2. `latestTitle` が無ければ `baselineTitle` を基準タイトルとする
3. 基準タイトルと一致する item が見つかったら、それより前にある item のみを新着候補とする
4. 基準タイトルが見つからない場合は、安全側に倒して新着候補を 0 件とする
5. 通知成功後は、その実行で通知対象になった先頭 item のタイトルを `latestTitle` として保存する

### 10.2.1 baselineItemKey の適用

以下の条件を満たす場合にだけ `baselineItemKey` を適用する。

1. `baselineItemKey` が設定されている
2. `processedItemKeys` が空である
3. `lastPublishedAt` が未設定である

適用時の挙動:

1. 現在取得した item 一覧から `baselineItemKey` と一致する item を探す
2. 一致した item より前にある item のみを新着候補とする
3. 一致した item 自体と、それより後ろの item は既知として扱う
4. 一致する item が取得結果に無い場合は基準を適用しない

### 10.3 auto

1. item ごとに識別子を生成する
2. `processedItemKeys` に存在しないものを新着候補とする
3. `publishedAt` がある場合は `lastPublishedAt` を補助条件として使う
4. `sourceType = html` の場合は `publishedAt` を持たないことがあるため、`processedItemKeys` を主判定とする

### 10.4 link_only

1. `link` を記事キーとする
2. `processedItemKeys` に無ければ新着候補とする

### 10.5 id_only

1. `id` または `guid` を記事キーとする
2. `processedItemKeys` に無ければ新着候補とする

### 10.6 date_only

1. `dateField` から日時を取得する
2. `lastPublishedAt` より新しければ新着候補とする

---

## 11. 推奨運用

### 11.1 基本ルール

- RSS / Atom はまず `sourceType` を設定せずに登録する
- HTML 一覧ページは `sourceType = html` を設定する
- `dedupeStrategy` を設定しない場合は `auto`
- 問題が出た対象のみ設定を追加する

### 11.2 変更手順

1. 新規 RSS / Atom は `auto` で登録する
2. HTML 一覧ページは selector 3 項目と `id_only` または `link_only` を設定して登録する
3. 二重投稿や見逃しが出たらログを確認する
4. 対象の性質に応じて `link_only` / `date_only` / `id_only` に切り替える

---

## 12. 設定例

### 12.1 標準的な Atom / RSS

```json
{
  "feedUrl": "https://jp.finalfantasyxiv.com/lodestone/news/topics.xml",
  "webhookUrls": ["https://discord.com/api/webhooks/xxx/yyy"]
}
```

この場合は `sourceType = rss`、`dedupeStrategy = auto` を使う。

### 12.2 updated ベースで扱いたい feed

```json
{
  "feedUrl": "https://jp.finalfantasyxiv.com/lodestone/news/topics.xml",
  "webhookUrls": ["https://discord.com/api/webhooks/xxx/yyy"],
  "dedupeStrategy": "date_only",
  "dateField": "updated"
}
```

### 12.3 link ベースで扱いたい feed

```json
{
  "feedUrl": "https://example.com/rss.xml",
  "webhookUrls": ["https://discord.com/api/webhooks/xxx/yyy"],
  "dedupeStrategy": "link_only"
}
```

### 12.4 guid / id ベースで扱いたい feed

```json
{
  "feedUrl": "https://example.com/atom.xml",
  "webhookUrls": ["https://discord.com/api/webhooks/xxx/yyy"],
  "dedupeStrategy": "id_only"
}
```

### 12.5 forum 一覧ページを HTML 監視したい場合

```json
{
  "feedUrl": "https://forum.square-enix.com/ffxiv/forums/537-%E3%83%97%E3%83%AD%E3%83%87%E3%83%A5%E3%83%BC%E3%82%B5%E3%83%BC%E3%83%AC%E3%82%BF%E3%83%BCLIVE",
  "sourceType": "html",
  "webhookUrls": ["https://discord.com/api/webhooks/xxx/yyy"],
  "htmlItemSelector": "li.threadbit",
  "htmlLinkSelector": "a.title",
  "htmlTitleSelector": "a.title",
  "baselineTitle": "「第90回FFXIVプロデューサーレターLIVE」のまとめを公開！ (2025/12/15)"
}
```
