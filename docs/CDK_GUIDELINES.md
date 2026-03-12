# AWS CDK コーディング規約

## 1. 目的

本ドキュメントは、AWS CDK を用いた Infrastructure as Code の実装において、可読性・保守性・安全性・再利用性を担保するためのコーディング規約を定義する。

本規約は、人間による実装だけでなく、Claude / Codex などの AI エージェントによる実装にも適用する。

目的は以下とする。

- 再現可能なインフラ構築を実現する
- Stack / Construct の責務を明確にする
- 環境差分を安全に管理する
- セキュリティ事故を防ぐ
- AI による CDK コード生成の品質を安定させる

---

## 2. 基本方針

- Stack はデプロイ単位・構成の見取り図として扱う
- Construct は再利用可能なインフラ部品として扱う
- L2 Construct を優先し、L1 Construct は必要な場合のみ使用する
- 環境差分はコード分岐ではなく設定値で吸収する
- シークレットはコードに直書きしない
- IAM は最小権限を原則とする
- `cdk synth` と `cdk diff` で差分確認できる状態を維持する
- 実装とテストをセットで作成する

---

> **関連規約**: CDK コードは TypeScript で記述するため、本規約に加えて `CODING_GUIDELINES.md` の TypeScript ルールも適用する。

---

## 3. 推奨ディレクトリ構成

推奨ディレクトリ構成は以下とする。

```text
cdk/
  bin/
    app.ts
  lib/
    stacks/
      network-stack.ts
      application-stack.ts
      database-stack.ts
      monitoring-stack.ts
    constructs/
      networking/
        vpc-construct.ts
        security-group-construct.ts
      application/
        alb-construct.ts
        ecs-service-construct.ts
        lambda-function-construct.ts
      database/
        rds-construct.ts
        redis-construct.ts
      monitoring/
        alarm-construct.ts
        dashboard-construct.ts
    config/
      env/
        dev.ts
        stg.ts
        prod.ts
      types.ts
    helpers/
      naming.ts
      tags.ts
      policies.ts
  test/
    stacks/
      network-stack.test.ts
      application-stack.test.ts
    constructs/
      alb-construct.test.ts
      ecs-service-construct.test.ts
  cdk.json
  package.json
  tsconfig.json
```

---

## 3.1 ディレクトリの役割

### bin/

CDK アプリケーションのエントリーポイントを配置する。
各 Stack の生成、環境ごとの設定読み込み、タグ付与などの起点とする。

---

### lib/stacks/

Stack を配置する。
Stack は「何をまとめてデプロイするか」を表現する場所であり、詳細な実装を書きすぎない。

---

### lib/constructs/

再利用可能な Construct を配置する。
複数リソースをまとめたインフラ部品や、プロジェクト標準の構成をここに閉じ込める。

---

### lib/config/

環境ごとの設定値と型定義を配置する。
環境差分はここで吸収し、Stack / Construct 内で `if (env === "prod")` のような分岐を極力行わない。

---

### lib/helpers/

命名規則、タグ付与、共通 IAM Policy 生成など、CDK 特有の補助処理を配置する。
単なるユーティリティの乱立は避け、再利用意図が明確なもののみ置く。

---

### test/

Stack / Construct のテストを配置する。
主に assertions ベースのテンプレート検証を行う。

---

## 4. Stack と Construct の責務

### 4.1 Stack の役割

Stack は以下を担当する。

- デプロイ単位の表現
- システム構成の見取り図
- Construct の組み合わせ
- 環境ごとの設定値の受け渡し
- 他 Stack との依存関係の整理
- 必要に応じた Output の定義

Stack は「構成を読む場所」であり、詳細実装を書き込む場所ではない。

---

### 4.2 Construct の役割

Construct は以下を担当する。

- 再利用可能なインフラ部品の実装
- 単一責務のリソース群のカプセル化
- 命名・セキュリティ・監視などの共通化
- 複数リソースの標準構成化
- 必要最小限の属性だけ外部へ公開すること

Construct は「部品の詳細実装を書く場所」である。

---

### 4.3 Stack に書くべき内容

Stack には以下を書く。

