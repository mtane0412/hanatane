# posts

hanatane.net の記事を Markdown（frontmatter 付き）で管理し、Ghost 公式 CLI [ghst](https://github.com/TryGhost/ghst) 経由で Ghost に反映するパッケージです。

## 初回セットアップ（ローカル、1 回だけ）

1. Ghost Admin（`https://hanatane.net/ghost/`）→ Settings → Staff → 自分のプロフィール → **Staff access token** を作成してコピーする。
2. リポジトリルートで対話ログインする。alias は `hanatane` にする（`.ghst/config.json` がこの alias を参照している）。

   ```bash
   pnpm ghst auth login --site hanatane
   # Ghost API URL: https://hanatane.net
   # Staff Access Token: <id>:<secret>
   pnpm ghst auth status
   ```

トークンは macOS キーチェーン（利用できない環境では `~/.config/ghst/config.json`）に保存され、リポジトリには入りません。`.ghst/config.json` には alias 名だけが入っています。

CI などで対話ログインできない場合は環境変数 `GHOST_URL` と `GHOST_STAFF_ACCESS_TOKEN`（`{id}:{secret}`）で代用できます。

## 記事ファイルの 2 つの形式

`posts/content/` に 1 記事 1 ファイルで置きます。ファイル名（拡張子を除いたもの）が Ghost の slug になります。

| 形式 | ファイル名 | 用途 |
|---|---|---|
| Markdown（frontmatter 付き） | `<slug>.md` | 新規に書く記事 |
| Lexical JSON | `<slug>.post.json` | `pull` で Ghost から取り込んだ既存記事。ブックマーク・埋め込みなどの Ghost カードを無損失で往復できる |

### Lexical JSON（`<slug>.post.json`）

`pnpm --filter ./posts pull` が生成します。先頭にメタ情報（`title`、`slug`、`status`、`visibility`、`tags`、`excerpt`、`feature_image`、`featured`）、参考情報として `published_at` と `updated_at`、末尾に `lexical`（Ghost エディタの内部形式）が入ります。

`visibility` が `members` / `paid` の記事（メンバー限定記事）は `content/` 直下ではなく `content/private/` に sops で暗号化して置かれます。詳細は「[メンバー限定記事](#メンバー限定記事visibility-が-members--paid)」を参照してください。

- `lexical` を編集するときは、既存ノードの構造（`type`、`version`、`children`）に合わせてください。テキストの修正は `text` フィールドを書き換えるだけで済みます。
- `published_at` と `updated_at` は push では送りません。
- 4 記事（`hometown-tour-on-google-maps`、`how-to-deal-with-weeds`、`gw2023`、`reflaction202304`）は旧 mobiledoc 形式で `lexical` が無いため pull で取り込めません。Ghost エディタで一度開いて保存すると Lexical に変換され、次回の pull で取り込めます。

### Markdown（`<slug>.md`）

```markdown
---
title: 記事タイトル          # 必須
slug: custom-slug           # 省略時はファイル名
status: draft               # draft（既定）| published
visibility: public          # public（既定）| members | paid。members / paid の記事は content/private/ に置く（後述）
tags:                       # 省略可。タグ名で指定する（無ければ Ghost 側で作られる）
  - 日記
excerpt: 一覧やカードに出る抜粋   # 省略可
feature_image: https://...  # 省略可。省略すると sync-og-images が OGP 画像を自動生成する
featured: false             # 省略可
---

本文（Markdown）
```

- 本文は ghst が markdown-it（`breaks: true`）で HTML に変換します。**段落内の改行はそのまま `<br>` になる**ので、意図しない改行を入れないでください。
- 生 HTML は本文中にそのまま書けます（`html: true`）。
- 画像は `pnpm ghst image upload <ファイル>` でアップロードし、返ってきた URL を本文や `feature_image` に書きます。

## Ghost から取り込む（pull）

```bash
pnpm --filter ./posts pull                 # 全記事を content/<slug>.post.json に書き出す
pnpm --filter ./posts pull --slug <slug>   # 1 記事だけ
```

- 既存の `.post.json` は上書きします。ローカルの編集はコミットしてから実行してください。
- 同じ slug の `<slug>.md`（`content/` 直下または `content/private/`）がある記事は Markdown 側を正とみなしてスキップします。
- `visibility` が `members` / `paid` の記事は `content/private/<slug>.post.json` に sops で暗号化して書きます。平文はディスクに残しません。内容が変わっていなければ再暗号化しない（無駄な diff を出さない）ため、変更が無いときは「変更なし（限定記事）」として数えます。
- `visibility` が変わった記事は、反対側（`content/` 直下 ⇔ `content/private/`）に残った古い `.post.json` を削除します。
- 復号したままの平文作業ファイル（`content/private/<slug>.plain.post.json`）が残っているとエラーで止まります。`pnpm --filter ./posts private encrypt <slug>` で戻すか削除してから実行してください。
- `tags` は push でファイルの内容に置き換わります。`hyperstrata-sync` workflow が付ける `#ref-*` タグなど Ghost 側で後から付いたタグを落とさないよう、**編集前に pull** してください。

## Ghost に反映する（push）

```bash
pnpm --filter ./posts push content/<slug>.md --dry-run         # 実行予定のコマンドを表示するだけ
pnpm --filter ./posts push content/<slug>.md                   # slug が存在すれば更新、無ければ作成
pnpm --filter ./posts push content/<slug>.post.json            # Lexical JSON も同じ
```

```bash
pnpm --filter ./posts push content/private/<slug>.post.json         # 限定記事（sops 暗号化済み。復号して送る）
pnpm --filter ./posts push content/private/<slug>.md                # 限定記事の新規下書き（平文、.gitignore 対象）
pnpm --filter ./posts push content/<slug>.post.json --allow-public  # Ghost 側で限定の記事を public に変えるときだけ付ける
```

`push` は `ghst post update --slug <slug>` を試み、記事が無い（終了コード 5）ときだけ `ghst post create` にフォールバックします。`status` をそのまま送るため、`status: published` にして push すると公開されます。`visibility` は常に `--visibility` で明示して送ります（create が Ghost の既定値 public に落ちて限定記事が公開されるのを防ぐため）。create 時の slug は ghst 0.17.1 の `post create` に `--slug` が無いため、`{ "slug": ... }` を書いた一時ファイルを `--from-json` で渡しています。

公開・予約・削除など push が扱わない操作は ghst を直接使います。

```bash
pnpm ghst post list --limit 10
pnpm ghst post get --slug <slug> --json --jq '.posts[0] | {id, status, url}'
pnpm ghst post publish <id>
pnpm ghst post schedule <id> --at 2026-10-01T09:00:00+09:00
pnpm ghst --enable-destructive-actions post delete <id>
```

## メンバー限定記事（visibility が members / paid）

このリポジトリは公開なので、メンバー限定記事の本文を平文でコミットしてはいけません。限定記事は `content/private/<slug>.post.json` に [sops](https://github.com/getsops/sops) + age で暗号化して置きます（`infra/` と同じ鍵。設定は `posts/.sops.yaml`）。

### 仕組み

- 暗号化されるのは `lexical`（本文）だけです。`title`、`slug`、`status`、`visibility`、`tags` などのメタ情報は平文で残るため、`git diff` で何が変わったかは追えます。Ghost もペイウォールの外側で title と excerpt は公開しています。
- 復号には `~/.config/sops/age/keys.txt` の age 秘密鍵が必要です。GitHub Actions では復号しません（`check-private` は復号せずに検査します）。
- sops は MAC をファイル全体にかけるため、暗号化済みファイルの平文部分を直接編集すると復号に失敗します。編集は必ず下記のフローで行ってください。

### 既存の限定記事を編集する

```bash
pnpm --filter ./posts pull --slug <slug>                  # 編集前に最新を取り込む
pnpm --filter ./posts private decrypt <slug>              # content/private/<slug>.plain.post.json（平文、.gitignore 対象）を作る
# <slug>.plain.post.json を編集する
pnpm --filter ./posts private encrypt <slug>              # 暗号化して <slug>.post.json に書き戻し、平文を削除する
pnpm --filter ./posts push content/private/<slug>.post.json
```

### 限定記事を新規に書く

1. `content/private/<slug>.md` に frontmatter で `visibility: members`（または `paid`）を書いた Markdown を作る。このファイルは `.gitignore` で除外されており、コミットされません。
2. `pnpm --filter ./posts push content/private/<slug>.md` で Ghost に送る。
3. `content/private/<slug>.md` を削除してから `pnpm --filter ./posts pull --slug <slug>` を実行すると、暗号化済みの `content/private/<slug>.post.json` が作られる。以後はこれを編集します。

### 誤って公開しないためのガード

| 層 | 仕組み | 止める操作 |
|---|---|---|
| pull | 限定記事は暗号化してしか書かない（`scripts/pull.ts`） | 平文の限定記事がリポジトリに生まれること |
| push | ファイルの `visibility` と置き場所の整合を検査し、`--visibility` を常に明示して送る（`scripts/push.ts`） | 限定記事を `content/` 直下に平文で置いて push すること、create が public に落ちること |
| push | Ghost 側の `visibility` を取得し、限定 → public への変更は `--allow-public` が無ければエラー | ファイル側の `visibility` 漏れによる意図しない公開 |
| pre-commit hook | `.githooks/pre-commit` が `check-private --staged` を実行（`pnpm install` の `prepare` で `core.hooksPath` を設定） | 平文の限定記事、暗号化されていない `content/private/` のファイルのコミット |
| CI | `test-posts.yml` が `check-private` を実行 | hook を迂回した PR のマージ |
| .gitignore | `content/private/*.md`、`content/private/*.plain.post.json` | 平文作業ファイルの誤コミット |

判定ルールは `src/private-post.ts` にまとまっています（テスト: `src/private-post.test.ts`）。

## 制約

- Lexical から Markdown への逆変換は行いません。既存記事は `.post.json` のまま編集します。
- `status` は `draft` と `published` のみ受け付けます。予約公開は `ghst post schedule` を使ってください。
- `visibility` は `public` / `members` / `paid` のみ受け付けます。特定ティア限定（`tiers`）は未対応で、pull も push もエラーになります。
- ghst は stdout がパイプのとき 64KB 付近で出力が途切れる（書き込み完了前に終了する）ため、`pull` は ghst の stdout を一時ファイルに書かせてから読んでいます。`pnpm ghst post list --json | jq` のような使い方では途切れることがあるので、大きな出力はファイルにリダイレクトしてください。

## Hyperstrata の注釈（strata/）

hanatane.net は [Hyperstrata](https://strata.orito-itsuki.graphics/introduction-to-hyperstrata/) の考え方（記事を書き換えず堆積させ、層の中にネットワークを張る）で運用しています。ネットワークは 2 層あります。

| 層 | 作る人 | 置き場所 | 内容 |
|---|---|---|---|
| 引用（人間の層） | 著者。本文に過去記事へのリンクを書く | Ghost の `#ref-<slug>` タグ（`hyperstrata-sync` workflow が付ける） | 著者が意識的に参照した関係 |
| 注釈（機械の層） | Claude Code のセッション（`.claude/skills/strata-annotate`） | `posts/strata/<slug>.json` | 要約と、過去記事との関係の推定 |

注釈は本文には手を入れず、記事ごとにファイルで積みます（初回の注釈が 1 ファイル、解釈を改めるたびに再検討の注釈を 1 ファイル追加します。後述の「[注釈の再検討](#注釈の再検討1-記事複数注釈)」）。人間はタグやカテゴリを付けず、書くことに集中します。タグ・slug・excerpt は公開前に研究者（Claude Code）が整えます（後述の「[公開前の整備](#公開前の整備slugexcerpttags)」）。

### 注釈ファイルの形式

```json
{
  "slug": "hyperstrata",
  "summary": "記事の要約（200〜300 字程度）",
  "relations": [
    { "slug": "window-film", "type": "continues", "reason": "一行の理由" }
  ],
  "annotated_at": "2026-09-10T03:00:00.000Z",
  "annotator": "claude-fable-5-1",
  "icon": "tech"
}
```

| `type` | 意味 |
|---|---|
| `continues` | 続報。同じ出来事・プロジェクトの次の報告（たねハウスの進捗、週報など） |
| `revisits` | 再訪。同じテーマに別の角度や時期から戻った |
| `updates` | 更新。過去記事の内容や考えを改める意図がある（思考の変遷） |

`icon`（省略可）は記事の題材を表す種別で、地層の可視化（テーマ側の Hyperstrata グラフ）でアイコン表示に使う。該当する題材が無ければ省略する。

| `icon` | 題材 |
|---|---|
| `cat` | 猫 |
| `house` | 古民家・DIY・住まい |
| `hunting` | 狩猟 |
| `game` | 格ゲー・ゲーム |
| `tech` | 開発・Ghost運用・ツール |
| `travel` | 旅行・遠征 |
| `journal` | 週報・振り返り・エッセイ的な考え |
| `event` | 勉強会・登壇・交流イベント |

ルール（`pnpm --filter ./posts strata check` が検査します。CI と pre-commit hook でも実行）:

- 注釈は公開済みの記事にだけ付けます。関係は自分より前に公開された記事だけを指します（後方参照のみ。有向非巡回グラフを保つ）。
- 一度書いた注釈は書き換えません（タイポ修正も含む）。解釈を改めたいときは再検討の注釈を新しいファイルとして積みます（次節）。
- 限定記事（`visibility` が `members` / `paid`）の注釈は `strata/private/<slug>.json` に置き、`summary` と `reason` を sops で暗号化します。関係先の slug と `type`、`icon` は title と同じく公開情報として平文で残します。

### 注釈の再検討（1 記事複数注釈）

後の記事が出たことで古い記事の関係や要約を見直したくなったら（年代測定の修正のように）、初回の注釈には触れず、同じディレクトリに再検討の注釈を積みます。

| 注釈 | ファイル | `annotated_at` |
|---|---|---|
| 初回 | `strata/<slug>.json`（限定記事は `strata/private/<slug>.json`） | ISO 8601（既存ファイルの形式のまま） |
| 再検討 | `strata/<slug>.<YYYYMMDDTHHMMSSZ>.json`（限定記事は `strata/private/<slug>.<YYYYMMDDTHHMMSSZ>.json`） | `YYYY-MM-DDTHH:MM:SSZ`（UTC・秒精度）。ファイル名のスタンプは `annotated_at` から `-` と `:` を除いたもの |

- 再検討の注釈は差分ではなく完全な注釈（`summary`・`relations`・`icon` すべて）として書きます。読む側は 1 ファイルで完結します。
- Ghost の slug はドットを含まないため、ファイル名は最初のドットで slug とスタンプに分かれます。ディレクトリ構成を変えないので、`.sops.yaml` の暗号化ルールと `.gitignore` はそのまま当てはまります。
- `strata check` は「再検討には初回の注釈がある」「再検討の `annotated_at` は初回より後（同時刻も不可）」「ファイル名のスタンプと `annotated_at` が一致する」を検査します。
- `strata catalog` の要約と、`hyperstrata-sync` workflow が作る `theme/assets/graph.json` は、記事ごとに `annotated_at` が最新の注釈を採用します。履歴は graph.json に含めません（過去の解釈はリポジトリに残ります）。
- 限定記事の再検討は `strata/private/<slug>.<スタンプ>.plain.json` に書き、`pnpm --filter ./posts strata encrypt <slug>.<スタンプ>` で暗号化します。

### コマンド

```bash
pnpm --filter ./posts strata pending          # 公開済みでまだ注釈が無い記事を、公開日の古い順に一覧する
pnpm --filter ./posts strata catalog <slug>   # <slug> より前に公開された記事の一覧（要約付き）を JSON で出す（限定記事の要約は復号する）
pnpm --filter ./posts strata text <slug>      # <slug> の本文をプレーンテキストで出す（限定記事は復号する）
pnpm --filter ./posts strata check            # すべての注釈の形式・置き場所・暗号化・整合・再検討の順序を検査する
pnpm --filter ./posts strata decrypt <stem>   # strata/private/<stem>.json を復号して <stem>.plain.json（.gitignore 対象）を作る
pnpm --filter ./posts strata encrypt <stem>   # <stem>.plain.json を検証・暗号化して strata/private/<stem>.json に書き、平文を削除する
```

`<stem>` は注釈ファイル名から `.json` を除いたものです（初回の注釈は `<slug>`、再検討は `<slug>.<YYYYMMDDTHHMMSSZ>`）。`strata encrypt` は暗号化済みファイルが既にあれば拒みます（一度書いた注釈を書き換えないため）。

記事一覧は `content/**/*.post.json` の平文メタ情報から作るため、注釈を付ける前に `pull` で最新にしてください。注釈を付ける手順は `.claude/skills/strata-annotate/SKILL.md` にまとめています。

## 公開前の整備（slug・excerpt・tags）

著者が下書きを書き終えたあと、公開する前に、Claude Code のセッション（`.claude/skills/publish-prepare`）が研究者として slug・excerpt・tags を整えます。整備は下書きのうちに行います（slug は URL と Hyperstrata の関係の主キーになるため、公開後は変えません）。流れは「下書き → 整備（publish-prepare） → 公開（ghost-posts） → 注釈（strata-annotate）」です。

| 項目 | 基準 | 検査 |
|---|---|---|
| slug | `YYYYMMDD-<英語の題材>`（例: `20260910-hyperstrata-design`）。日付は公開予定日（JST）。同じ話題が繰り返される前提で、日付で一意にする。既存記事（日付の無い slug）は変えない | `curate check`、`curate rename` |
| excerpt | 140 字以内。「A、B、C について話しました。」のように話した題材を並べる、Podcast の概要のような文。結論や感想は入れない（結論まで書く要約は注釈の `summary`） | `curate check` |
| tags | `tags.json`（統制語彙）から 1〜3 個。`#` で始まる内部タグ（`#ref-*` など）は対象外 | `curate check`、`curate tags check`（CI と pre-commit hook） |

### 統制語彙（`tags.json`）

```json
{
  "tags": [
    { "name": "猫の話", "slug": "cat", "description": "飼い猫の記事（お迎え・行動・道具・健康）" }
  ]
}
```

- `name` は Ghost のタグ名（記事の `tags` に書く値）、`slug` は Ghost のタグ slug（英小文字・数字・ハイフン。日本語名から Ghost が自動生成する中国語読みの slug を避けるために明示する）、`description` はどんな記事に付けるかの基準です。
- 語彙は固定ではありません。記事が積もるにつれて、研究者が記事全体を見ながら統合・分割・改名を行います。語彙を変えたら `curate tags sync` で Ghost のタグに反映し、既存記事のタグを付け替えたうえで `curate tags check` を通します。
- 語彙に無いタグが付いた記事があると `curate tags check` が失敗します（付け替え忘れの検出）。

### コマンド

```bash
pnpm --filter ./posts curate tags                    # 統制語彙を、記事での使用数とともに一覧する
pnpm --filter ./posts curate tags check              # すべての記事のタグが統制語彙にあるかを検査する（CI と pre-commit hook）
pnpm --filter ./posts curate tags sync [--dry-run]   # 統制語彙に合わせて Ghost のタグを作成・slug 変更する（語彙に無い Ghost のタグには触れない）
pnpm --filter ./posts curate check <slug>            # 下書きが公開の基準（slug 形式・excerpt・タグ）を満たすかを検査する
pnpm --filter ./posts curate rename <old> <new>      # 下書きの slug を変更する（Ghost 側を変え、content/ の古いファイルを消して pull し直す）
```

`curate rename` は下書きにだけ使えます。公開済みの記事や、Hyperstrata の注釈（`strata/<slug>.json`）がある記事は拒みます。ghst 0.17.1 の `post update` には slug を変える専用オプションが無いため、`{ "slug": ... }` を `--from-json` で渡しています。

## 開発

```bash
pnpm --filter ./posts test
pnpm --filter ./posts lint
pnpm --filter ./posts type-check
pnpm --filter ./posts check-private            # 限定記事が平文でコミットされていないか（CI と pre-commit hook でも実行）
pnpm --filter ./posts strata check             # Hyperstrata の注釈の形式・暗号化・整合（CI と pre-commit hook でも実行）
```
