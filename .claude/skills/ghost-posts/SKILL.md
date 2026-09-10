---
name: ghost-posts
description: hanatane.net（Ghost）の記事を posts/content/*.md で作成・更新・公開する。ユーザーが「記事を書いて」「下書きを作って」「記事を更新して」「公開して」「記事一覧を見せて」と言ったときに使う。ghst CLI と posts/ の push スクリプトを組み合わせる。
---

# Ghost 記事管理（ghst + posts/）

前提の詳細は `posts/README.md` を参照すること。認証は `pnpm ghst auth status` で確認し、未設定ならユーザーに `pnpm ghst auth login --site hanatane` の実行を依頼して止まる（Staff access token はユーザーしか作れない）。

## 記事ファイルの形式

- 新規記事: `posts/content/<slug>.md`（frontmatter 付き Markdown）。slug は英小文字とハイフンのみ。必須項目は `title`、`status` は省略すると `draft`。段落内で改行すると `<br>` になるため、1 段落は 1 行で書く。
- 既存記事: `posts/content/<slug>.post.json`（`pull` で取り込んだ Lexical JSON）。本文は `lexical` の中で、テキスト修正は該当ノードの `text` を書き換える。ノードの構造（`type`、`version`、`children`）は既存に合わせる。

## 新規記事を書く

1. `posts/content/<slug>.md` を作成する。
2. `pnpm --filter ./posts push content/<slug>.md --dry-run` で引数を確認してから、`--dry-run` なしで実行する。
3. 実行後は `pnpm ghst post get --slug <slug> --json --jq '.posts[0] | {id, status, url, updated_at}'` で結果を確認して報告する。

## 既存記事を更新する

1. **編集前に必ず** `pnpm --filter ./posts pull --slug <slug>` を実行し、Ghost 側の最新（`#ref-*` タグなど）を取り込む。`git diff` で差分が出たら、Ghost 側で編集されていたことをユーザーに伝える。
2. `posts/content/<slug>.post.json` を編集する。
3. `pnpm --filter ./posts push content/<slug>.post.json` で反映し、上記と同じく結果を確認して報告する。

## 公開する

- ユーザーが明示的に公開を依頼した場合のみ行う。frontmatter を `status: published` に変えて push するか、`pnpm ghst post publish <id>` を使う。
- メール配信（`--newsletter` など）は依頼が無い限り付けない。

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
