# コーディング規約

## 1. 目的

本ドキュメントは、開発者および AI エージェント（Claude、Codex 等）が一貫した品質でコードを実装するための指針を定める。

目的は以下とする。

- 可読性の高いコードを維持する
- 型安全性を確保する
- 明確なアーキテクチャを維持する
- テストによって品質を保証する
- AI を利用した開発の品質を安定させる

---

## 2. 基本方針

- リポジトリ内の既存コードの規約に従う
- トリッキーな実装よりも可読性を優先する
- 型安全性を重視する
- 実装とテストはセットで作成する
- `lint`、`typecheck`、`test` がすべて成功している状態を完了条件とする

---

## 3. 適用範囲

本規約は以下に適用する。

- TypeScript
- Node.js
- React / Next.js（該当するプロジェクト）
- API / バックエンド開発

人間による実装・AI による実装の両方に適用する。

CDK を使用する場合は、本規約に加えて `CDK_GUIDELINES.md` も適用する。

---

## 4. 命名規則

### 変数 / 関数

camelCase を使用する。

```
userId
getUserProfile
createSession
```

---

### 型 / クラス / コンポーネント

PascalCase を使用する。

```
User
UserProfile
AuthService
```

---

### 定数

UPPER_SNAKE_CASE を使用する。

```
MAX_RETRY_COUNT
DEFAULT_TIMEOUT
```

---

### boolean

真偽値であることが明確に分かる命名を使用する。

接頭辞: `is` / `has` / `can`

```
isActive
hasPermission
canEdit
```

---

## 5. 変数

- 再代入が不要な場合は `const` を使用する
- 再代入が必要な場合のみ `let` を使用する
- `var` の使用は禁止する

```ts
const user = getUser();
let retryCount = 0;
```

変数は可能な限り使用箇所の近くで宣言する。

---

## 6. 文字列・配列・オブジェクト

### 文字列

文字列連結ではなくテンプレートリテラルを使用する。

```ts
const message = `User ID: ${userId}`;
```

---

### 配列

リテラル構文を使用する。

```ts
const users: User[] = [];
```

---

### オブジェクト

オブジェクトリテラルを使用する。

```ts
const user = {
  id,
  name,
};
```

---

### オブジェクトコピー

スプレッド構文を使用する。

```ts
const newUser = { ...user };
```

---

## 7. 関数

原則としてアロー関数を使用する。

```ts
const getUser = (id: string): User => {
  return repository.find(id);
};
```

以下の場合に限り、function 宣言を許容する。

- スタックトレースで関数名が明確に必要な場合
- `this` のバインディングが必要なクラスメソッド
- フレームワーク仕様で function 宣言が求められる場合（Next.js の `getServerSideProps` 等）

関数設計の原則:

- 1関数1責務
- 引数は必要最小限にする
- 不要な副作用を避ける

---

## 7.5 非同期処理

非同期処理は async / await を使用する。Promise チェーン（`.then().catch()`）の raw 使用は避ける。

```ts
// NG: Promise チェーン
getUserById(id)
  .then((user) => sendEmail(user))
  .catch((error) => logger.error(error));

// OK: async / await
const user = await getUserById(id);
await sendEmail(user);
```

---

### 複数の非同期処理

並列実行できる処理は `Promise.all` を使用する。
一つでも失敗したら全体を失敗とする場合は `Promise.all`、
部分的な成功を許容する場合は `Promise.allSettled` を使用する。

```ts
// 並列実行（どれか一つでも失敗したら全体失敗）
const [user, orders] = await Promise.all([getUser(userId), getOrders(userId)]);

// 部分的な成功を許容する場合
const results = await Promise.allSettled([
  sendEmailNotification(userId),
  sendPushNotification(userId),
]);
```

---

### 未処理の Promise rejection

`await` を付け忘れた場合や、catch のない Promise は未処理の rejection を生む。
バックグラウンドで実行する処理も必ずエラーハンドリングを行う。

```ts
// NG: await なし（エラーが握りつぶされる）
sendNotification(userId);

// OK: await してエラーを処理する
await sendNotification(userId);

// バックグラウンド実行が必要な場合も catch は必須
sendNotification(userId).catch((error) => logger.error(error));
```

---

## 8. TypeScript ルール

### strict モード

TypeScript は strict モードを前提とする。

```json
{
  "strict": true
}
```

---

### type / interface

基本は `type` を使用する。

拡張や宣言マージが必要な場合のみ `interface` を使用する。

```ts
// 基本
type User = {
  id: string;
  name: string;
};

// 拡張が必要な場合のみ interface
interface AdminUser extends User {
  role: string;
}
```

---

### any

`any` は使用禁止とする。

---

### unknown

外部境界でのみ使用可能とする。

対象:

- API レスポンス
- 環境変数
- 外部ライブラリの戻り値

