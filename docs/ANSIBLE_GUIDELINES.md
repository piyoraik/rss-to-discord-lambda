# Ansible コーディング規約

## 1. 目的

本ドキュメントは、Ansible によるインフラ構成管理の品質・安全性・可読性を維持するためのコーディング規約を定義する。

本規約は、人間による実装だけでなく、Claude / Codex などの AI エージェントによる実装にも適用する。

目的は以下とする。

- 構成管理の再現性を確保する
- 可読性の高い Playbook を維持する
- インフラ変更の安全性を高める
- AI による Playbook 生成の品質を安定させる

> **関連規約**: Ansible は独立したコードベースですが、YAML や Jinja2 テンプレートの記述方針は本規約に従う。インフラ構成に CDK を使用する場合は `CDK_GUIDELINES.md` も参照すること。

---

## 2. 基本方針

- idempotent なタスクを作成する
- 1つの Role は1つの責務とする
- 明示的な変数を使用する
- シークレットを Playbook に書かない
- inventory に依存したロジックを避ける
- モジュールを優先し、`shell` / `command` の使用は最小限にする
- 全タスクに `name` を記述する

---

## 3. ディレクトリ構成

推奨ディレクトリ構成は以下とする。

```text
ansible/
  infra/ansible/ansible.cfg
  inventory/
    production/
      hosts.yml
      group_vars/
        all.yml
        web.yml
        db.yml
      host_vars/
        web01.yml
    staging/
      hosts.yml
      group_vars/
      host_vars/
  playbooks/
    site.yml
    web.yml
    db.yml
  roles/
    nginx/
    postgresql/
    common/
  molecule/              # Role テスト
```

---

## 4. Role の内部構造

Role は以下のディレクトリ構成を標準とする。

```text
roles/nginx/
  tasks/
    main.yml             # タスクのエントリーポイント
    install.yml          # インストール処理
    configure.yml        # 設定処理
  handlers/
    main.yml             # ハンドラー定義
  defaults/
    main.yml             # 上書き可能なデフォルト変数（優先度: 低）
  vars/
    main.yml             # 強制値（上書き不可・内部定数向け）
  templates/
    nginx.conf.j2
  files/
    index.html
  meta/
    main.yml             # Role の依存関係
  molecule/
    default/
      molecule.yml
      converge.yml
      verify.yml
```

### defaults/ vs vars/ の使い分け

| ファイル            | 用途                               | 外部上書き                 |
| ------------------- | ---------------------------------- | -------------------------- |
| `defaults/main.yml` | 外部から変更を想定するデフォルト値 | 可能                       |
| `vars/main.yml`     | Role 内部の定数・強制値            | 不可（上書きは想定しない） |

---

## 5. Playbook 設計

Playbook は orchestration のみ担当する。

責務:

- Role の呼び出し
- ホストグループの指定
- タグの付与

Playbook にロジックを書かない。詳細な実装は Role に閉じ込める。

```yaml
---
- name: Web サーバーの構成
  hosts: web
  become: true
  gather_facts: true
  roles:
    - role: common
      tags: [common]
    - role: nginx
      tags: [nginx]
```

---

## 5.5 become（権限昇格）

`become: true` は必要な場合のみ使用し、スコープを最小限にする。

| スコープ     | 推奨度   | 用途                                 |
| ------------ | -------- | ------------------------------------ |
| タスクレベル | 推奨     | 特定タスクだけ root が必要な場合     |
| Play レベル  | 条件付き | 大半のタスクが root を必要とする場合 |
| Role レベル  | 非推奨   | Role 全体に一括適用は避ける          |

```yaml
# OK: タスクレベルで必要な箇所のみ become を付ける
- name: nginx の設定ファイルを配置する
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
  become: true

# Play レベルで become が必要な場合はコメントで理由を記載する
- name: Web サーバーの構成
  hosts: web
  # このプレイの大半のタスクは root 権限を必要とするため Play レベルで become を設定する
  become: true
```

`become_user` は特定のサービスユーザーで実行が必要な場合に使用する。

```yaml
- name: アプリケーションの初期設定を実行する
  ansible.builtin.command: /opt/app/bin/setup
  become: true
  become_user: appuser # root ではなく専用ユーザーで実行する
```

