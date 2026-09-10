---
name: ghost-posts
description: hanatane.net（Ghost）の記事を posts/content/*.md で作成・更新・公開する。ユーザーが「記事を書いて」「下書きを作って」「記事を更新して」「公開して」「記事一覧を見せて」と言ったときに使う。ghst CLI と posts/ の push スクリプトを組み合わせる。
---

# Ghost 記事管理（ghst + posts/）

前提の詳細は `posts/README.md` を参照すること。認証は `pnpm ghst auth status` で確認し、未設定ならユーザーに `pnpm ghst auth login --site hanatane` の実行を依頼して止まる（Staff access token はユーザーしか作れない）。

## 記事ファイルの形式

- 新規記事: `posts/content/<slug>.md`（frontmatter 付き Markdown）。slug は英小文字とハイフンのみ。必須項目は `title`、`status` は省略すると `draft`。段落内で改行すると `<br>` になるため、1 段落は 1 行で書く。
- 既存記事: `posts/content/<slug>.post.json`（`pull` で取り込んだ Lexical JSON）。本文は `lexical` の中で、テキスト修正は該当ノードの `text` を書き換える。ノードの構造（`type`、`version`、`children`）は既存に合わせる。
- メンバー限定記事（`visibility` が `members` / `paid`）: `posts/content/private/<slug>.post.json`（sops 暗号化済み）。扱い方は後述の「メンバー限定記事」に従う。**`content/` 直下に `visibility: members` / `paid` のファイルを作ってはいけない**（push と pre-commit hook がエラーにする）。

## 新規記事を書く

1. `posts/content/<slug>.md` を作成する。
2. `pnpm --filter ./posts push content/<slug>.md --dry-run` で引数を確認してから、`--dry-run` なしで実行する。
3. 実行後は `pnpm ghst post get --slug <slug> --json --jq '.posts[0] | {id, status, url, updated_at}'` で結果を確認して報告する。

## 既存記事を更新する

1. **編集前に必ず** `pnpm --filter ./posts pull --slug <slug>` を実行し、Ghost 側の最新（`#ref-*` タグなど）を取り込む。`git diff` で差分が出たら、Ghost 側で編集されていたことをユーザーに伝える。
2. `posts/content/<slug>.post.json` を編集する。
3. `pnpm --filter ./posts push content/<slug>.post.json` で反映し、上記と同じく結果を確認して報告する。

## メンバー限定記事（visibility が members / paid）

公開リポジトリなので、限定記事の本文を平文で `posts/content/` に置いたりコミットしたりしない。詳細は `posts/README.md` の「メンバー限定記事」を参照。

- 既存の限定記事を編集する: `pnpm --filter ./posts pull --slug <slug>` → `pnpm --filter ./posts private decrypt <slug>` → `posts/content/private/<slug>.plain.post.json` を編集 → `pnpm --filter ./posts private encrypt <slug>`（平文は自動で削除される）→ `pnpm --filter ./posts push content/private/<slug>.post.json`。
- 限定記事を新規に書く: `posts/content/private/<slug>.md`（frontmatter に `visibility: members` または `paid`。`.gitignore` 対象）を作って push し、その `.md` を削除してから `pull --slug <slug>` で暗号化済み `.post.json` を作る。
- 暗号化済みの `.post.json` を直接編集しない（sops の MAC 検証に失敗する）。
- 限定記事を public に変更する push は `--allow-public` が必要。ユーザーが明示的に「公開範囲を public にして」と依頼した場合だけ付け、依頼が無ければ付けない。
- 作業を終えるとき `posts/content/private/` に `.plain.post.json` や `.md` を残さない。

## 公開する

- ユーザーが明示的に公開を依頼した場合のみ行う。frontmatter を `status: published` に変えて push するか、`pnpm ghst post publish <id>` を使う。
- メール配信（`--newsletter` など）は依頼が無い限り付けない。
- 公開したら `pnpm --filter ./posts pull --slug <slug>` で `published_at` を取り込み、`strata-annotate` スキルで Hyperstrata の注釈（要約と過去記事との関係）を書く。注釈を後回しにするときは、その旨をユーザーに伝える。

## 参照系

```bash
pnpm ghst post list --limit 10 --json --jq '.posts[] | {slug, status, title}'
pnpm ghst post get --slug <slug> --json
pnpm ghst tag list --json --jq '.tags[].name'
```

## 禁止・注意

- `post delete` や `--enable-destructive-actions` を伴う操作はユーザーの明示的な承認なしに実行しない。
- Ghost エディタで直接編集された記事を push すると本文と tags がリポジトリの内容で上書きされる。push 前に pull して差分が無いことを確認し、疑わしければユーザーに確認する。
- `pnpm ghst ... --json` の出力をパイプで受けると 64KB 付近で途切れることがある。大きな出力はファイルにリダイレクトするか、`pull` を使う。
- `ghst auth token` の出力や Staff access token をログ・ファイル・コミットに残さない。