- Construct の生成
- Construct 間の接続
- 環境設定値の読み込み結果の受け渡し
- Stack 単位でしか意味を持たない軽微なリソース
- Stack Output
- Stack レベルのタグ付与や依存関係

---

### 4.4 Stack に書きすぎてはいけない内容

Stack に以下をベタ書きしない。

- 大量の AWS リソース定義
- 複雑なリソース生成ロジック
- 再利用できる構成の詳細実装
- 命名ロジックの重複
- IAM ポリシーの長大なインライン定義

これらは Construct や helper に切り出す。

---

### 4.5 Construct に書くべき内容

Construct には以下を書く。

- 単一責務のリソース群
- その部品に必要なセキュリティ設定
- 標準タグや命名ルールの適用
- ログ出力や監視の標準設定
- 外部から渡された props を元にした内部リソース生成

---

### 4.6 Construct に含めすぎてはいけない内容

Construct に以下を詰め込みすぎない。

- 複数ドメインの責務
- 環境依存の強い分岐
- その Construct を使う全ての Stack に不要な機能
- 大量の public readonly 公開
- Stack 間依存まで隠蔽するような過剰抽象化

---

## 4.7 CloudFormation の制約と Stack 分割の基準

CloudFormation には以下の制約がある。Stack 設計時に考慮すること。

| 制約                                           | 上限          |
| ---------------------------------------------- | ------------- |
| 1 Stack あたりのリソース数                     | 500           |
| テンプレートファイルサイズ（S3 経由）          | 1 MB          |
| テンプレートファイルサイズ（直接アップロード） | 51,200 バイト |

リソース数が 400 を超えてきた場合は Stack 分割を検討する。
CDK の `cdk synth` で生成された CloudFormation テンプレートのリソース数を定期的に確認する。

また、以下の変更はリソースの**置換**（削除 → 再作成）を引き起こすため、特に注意する。

- RDS のサブネットグループや DB インスタンスクラスの変更
- S3 バケット名の変更
- Cognito User Pool の変更
- IAM Role 名を明示指定している場合の変更

置換が起きるか否かは `cdk diff` の出力で確認できる。置換を伴う変更の場合は必ず人間に確認を求める。

---

## 5. Construct / Stack の具体例

### 5.1 推奨する Stack の粒度

推奨例:

- NetworkStack
- ApplicationStack
- DatabaseStack
- MonitoringStack
- SecurityStack

1 Stack = 1 デプロイ責務、を基本とする。

---

### 5.2 推奨する Construct の粒度

推奨例:

- VpcConstruct
- AlbConstruct
- EcsServiceConstruct
- LambdaFunctionConstruct
- RdsConstruct
- DashboardConstruct
- AlarmConstruct

1 Construct = 1 インフラ部品、を基本とする。

---

### 5.3 Stack の実装例

VPC の lookup は Stack で一度だけ行い、`IVpc` オブジェクトを Construct に渡す。
各 Construct が個別に lookup すると複数回の解決が走るため避ける。

```ts
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { type Construct } from 'constructs';
import { AlbConstruct } from '../constructs/application/alb-construct';
import { EcsServiceConstruct } from '../constructs/application/ecs-service-construct';
import { type AppConfig } from '../config/types';

type ApplicationStackProps = StackProps & {
  config: AppConfig;
};

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    // -----------------------------
    // VPC（Stack で一度だけ lookup する）
    // -----------------------------
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: props.config.network.vpcId,
    });

    // -----------------------------
    // ALB
    // -----------------------------
    const alb = new AlbConstruct(this, 'Alb', {
      projectName: props.config.projectName,
      environmentName: props.config.environmentName,
      vpc,
      certificateArn: props.config.application.certificateArn,
    });

    // -----------------------------
    // ECS Service
    // -----------------------------
    new EcsServiceConstruct(this, 'EcsService', {
      projectName: props.config.projectName,
      environmentName: props.config.environmentName,
      vpc,
      clusterName: props.config.application.clusterName,
      listener: alb.listener,
      desiredCount: props.config.application.desiredCount,
    });
  }
}
```

このように Stack は全体像が見える程度の薄さを保つ。

---

### 5.4 Construct の実装例