---

## 6. タスク設計

### name は必須

全タスクに `name` を記述する。name がないとログが読めず障害調査が困難になる。

name は「何をするか」ではなく「何のためにするか」を書く。

```yaml
# NG: 何をしているかを書いている
- name: nginx をインストールする
  ansible.builtin.apt:
    name: nginx

# OK: なぜ・何のためかが伝わる
- name: Web サーバー用 nginx をインストールする
  ansible.builtin.apt:
    name: nginx
    state: present
```

---

### idempotent なタスクを書く

Playbook は何度実行しても同じ状態になること。

```yaml
# NG: コマンドそのままで冪等性がない
- name: nginx をインストールする
  ansible.builtin.command: apt install nginx

# OK: モジュールで状態を宣言する
- name: Web サーバー用 nginx をインストールする
  ansible.builtin.apt:
    name: nginx
    state: present
```

---

### FQCN（完全修飾コレクション名）を使用する

モジュールは FQCN 形式で記述する。短縮形は名前衝突のリスクがある。

```yaml
# NG: 短縮形
- name: nginx をインストールする
  apt:
    name: nginx

# OK: FQCN
- name: Web サーバー用 nginx をインストールする
  ansible.builtin.apt:
    name: nginx
    state: present
```

よく使う FQCN の例:

- `ansible.builtin.apt`
- `ansible.builtin.yum`
- `ansible.builtin.template`
- `ansible.builtin.copy`
- `ansible.builtin.service`
- `ansible.builtin.file`
- `ansible.builtin.command`
- `ansible.builtin.shell`
- `ansible.builtin.lineinfile`

---

## 7. Handlers

ファイルの変更・サービス再起動など、変更があった場合にのみ実行すべき処理は `handlers` で定義する。
タスク内で直接 `state: restarted` を呼ぶと冪等性が崩れるため使用しない。

```yaml
# tasks/main.yml
- name: nginx の設定ファイルを配置する
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: '0644'
  notify: nginx を再起動する

# handlers/main.yml
- name: nginx を再起動する
  ansible.builtin.service:
    name: nginx
    state: restarted
```

ハンドラーの命名は「何をするか」を明示する。

Handler は Play の末尾にまとめて実行される。途中で即座に実行が必要な場合は `ansible.builtin.meta: flush_handlers` を使用する。

```yaml
- name: ここまでの変更を即座に反映する
  ansible.builtin.meta: flush_handlers
```

---

## 8. shell / command の使用

`ansible.builtin.shell` / `ansible.builtin.command` は以下の場合のみ使用する。

- 対応するモジュールが存在しない場合
- OS 特有の処理でモジュールでは対応できない場合

使用する場合は必ず `changed_when` を設定し、冪等性を明示する。

```yaml
# 状態が変わる場合
- name: DB のマイグレーションを実行する
  ansible.builtin.command: rails db:migrate
  changed_when: "'already up' not in migration_result.stdout"
  register: migration_result

# 情報取得のみ（変更なし）
- name: 現在の nginx バージョンを取得する
  ansible.builtin.command: nginx -v
  register: nginx_version
  changed_when: false
  check_mode: false
```

`creates` パラメータを使って冪等性を確保することもできる。

```yaml
- name: アプリケーションを初期セットアップする
  ansible.builtin.command:
    cmd: /opt/app/bin/setup
    creates: /opt/app/.initialized # このファイルが存在する場合はスキップ
```

---

## 8.5 include_tasks vs import_tasks

Role 内でタスクファイルを分割する場合、`include_tasks` と `import_tasks` を使い分ける。

| 機能                 | `import_tasks`（静的） | `include_tasks`（動的） |
| -------------------- | ---------------------- | ----------------------- |
| 処理タイミング       | パース時（実行前）     | ランタイム（実行中）    |
| タグの伝搬           | 伝搬する               | 伝搬しない              |
| `when` の扱い        | 各タスクに個別適用     | include 全体に適用      |
| 変数による動的な指定 | 不可                   | 可能                    |

基本方針:

- タスクファイルを静的に分割する場合（タグを使いたい・条件を各タスクに適用したい）: `import_tasks` を使用する
- 変数でファイル名を動的に切り替える場合・条件によってファイルごとスキップしたい場合: `include_tasks` を使用する