`unknown` を受け取った場合は、必ず型ガードで narrowing してから使用する。

```ts
// NG: unknown のまま使用
function process(value: unknown) {
  console.log(value.name); // エラー
}

// OK: 型ガードで narrowing してから使用
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value
  );
}

function process(value: unknown) {
  if (!isUser(value)) {
    throw new Error('Invalid user data');
  }
  console.log(value.name); // 安全
}
```

---

### 型アサーション

`as` の使用は最小限にする。

---

### 非 null アサーション

`!` の使用は禁止する。

---

### Enum

TypeScript の `enum` は使用しない。代わりに `as const` + ユニオン型を使用する。

`enum` はツリーシェイキングされないコードを生成し、数値 enum は型安全性が低いため。

```ts
// NG: enum
enum UserRole {
  Admin = 'admin',
  Member = 'member',
}

// OK: as const + union type
const USER_ROLE = {
  Admin: 'admin',
  Member: 'member',
} as const;

type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];
// "admin" | "member"
```

---

## 9. 条件分岐

比較には厳密等価演算子を使用する。

```ts
if (value === 1) {
}
```

---

### ネストの回避

ネストが深くなる場合は早期 return を使用する。

```ts
if (!user) {
  return null;
}
```

---

## 10. import / export

import はファイル先頭にまとめる。

import の順序は以下の順に記述し、グループ間に空行を入れる。

1. Node.js 組み込みモジュール
2. 外部ライブラリ（node_modules）
3. 内部モジュール（絶対パス / エイリアス）
4. 相対パス

```ts
import { readFile } from 'fs';

import { z } from 'zod';

import { UserRepository } from '@/repositories/user';

import { formatDate } from './utils';
```

同一モジュールの import はまとめる。ワイルドカード import は避ける。

---

### パスエイリアス（@/）

内部モジュールの import には `@/` エイリアスを使用する。
相対パスが2階層以上深くなる場合は必ず `@/` に切り替える。

```ts
// NG: 深い相対パス（読みにくく、ファイル移動時に壊れやすい）
import { UserService } from '../../../services/user';

// OK: @/ エイリアス（常に一定で読みやすい）
import { UserService } from '@/services/user';
```

環境別の設定方法は以下のとおり。いずれの環境でも `tsconfig.json` の設定は共通で必要。

**tsconfig.json（全環境共通）**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**Next.js**

`tsconfig.json` の設定のみで動作する。Next.js が内部でエイリアスを解決する。

**Vite（React 等）**

`vite.config.ts` に追加の設定が必要。

```ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
```

**Node.js（バックエンド）**

実行時のパス解決のために `tsconfig-paths` が必要。

```bash
npm install -D tsconfig-paths
```

```json
// package.json
{
  "scripts": {
    "dev": "ts-node -r tsconfig-paths/register src/index.ts"
  }
}
```

---

### default export

原則として default export を禁止する。代わりに named export を使用する。

```ts
export const getUser = () => {};
```

例外:

- Next.js のページコンポーネント
- フレームワーク仕様で必要な場合

---

## 11. コメント・JSDoc

コメントは日本語で記述する。

コメントを書く基準:

- コードを読んでも「なぜそうしているか」が分からない場合に書く
- コードを読めば分かる内容（「何をしているか」）はコメント不要

```ts
// NG: 何をしているかをそのまま書いている
// ユーザーを取得する
const user = getUser(id);

// OK: なぜそうしているかを書いている
// キャッシュが stale な可能性があるため、DB から直接取得する
const user = repository.findById(id);
```

---

### JSDoc を必須とする対象

以下のいずれかに該当する場合は JSDoc を記述する。

- 外部公開 API
- ライブラリ境界の関数・クラス
- service 層の主要な関数
- 複雑なビジネスロジック
- 副作用のある処理
- 呼び出し条件・前提・制約・例外が重要な処理

```ts
/**
 * 指定ユーザーの権限を検証する。
 * 権限がない場合は PermissionError をスローする。
 *
 * @param userId - 検証対象のユーザー ID
 * @param action - 実行しようとしているアクション
 * @throws {PermissionError} ユーザーに該当アクションの権限がない場合
 */
const validatePermission = (userId: string, action: Action): void => {
  // ...
};
```

---

### JSDoc を任意とする対象

以下は状況に応じて記述する。

- repository 層の単純な CRUD
- 内部 util 関数
- 型や関数名だけで意図が明確な処理

---

### JSDoc を不要とする対象

以下は JSDoc を書かない。

- trivial な helper 関数
- 自明な getter / mapper / formatter
- 一時的で極小のローカル関数

---

## 12. エラーハンドリング

原則:

- エラーを握りつぶさない
- 意味のあるエラーを返す
- エラーはログに記録する