Construct は内部実装を隠蔽し、呼び出し側が CDK メソッドを使えるよう CDK オブジェクトを公開する。
`listenerArn` のような文字列ではなく `IApplicationListener` オブジェクトを返すことで、参照側の柔軟性を確保する。

```ts
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

type AlbConstructProps = {
  projectName: string;
  environmentName: string;
  vpc: ec2.IVpc; // string ではなく IVpc を受け取る
  certificateArn: string;
};

export class AlbConstruct extends Construct {
  // ARN 文字列ではなく CDK オブジェクトを公開する
  public readonly listener: elbv2.IApplicationListener;

  constructor(scope: Construct, id: string, props: AlbConstructProps) {
    super(scope, id);

    // -----------------------------
    // Security Group
    // -----------------------------
    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: false, // 最小権限の原則に従い false を基本とする
      description: 'ALB security group',
    });

    // HTTPS のみ許可
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    // アウトバウンドはターゲットの HTTP のみ許可
    securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    // -----------------------------
    // Load Balancer
    // -----------------------------
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Resource', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup,
    });

    // -----------------------------
    // Listener
    // -----------------------------
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      props.certificateArn
    );

    this.listener = loadBalancer.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
    });
  }
}
```

---

## 6. 命名規則

### 6.1 ファイル名

ファイル名は kebab-case とする。

例:

- `application-stack.ts`
- `alb-construct.ts`
- `rds-construct.ts`

---

### 6.2 クラス名

クラス名は PascalCase とする。

例:

- `ApplicationStack`
- `AlbConstruct`
- `RdsConstruct`

---

### 6.3 props 型名

Props 型は `XxxProps` とする。

例:

- `ApplicationStackProps`
- `AlbConstructProps`

---

### 6.4 AWS リソース名

AWS 上の論理的な命名規則はプロジェクト共通ルールに従い、以下を基本とする。

```text
{project}-{env}-{resource}
```

例:

- `myapp-dev-alb`
- `myapp-prod-ecs`
- `myapp-stg-rds`

---

## 7. コメント・JSDoc

コメントは日本語で記述する。

コメントは以下の3種類を使い分ける。

### 7.1 セクションコメント

ファイル内の構造を分かりやすくするため、論理的な区切りごとにセクションコメントを書く。

```ts
// -----------------------------
// ALB
// -----------------------------
```

対象:

- リソース群のまとまり
- 初期化処理
- 構成単位ごとの区切り

---

### 7.2 JSDoc

以下に該当する場合は JSDoc を記述する。

- Stack クラス
- Construct クラス
- 複雑な helper 関数
- ライブラリ境界となる関数
- 注意点や制約が重要な処理

```ts
/**
 * ALB および HTTPS Listener を作成する Construct。
 *
 * この Construct は ALB 本体、Security Group、Listener を作成し、
 * アプリケーション公開に必要な最小構成を提供する。
 *
 * @remarks
 * VPC は Stack 側で lookup し、IVpc オブジェクトとして渡すこと。
 * Construct 内での Vpc.fromLookup は避ける。
 */
```

---

### 7.3 インラインコメント

コードを読んでも「なぜそうしているか」が分からない場合に書く。

```ts
// 既存 VPC を参照する運用のため、新規作成ではなく lookup を使用する
```

---

## 8. TypeScript ルール

- `strict` を有効にする
- `any` は原則禁止
- `unknown` は外部境界でのみ使用可
- `as` は最小限に留める
- 非 null アサーション (`!`) は原則禁止
- exported な class / function / type は意図が分かる命名にする
- アロー関数を基本とする

---

## 9. props 設計

### 9.1 props は必要最小限にする

Construct に何でも渡さない。
必要な依存だけを明示的に props で受け取る。

---

### 9.2 CDK オブジェクトを props で受け渡す

文字列 ID や ARN ではなく、CDK オブジェクト（`IVpc`、`IListener` 等）を渡す。
こうすることで CDK メソッドを使えるほか、型安全性が上がりミスを防ぎやすい。

```ts
// NG: string で受け渡す
type AlbConstructProps = {
  vpcId: string;
  listenerArn: string;
};

// OK: CDK オブジェクトで受け渡す
type AlbConstructProps = {
  vpc: ec2.IVpc;
  listener: elbv2.IApplicationListener;
};
```