```yaml
# import_tasks: タグが個々のタスクに伝搬する（推奨：静的な分割）
- name: インストール処理をインポートする
  ansible.builtin.import_tasks: install.yml

# include_tasks: 変数で動的に切り替える場合
- name: OS に応じたインストール処理を実行する
  ansible.builtin.include_tasks: 'install_{{ ansible_os_family | lower }}.yml'
```

---

## 9. エラーハンドリング

### block / rescue / always

エラー処理が必要な箇所は `block / rescue / always` で構造化する。

```yaml
- name: アプリケーションデプロイ
  block:
    - name: アプリケーションを起動する
      ansible.builtin.service:
        name: myapp
        state: started
  rescue:
    - name: 起動失敗時にエラーログを取得する
      ansible.builtin.command: journalctl -u myapp -n 50
      register: error_log
      changed_when: false

    - name: エラーログを出力する
      ansible.builtin.debug:
        var: error_log.stdout_lines
  always:
    - name: デプロイ結果を通知する
      ansible.builtin.debug:
        msg: 'デプロイ処理を完了した（成否問わず）'
```

---

### failed_when

モジュールのデフォルトの失敗判定を上書きしたい場合に使用する。

```yaml
- name: プロセスの存在確認
  ansible.builtin.command: pgrep nginx
  register: pgrep_result
  failed_when: pgrep_result.rc not in [0, 1]
  changed_when: false
```

---

### ignore_errors

`ignore_errors: true` は安易に使用しない。エラーを握りつぶすとその後の処理が不正な状態で継続する。
使用する場合はコメントで理由を明記する。

```yaml
# 初回実行時はサービスが存在しないためエラーを無視する
- name: 既存サービスを停止する（初回実行時はスキップ）
  ansible.builtin.service:
    name: myapp
    state: stopped
  ignore_errors: true
```

---

## 10. 変数

### 命名規則

変数名は `snake_case` を使用する。
Role 固有の変数には Role 名をプレフィックスとして付ける（名前衝突防止）。

```yaml
# NG: プレフィックスなし（他の Role と衝突するリスク）
port: 80
worker_processes: 4

# OK: Role 名プレフィックスあり
nginx_port: 80
nginx_worker_processes: 4
```

---

### 変数の優先順位

Ansible の変数優先順位（高い順）は以下のとおり。
上位のものが下位を上書きする。

1. `extra_vars`（`-e` オプション）（最高優先度）
2. Role の `vars/main.yml`（上書き不可の強制値として機能する）
3. Playbook 内の `vars`
4. `host_vars/` のファイル
5. `group_vars/` のファイル（子グループが親グループより優先）
6. `group_vars/all`
7. Role の `defaults/main.yml`（最低優先度・外部から上書き可能）

この順序を理解した上で変数の定義場所を決める。

> **注意**: `vars/main.yml` は `host_vars` や `group_vars` よりも高い優先度を持つため、上書きを意図しない強制値にのみ使用する。外部から変更を想定する値はすべて `defaults/main.yml` に定義する。

---

### 変数の定義場所

| 用途                     | 定義場所                                 |
| ------------------------ | ---------------------------------------- |
| 全環境共通のデフォルト   | `roles/{role}/defaults/main.yml`         |
| Role 内部の定数          | `roles/{role}/vars/main.yml`             |
| 環境・グループ単位の設定 | `inventory/{env}/group_vars/{group}.yml` |
| ホスト固有の設定         | `inventory/{env}/host_vars/{host}.yml`   |
| 実行時の一時的な上書き   | `-e` オプション                          |

---

## 10.5 ループ

ループには `loop:` を使用する。旧来の `with_items:` / `with_dict:` は非推奨のため使用しない。

```yaml
# NG: 非推奨の with_items
- name: パッケージをインストールする
  ansible.builtin.apt:
    name: '{{ item }}'
    state: present
  with_items:
    - nginx
    - git
    - curl

# OK: loop を使用する
- name: Web サーバー用パッケージをインストールする
  ansible.builtin.apt:
    name: '{{ item }}'
    state: present
  loop:
    - nginx
    - git
    - curl
```