```ts
// NG
catch (e) {
  return null
}

// OK
catch (error) {
  logger.error(error)
  throw new UserFetchError()
}
```

---

### カスタムエラークラス

エラーは目的に応じたクラスを作成する。
エラーの種類をクラスで表現することで、上位層でのハンドリングが明確になる。

```ts
// 基底クラス
class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// 種別ごとのエラークラス
class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} が見つかりません`, 'NOT_FOUND');
  }
}

class PermissionError extends AppError {
  constructor() {
    super('権限がありません', 'PERMISSION_DENIED');
  }
}
```

---

### レイヤー間のエラー伝搬

エラーは各レイヤーの責務に合わせて変換する。
repository 層のエラーをそのまま controller 層まで伝播させない。

```ts
// repository 層: DB エラーをドメインエラーに変換する
class UserRepository {
  async findById(id: string): Promise<User> {
    try {
      return await db.users.findOne({ id });
    } catch (error) {
      logger.error(error);
      throw new DatabaseError('ユーザー取得に失敗しました');
    }
  }
}

// service 層: ドメインルールに基づくエラーを投げる
class UserService {
  async getUser(id: string): Promise<User> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new NotFoundError('ユーザー');
    }
    return user;
  }
}

// controller 層: エラー種別に応じて HTTP レスポンスに変換する
const handler = async (req, res) => {
  try {
    const user = await userService.getUser(req.params.id);
    res.json(user);
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ message: error.message });
    } else {
      res.status(500).json({ message: 'サーバーエラー' });
    }
  }
};
```

---

## 13. ログ

ログは以下を満たすこと。

- 調査に必要な情報を含む
- 個人情報や機密情報を含まない
- 構造化ログを推奨する

出力禁止:

- パスワード
- トークン
- シークレット
- 個人情報

---

## 14. アーキテクチャ

### バックエンド構成

責務を明確に分離する。

```
controller   // HTTP リクエスト処理 / バリデーション / 認証・認可
service      // ビジネスロジック / 処理のオーケストレーション
repository   // DB アクセス / 永続化処理
```

---

### フロントエンド構成（React / Next.js）

Feature / Colocation ベースの構成を採用する。

機能単位でディレクトリをまとめ、コンポーネント・hooks・型を同じ場所に置く。

```
src/
  features/
    user/
      components/   // UIコンポーネント
      hooks/        // カスタムフック
      types/        // 型定義
      index.ts      // 外部公開する API のみを re-export
    auth/
      components/
      hooks/
      types/
      index.ts
  shared/
    components/     // 汎用コンポーネント
    hooks/          // 汎用フック
    utils/          // ユーティリティ関数
    types/          // 共通型定義
```

ルール:

- feature 間は直接 import せず、`index.ts` 経由でアクセスする
- 特定の feature にのみ依存するコードは `shared/` に置かない
- コンポーネントは表示責務（presentational）と状態管理・副作用（container/hooks）を分離することを意識する
- Next.js App Router を使用する場合は Server Components / Client Components を適切に使い分ける

---

#### Next.js App Router での Server / Client Components の使い分け

App Router を使用する場合は、データ取得・非インタラクティブな描画は Server Components、インタラクティブな操作・ブラウザ API は Client Components で実装する。

| 処理の種類                          | 推奨              |
| ----------------------------------- | ----------------- |
| データ取得（DB・API）               | Server Components |
| 認証チェック・リダイレクト          | Server Components |
| インタラクティブな UI（onClick 等） | Client Components |
| ブラウザ API（localStorage 等）     | Client Components |
| 状態管理（useState・useEffect）     | Client Components |

```tsx
// Server Component（デフォルト）
const UserProfile = async ({ userId }: { userId: string }) => {
  // サーバーサイドで直接 DB にアクセスできる
  const user = await getUserById(userId);
  return <div>{user.name}</div>;
};

// Client Component（"use client" ディレクティブが必要）
('use client');
const LikeButton = ({ postId }: { postId: string }) => {
  const [liked, setLiked] = useState(false);
  return <button onClick={() => setLiked(!liked)}>...</button>;
};
```

---

## 15. 依存関係

新規ライブラリ追加には理由が必要とする。

ルール:

- 既存ライブラリで解決できる場合は追加しない
- 同種ライブラリを複数導入しない
- 不要なユーティリティライブラリを追加しない

---

## 16. セキュリティ

以下は禁止する。

- シークレットの直書き
- SQL 文字列連結
- 未検証入力の使用
- 機密情報のログ出力

外部入力は必ず検証する。

---

### 入力バリデーションとサニタイズ

外部入力（API リクエスト・環境変数・ファイル等）は受け取り口で検証する。
バリデーションには zod などのスキーマバリデーションライブラリを使用する。

```ts
const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