ただし、以下の場合は ARN 文字列を props で受け渡すことを許容する。

- CDK App の外部で管理されているリソース（別アカウント・別リポジトリ等）
- `fromLookup` / `fromArn` が存在しないリソース
- 設定ファイルや SSM Parameter Store から取得した外部リソースの参照

```ts
// 外部管理のリソースは ARN 文字列を許容する
type AlbConstructProps = {
  vpc: ec2.IVpc; // 同一 App 内 → CDK オブジェクト
  certificateArn: string; // 外部管理の ACM 証明書 → ARN 文字列を許容
};
```

---

### 9.3 props は意味単位でまとめる

関連する設定はグルーピングして扱う。

```ts
type ApplicationConfig = {
  clusterName: string;
  desiredCount: number;
};
```

---

### 9.4 props で環境差分を吸収する

Construct 内で `if (props.environmentName === "prod")` を多用しない。
なるべく外側で値を決定して渡す。

---

## 10. 環境差分の扱い

環境差分は以下のいずれかで管理する。

- config ファイル
- context
- environment variables

禁止事項:

- Stack / Construct 内に大量の環境分岐を書くこと
- 環境名文字列を各所にハードコードすること

---

## 11. IAM ポリシー

IAM は最小権限を原則とする。

禁止事項:

- `AdministratorAccess` 相当の安易な付与
- `"*"` を多用した広すぎる許可
- 理由のない `iam:*` 付与

推奨事項:

- 必要なアクションだけ許可する
- 必要なリソースだけ許可する
- 共通化できるポリシーは helper または Construct にまとめる
- 広めの権限が必要な場合はコメントで理由を明記する

---

## 12. シークレット管理

以下は禁止する。

- パスワード直書き
- API キー直書き
- シークレット値の config 直書き

使用するもの:

- AWS Secrets Manager
- SSM Parameter Store

必要に応じて secret の参照方法を Construct に閉じ込める。

---

## 13. ステートフルリソースの保護

ステートフルなリソース（RDS・S3・DynamoDB・ElastiCache 等）には `RemovalPolicy` を明示する。

### RemovalPolicy

| 環境                 | 方針                                |
| -------------------- | ----------------------------------- |
| 本番 (`prod`)        | `RemovalPolicy.RETAIN` を原則とする |
| ステージング (`stg`) | `RemovalPolicy.RETAIN` を推奨する   |
| 開発 (`dev`)         | `RemovalPolicy.DESTROY` を許容する  |

環境による差分は config で管理し、Construct 内でハードコードしない。

```ts
// config から RemovalPolicy を受け取る
type RdsConstructProps = {
  removalPolicy: RemovalPolicy;
};

// config/env/prod.ts
export const prodConfig = {
  database: {
    removalPolicy: RemovalPolicy.RETAIN,
  },
};
```

`DESTROY` を設定する場合はコメントで理由を明記する。

---

### 削除保護（DeletionProtection）

RDS・Aurora などのデータベースリソースは `deletionProtection: true` を本番環境で有効にする。
`RemovalPolicy.RETAIN` と併用することでより安全に保護できる。

```ts
new rds.DatabaseInstance(this, 'Database', {
  // ...
  deletionProtection: props.environmentName === 'prod',
  removalPolicy: props.removalPolicy,
});
```

---

### S3 の autoDeleteObjects

`RemovalPolicy.DESTROY` と `autoDeleteObjects: true` の組み合わせはバケット内のオブジェクトごと削除される。
本番環境では絶対に使用しない。

```ts
new s3.Bucket(this, 'Bucket', {
  removalPolicy: props.removalPolicy,
  // autoDeleteObjects は dev 環境のみ許容する
  autoDeleteObjects: props.environmentName === 'dev',
});
```

---

### リソース置換への注意

CDK / CloudFormation の変更によってはリソースが**削除 → 再作成（置換）**される場合がある。
ステートフルなリソースの置換はデータ消失につながるため、`cdk diff` で必ず確認する。

置換を伴う変更が検出された場合は実装を止め、人間に確認を求める。

---

## 14. Cross-Stack 参照