辞書型のループには `loop` + `dict2items` フィルタを使用する。

```yaml
- name: 設定ファイルを配置する
  ansible.builtin.template:
    src: '{{ item.value.src }}'
    dest: '{{ item.value.dest }}'
  loop: '{{ config_files | dict2items }}'
```

---

## 11. テンプレート

設定ファイルは `ansible.builtin.template` モジュールと Jinja2 テンプレートを使用する。

```yaml
- name: nginx の設定ファイルを配置する
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: '0644'
    validate: nginx -t -c %s # 配置前にバリデーションを実行する
  notify: nginx を再起動する
```

テンプレートファイルの命名は `{対象ファイル名}.j2` とする。

Jinja2 フィルタは可読性を優先し、複雑な処理をテンプレートに書きすぎない。
複雑なロジックが必要な場合はカスタムフィルタまたは `set_fact` で事前に加工する。

---

## 12. タグ

タグを使用することで、Playbook の一部のみを実行できる。

以下のタグ名を標準として使用する。

| タグ名   | 用途                                       |
| -------- | ------------------------------------------ |
| `always` | 常に実行（収集・確認系タスク）             |
| `never`  | 明示指定時のみ実行（危険な処理・初期化等） |
| `setup`  | 初期セットアップのみ                       |
| `deploy` | デプロイ処理のみ                           |
| `config` | 設定ファイルの更新のみ                     |

```yaml
- name: nginx の設定ファイルを配置する
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
  tags: [nginx, config]
```

独自タグを乱立させない。新規タグを追加する場合はチームで合意する。

---

## 13. シークレット管理

以下は禁止する。

- パスワード直書き
- API キー直書き
- シークレット値の変数ファイル直書き

使用するもの:

- `ansible-vault`（Git 管理するファイルの暗号化）
- AWS Secrets Manager / SSM Parameter Store（クラウド環境）

Vault 暗号化ファイルの命名は `vault_{変数名}.yml` を推奨する。

---

### no_log の使用

パスワード等を含むタスクは `no_log: true` を設定し、実行ログへの出力を抑制する。
`ansible-vault` で変数を暗号化していても、タスクのログにその値が出力される場合がある。

```yaml
- name: データベースのパスワードを設定する
  ansible.builtin.command: >
    mysql -u root -e "ALTER USER 'app'@'localhost'
    IDENTIFIED BY '{{ db_password }}';"
  no_log: true
  changed_when: true
```

---

## 14. 条件分岐

条件は明示的に書く。OS ファミリー・バージョン・環境などで分岐する場合は `when` を使用する。

```yaml
- name: Debian 系に nginx をインストールする
  ansible.builtin.apt:
    name: nginx
    state: present
  when: ansible_os_family == "Debian"

- name: RedHat 系に nginx をインストールする
  ansible.builtin.yum:
    name: nginx
    state: present
  when: ansible_os_family == "RedHat"
```

`when` の条件は複雑にしすぎない。複雑な条件は変数に切り出す。

```yaml
# 複雑な条件は変数に切り出す
- name: デプロイ対象かどうかを判定する
  ansible.builtin.set_fact:
    should_deploy: >-
      {{ ansible_os_family == "Debian" and
         app_version is defined and
         app_version != current_version }}

- name: アプリケーションをデプロイする
  ansible.builtin.include_tasks: deploy.yml
  when: should_deploy
```

---

## 15. ansible.cfg

`infra/ansible/ansible.cfg` に Ansible 共通設定を配置し、playbook / Molecule / 補助 script から同じ設定を参照する。

```ini
[defaults]
inventory          = inventory/
roles_path         = roles/
stdout_callback    = yaml
callbacks_enabled  = profile_tasks
retry_files_enabled = false
host_key_checking  = false
gather_facts       = smart
fact_caching       = jsonfile
fact_caching_connection = /tmp/ansible_facts
fact_caching_timeout = 86400

[ssh_connection]
pipelining = true
```

`host_key_checking = false` は開発・検証環境のみ許容する。本番環境では `true` を推奨する。

---

### Molecule からの ansible.cfg 参照

Molecule はロールのディレクトリをプロジェクトルートとして実行するため、上位ディレクトリの `ansible.cfg` を自動で見つけられない。
`molecule.yml` の `env` に `ANSIBLE_CONFIG` を明示することで、プロジェクト共通の設定を参照させる。

