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

注釈は本文には手を入れず、記事ごとに 1 ファイルで積みます。人間はタグやカテゴリを付けず、書くことに集中します。

### 注釈ファイルの形式

```json
{
  "slug": "hyperstrata",
  "summary": "記事の要約（200〜300 字程度）",
  "relations": [
    { "slug": "window-film", "type": "continues", "reason": "一行の理由" }
  ],
  "annotated_at": "2026-09-10T03:00:00.000Z",
  "annotator": "claude-fable-5-1"
}
```

| `type` | 意味 |
|---|---|
| `continues` | 続報。同じ出来事・プロジェクトの次の報告（たねハウスの進捗、週報など） |
| `revisits` | 再訪。同じテーマに別の角度や時期から戻った |
| `updates` | 更新。過去記事の内容や考えを改める意図がある（思考の変遷） |

ルール（`pnpm --filter ./posts strata check` が検査します。CI と pre-commit hook でも実行）:

- 注釈は公開済みの記事にだけ付けます。関係は自分より前に公開された記事だけを指します（後方参照のみ。有向非巡回グラフを保つ）。
- 一度書いた注釈は書き換えません。解釈を改めたいときは新しい注釈を積みます（現状は 1 記事 1 ファイルで、追記の形式は未定）。
- 限定記事（`visibility` が `members` / `paid`）の注釈は `strata/private/<slug>.json` に置き、`summary` と `reason` を sops で暗号化します。関係先の slug と `type` は title と同じく公開情報として平文で残します。

### コマンド

```bash
pnpm --filter ./posts strata pending          # 公開済みでまだ注釈が無い記事を、公開日の古い順に一覧する
pnpm --filter ./posts strata catalog <slug>   # <slug> より前に公開された記事の一覧（要約付き）を JSON で出す（限定記事の要約は復号する）
pnpm --filter ./posts strata text <slug>      # <slug> の本文をプレーンテキストで出す（限定記事は復号する）
pnpm --filter ./posts strata check            # すべての注釈の形式・置き場所・暗号化・整合を検査する
pnpm --filter ./posts strata decrypt <slug>   # strata/private/<slug>.json を復号して <slug>.plain.json（.gitignore 対象）を作る
pnpm --filter ./posts strata encrypt <slug>   # <slug>.plain.json を検証・暗号化して strata/private/<slug>.json に書き、平文を削除する
```

記事一覧は `content/**/*.post.json` の平文メタ情報から作るため、注釈を付ける前に `pull` で最新にしてください。注釈を付ける手順は `.claude/skills/strata-annotate/SKILL.md` にまとめています。

## 開発

```bash
pnpm --filter ./posts test
pnpm --filter ./posts lint
pnpm --filter ./posts type-check
pnpm --filter ./posts check-private            # 限定記事が平文でコミットされていないか（CI と pre-commit hook でも実行）
pnpm --filter ./posts strata check             # Hyperstrata の注釈の形式・暗号化・整合（CI と pre-commit hook でも実行）
```