Stack 間の依存は以下のいずれかで管理する。

### CDK オブジェクト直接参照（推奨）

同じ CDK App 内の Stack であれば、CDK オブジェクトを直接渡す。
CDK が自動的に `CfnOutput` / `Fn::ImportValue` を生成するため、コードが簡潔になる。

```ts
// bin/app.ts
const networkStack = new NetworkStack(app, 'Network', { config });
const appStack = new ApplicationStack(app, 'Application', {
  config,
  vpc: networkStack.vpc, // IVpc を直接渡す
});
```

### Fn.importValue（限定的に使用）

独立してデプロイされる Stack 間で参照が必要な場合に限り使用する。
Stack 間に強い結合が生まれるため、乱用しない。
使用する場合はコメントで理由を明記する。

```ts
// Stack 間が独立してデプロイされる構成のため importValue を使用
const vpcId = Fn.importValue('NetworkStack-VpcId');
```

---

## 15. L1 / L2 / L3 Construct の使い分け

- **L2 Construct** を優先する（aws-cdk-lib の標準 Construct）
- **L1 Construct**（`Cfn` プレフィックス）は L2 で対応できない場合のみ使用する

L1 を使う場合はコメントで理由を残す。

```ts
// L2 では○○の設定が未サポートのため L1 を使用
const cfnBucket = new s3.CfnBucket(this, "Bucket", { ... })
```

なお、`aws-cdk-lib/aws-ecs-patterns` などの高レベルな Patterns ライブラリはプロジェクト要件に適合する場合のみ利用する。
Patterns は内部に多くのリソースを生成するため、カスタマイズの自由度が下がることを考慮する。

---

## 15.5 Aspects

CDK Aspects は、Construct ツリー全体に横断的なルールを適用する仕組みである。
以下のユースケースに活用する。

- cdk-nag によるセキュリティ・コンプライアンスチェック
- 全リソースへのタグ強制付与
- リソース設定の一括検証

```ts
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

// cdk-nag を Aspect として適用する
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
```

Aspects でタグを全リソースに強制付与する場合は `Tags.of()` を使用する。

```ts
import { Tags } from 'aws-cdk-lib';

// Stack または App 全体にタグを付与する
Tags.of(app).add('Project', config.projectName);
Tags.of(app).add('Environment', config.environmentName);
Tags.of(app).add('ManagedBy', 'CDK');
```

---

## 16. helper の扱い

helper は以下に限定する。

- 命名規則
- タグ付与
- IAM Policy 生成
- ARN / ID の組み立て
- CDK 共通補助関数

禁止事項:

- ビジネスロジックを helper に置くこと
- 単なるファイル分散のために helper を増やすこと

---

## 17. Output

Output は必要最小限とする。

出力してよいもの:

- 他 Stack 参照に必要な値
- 運用上確認が必要な識別子
- 明示的に参照されるエンドポイント

不要な内部情報の大量 Output は避ける。

---

## 18. タグ

全 Stack / 主要リソースにはプロジェクト標準タグを付与する。

推奨タグ例:

- `Project`
- `Environment`
- `ManagedBy`
- `Owner`
- `CostCenter`

タグ付与は helper 化または app / stack レベルで共通適用する。

---

## 18.5 ログ・監視の標準設定

以下はセキュリティおよび運用上、原則として有効にする。

### CloudWatch Logs の保持期間

CloudWatch Logs のロググループには保持期間を必ず設定する。
設定しない場合、ログが永久に保存されコストが増大する。

```ts
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

new logs.LogGroup(this, 'AppLogGroup', {
  retention: RetentionDays.THREE_MONTHS, // 本番: 3〜12ヶ月
  removalPolicy: props.removalPolicy,
});
```

---

### アクセスログの有効化

以下のリソースはアクセスログを有効にする。

- ALB: `loadBalancer.logAccessLogs(logBucket)`
- S3: `serverAccessLogsBucket` を指定する
- API Gateway: アクセスログを CloudWatch に出力する

---

### VPC Flow Logs

本番環境では VPC Flow Logs を有効にし、ネットワークトラフィックを記録する。