const body = createUserSchema.parse(req.body);
```

---

### XSS 対策

フロントエンドでユーザー入力をそのまま HTML に埋め込まない。

```tsx
// NG: dangerouslySetInnerHTML は原則禁止
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// OK: テキストとして扱う
<div>{userInput}</div>
```

---

### 認証トークンの取り扱い

- JWT / セッショントークンは `HttpOnly Cookie` で管理する
- `localStorage` への認証トークン保存は XSS で窃取されるリスクがあるため禁止する
- API キーなどの機密情報は環境変数で管理し、クライアントサイドに露出させない

---

### CORS

API サーバーの CORS 設定は必要最小限のオリジンのみ許可する。
`Access-Control-Allow-Origin: *` の本番環境での使用は禁止する。

---

## 17. テスト方針

実装とテストは必ずセットで作成する。

テストフレームワークはプロジェクトの既存テスト基盤に従う。

以下の場合はテスト必須とする。

- 新規ロジック追加
- バグ修正

---

## 18. テストの種類

### Unit Test

対象:

- 純粋関数
- service ロジック
- ユーティリティ

外部依存はモック化する。

---

### Integration Test

対象:

- API ハンドラー
- DB
- サービス連携

---

### E2E Test

重要なユーザーフローのみ対象とする。

対象例:

- 認証
- メイン業務フロー
- データ更新処理

E2E テストは必要最小限にする。

---

## 19. テスト設計

テストは以下をカバーする。

- 正常系
- 異常系
- 境界値

---

### テスト構造

AAA パターンを使用する。

```ts
// Arrange
const user = createUser();

// Act
const result = service.getUser(user.id);

// Assert
expect(result.id).toBe(user.id);
```

---

## 20. バグ修正ルール

バグ修正時は以下の手順を必ず守る。

1. バグを再現するテストを書く
2. テストが失敗することを確認する
3. 修正する
4. テストが成功することを確認する

---

## 21. モック

以下はモック対象とする。

- 外部 API
- データベース
- ネットワーク
- 時刻
- ランダム値

実装に強く依存した過剰なモックは避ける。

---

## 22. CI

CI では以下を必須とする。

- lint（ESLint）
- format check（Prettier）
- typecheck
- unit test

CI が失敗している場合はマージ不可とする。

---

### ESLint / Prettier

プロジェクト内で ESLint と Prettier の設定を統一する。

ESLint の方針:

- `@typescript-eslint/recommended` を基本とする
- `no-console` を有効にし、logger 経由でのみ出力する
- `no-unused-vars` を有効にする
- ルールの無効化（`eslint-disable`）はコメントで理由を明記した場合のみ許容する

Prettier の方針:

- プロジェクト内で設定ファイルを共有し、フォーマットをツールに委ねる
- コードスタイルについて議論しない

---

## 23. Git

### コミットメッセージ

日本語で内容を自由に記述する。

以下の点を意識して書く。

- 「何を」ではなく「なぜ」変更したかを書く
- 1コミット1変更を意識する

```
# NG: 何をしたかだけ
ユーザー取得処理を修正

# OK: なぜ変更したかが分かる
キャッシュが stale になるケースを修正するため、ユーザー取得を DB から直接取得に変更
```

---

### ブランチ命名

以下の形式を推奨する。

```
feature/機能名
fix/バグ内容
chore/作業内容
```

---

## 24. AI エージェント利用ルール

Claude / Codex などの AI は以下を遵守する。

---

### 禁止事項

**コード品質**

- 無関係なリファクタ
- 指示のない API 変更
- テスト削除
- テストを弱めて成功させる行為
- TODO のまま実装を残す

**ファイル・ディレクトリ操作**

- 既存のディレクトリ構造・ファイル構成を無断で変更しない
- 既存ファイルの命名規則を無断で変更しない
- 複数の関係ないファイルをまとめて変更しない

**依存関係**

- ライブラリを無断で追加しない（必要な場合は理由を説明し、確認を求める）
- package.json のバージョンを無断で変更しない

---

### 必須事項

- 新規コードにはテストを追加する
- 挙動変更時は理由を説明する
- lint / typecheck / test を成功させる
- 生成したコードに対してレビュー観点（考慮漏れ・副作用・セキュリティ上の懸念等）を自己申告する
- 1タスクで変更するファイルは必要最小限にする

---

### 確認が必要な場合

以下の場合は実装を止め、人間に確認を求める。

- 要件が曖昧で複数の解釈が可能な場合
- 新規ライブラリの追加が必要な場合
- 既存のアーキテクチャから逸脱する実装が必要に見える場合
- セキュリティに関わる変更が必要な場合
- 既存テストの変更が必要な場合

---

## 25. 完了条件

以下をすべて満たした場合のみタスク完了とする。

- lint 成功
- typecheck 成功
- test 成功
- 実装意図が説明可能