ディレクトリ構成と変数の関係:

```text
ansible/
  ansible.cfg                          ← 参照先
  roles/
    nginx/                             ← MOLECULE_PROJECT_DIRECTORY
      molecule/
        default/
          molecule.yml
```

`MOLECULE_PROJECT_DIRECTORY` はロールのルートディレクトリを指すため、`../../` でプロジェクトルートの `ansible.cfg` に到達できる。

```yaml
# molecule.yml
provisioner:
  name: ansible
  env:
    ANSIBLE_CONFIG: ${MOLECULE_PROJECT_DIRECTORY}/../../ansible.cfg
```

この記述は意図的なものであり、パス解決の構造を理解した上で変更しないこと。
`ansible.cfg` の配置場所を変更した場合は、合わせてこのパスも更新する。

---

## 16. テスト方針

Role の実装とテストはセットで作成する。

---

### Molecule によるテスト

Role の品質保証には Molecule を使用する。

```text
roles/nginx/molecule/default/
  molecule.yml      # テスト環境の定義（ドライバー、プラットフォーム等）
  converge.yml      # テスト対象 Playbook
  verify.yml        # 検証用テスト
```

verify.yml では以下を確認する。

- パッケージがインストールされていること
- サービスが起動・有効化されていること
- 設定ファイルが正しく配置されていること
- ポートがリッスンされていること

---

### その他のテスト

| テスト種別   | コマンド                          | タイミング      |
| ------------ | --------------------------------- | --------------- |
| 構文チェック | `ansible-playbook --syntax-check` | コミット前      |
| lint         | `ansible-lint`                    | コミット前      |
| ドライラン   | `ansible-playbook --check --diff` | 本番適用前      |
| Molecule     | `molecule test`                   | CI / コミット前 |

---

## 17. CI

CI では以下を必須とする。

- `yamllint`（YAML 構文チェック）
- `ansible-lint`（Ansible 規約チェック）
- `ansible-playbook --syntax-check`
- `molecule test`（Role 単位のテスト）

CI が失敗している場合はマージ不可とする。

---

## 18. AI エージェント利用ルール

Claude / Codex 等の AI は以下を遵守する。

### 禁止事項

**コード品質**

- `shell` / `command` モジュールを理由なく使用すること
- 冪等性を担保しないタスクを書くこと
- `name` のないタスクを書くこと
- FQCN を使用せずに短縮形のモジュール名を書くこと
- `ignore_errors: true` を理由なく使用すること

**セキュリティ**

- シークレットを Playbook・変数ファイルに直書きすること
- 機密情報を含むタスクに `no_log: true` を付けないこと
- 不必要に `become: true` を付けること

**構造**

- 既存の Role 構造・ディレクトリ構成を無断で変更すること
- Playbook にロジックを書くこと（Role に閉じ込める）
- 変数の定義場所のルールを無視すること（セクション10参照）

---

### 必須事項

- 全タスクに `name` を記述する
- 全モジュールを FQCN で記述する
- `shell` / `command` 使用時は `changed_when` を明示する
- ハンドラーが必要な変更には `notify` を使用する
- 機密情報を含むタスクには `no_log: true` を付ける
- 新規 Role にはテスト（Molecule）を追加する
- 生成した Playbook / Role に対してレビュー観点（冪等性・セキュリティ・become スコープ・no_log 漏れ等）を自己申告する

---

### 確認が必要な場合

以下の場合は実装を止め、人間に確認を求める。

- 既存の Role / Playbook 構造から逸脱する実装が必要な場合
- `ignore_errors: true` が必要と判断した場合
- 本番環境に直接影響するタスクを変更する場合
- 新規 Role の追加が必要な場合
- `become: true` のスコープを拡大する場合

---

## 19. 完了条件

以下をすべて満たした場合のみタスク完了とする。

- yamllint 成功
- ansible-lint 成功
- syntax-check 成功
- molecule test 成功（新規 Role の場合）
- ドライラン（`--check --diff`）で意図した差分が確認できる
- 冪等性が確認されている（2回実行しても changed が出ない）
- 実装意図が説明可能である