```ts
vpc.addFlowLog('FlowLog', {
  destination: ec2.FlowLogDestination.toCloudWatchLogs(),
  trafficType: ec2.FlowLogTrafficType.ALL,
});
```

---

## 19. テスト方針

CDK コードは実装とテストをセットで作成する。

テスト対象:

- Stack の主要リソース構成
- Construct の標準設定
- Security Group / IAM / Encryption / Logging の有無
- 環境差分による期待動作

---

### 19.1 テストの種類

#### synth テスト

`cdk synth` が成功することを確認する。

---

#### assertions テスト

`aws-cdk-lib/assertions` を用いて、生成された CloudFormation テンプレートを検証する。

例:

- ALB が作成されること
- S3 Bucket で暗号化が有効であること
- CloudWatch Alarm が存在すること

---

#### snapshot テスト

大規模テンプレートの全体差分確認に利用してもよいが、乱用しない。
重要リソースは assertions ベースで明示的に検証する。

---

### 19.2 テスト対象の優先順位

優先度高:

- セキュリティ設定
- IAM 権限
- 暗号化
- ログ出力設定
- インターネット公開有無
- 削除保護やバックアップ設定
- RemovalPolicy の設定

優先度中:

- 命名
- タグ
- 出力値

優先度低:

- CDK 内部実装の細かい構造

---

## 20. CI / 運用ルール

CI では以下を必須とする。

- lint
- typecheck
- unit test
- `cdk synth`

必要に応じて以下も実施する。

- `cdk diff`
- `cdk-nag`
- セキュリティスキャン

CI が失敗している場合はマージ不可とする。

---

## 21. AI エージェント利用ルール

Claude / Codex 等の AI は以下を遵守する。

### 禁止事項

**コード品質**

- Stack に大量のリソースをベタ書きすること
- 無関係なリファクタ
- テストを削除または弱めること

**セキュリティ**

- IAM を過剰権限にすること（`*` の安易な使用など）
- シークレットを直書きすること
- SecurityGroup で `allowAllOutbound: true` を理由なく設定すること

**Construct 設計**

- L1 Construct を理由なく乱用すること
- Construct 内で `Vpc.fromLookup` を呼び出すこと（Stack で行う）
- ARN / ID 文字列を props で受け渡すこと（CDK オブジェクトを使う）

**ファイル・構造**

- 既存の Stack / Construct 構造を無断で変更しないこと
- ディレクトリ構成を無断で変更しないこと

---

### 必須事項

- Stack は薄く保つ
- 再利用可能な単位は Construct 化する
- コメント・JSDoc を適切に付与する
- セキュリティ設定を明示する（SecurityGroup のルール、IAM の権限など）
- ステートフルなリソースには RemovalPolicy を明示する
- `cdk synth` が通る実装にする
- 必要な assertions テストを追加する
- 生成したコードに対してレビュー観点（セキュリティ・置換リスク・IAM 権限過剰・削除保護の漏れ等）を自己申告する

---

### 確認が必要な場合

以下の場合は実装を止め、人間に確認を求める。

- RemovalPolicy を変更する場合（特に DESTROY への変更）
- `cdk diff` で意図しないリソース削除・置換が発生している場合
- 既存の Construct / Stack 構造から逸脱する実装が必要な場合
- 新規ライブラリや Patterns の追加が必要な場合
- セキュリティ設定（IAM・SecurityGroup・暗号化）を変更する場合
- ステートフルリソースに置換（削除 → 再作成）が発生する変更を行う場合

---

## 22. Construct 化の判断基準

以下のいずれかに該当する場合は Construct 化を検討する。

- 同じ構成を複数 Stack で使う
- 複数リソースが常にセットで登場する
- セキュリティや監視を標準化したい
- Stack の constructor が長くなってきた
- 命名や設定の重複が増えている

逆に、1回しか使わず単純なものは Stack に置いてもよい。

---

## 23. 完了条件

以下をすべて満たした場合のみタスク完了とする。

- Stack / Construct の責務分離が適切である
- 環境差分が設定値で管理されている
- IAM / secret / logging の観点で安全である
- ステートフルなリソースに RemovalPolicy が明示されている
- lint 成功
- typecheck 成功
- test 成功
- `cdk synth` 成功
- 実装意図が説明可能である
