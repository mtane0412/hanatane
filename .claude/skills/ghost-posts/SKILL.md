---
name: ghost-posts
description: hanatane.net（Ghost）の記事を posts/content/*.md で作成・更新・公開する。ユーザーが「記事を書いて」「下書きを作って」「記事を更新して」「公開して」「記事一覧を見せて」と言ったときに使う。ghst CLI と posts/ の push スクリプトを組み合わせる。
---

# Ghost 記事管理（ghst + posts/）

前提の詳細は `posts/README.md` を参照すること。認証は `pnpm ghst auth status` で確認し、未設定ならユーザーに `pnpm ghst auth login --site hanatane` の実行を依頼して止まる（Staff access token はユーザーしか作れない）。

## 記事を書く・更新する

1. `posts/content/<slug>.md` を frontmatter 付きで作成・編集する。slug は英小文字とハイフンのみ。frontmatter の必須項目は `title`、`status` は省略すると `draft`。
2. 段落内で改行すると `<br>` になるため、1 段落は 1 行で書く。
3. `pnpm --filter ./posts push content/<slug>.md --dry-run` で引数を確認してから、`--dry-run` なしで実行する。
4. 実行後は `pnpm ghst post get --slug <slug> --json --jq '.posts[0] | {id, status, url, updated_at}'` で結果を確認して報告する。

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
- Ghost エディタで直接編集された記事を push すると本文がリポジトリの内容で上書きされる。push 前に `updated_at` が想定より新しくないか確認し、疑わしければユーザーに確認する。
- `ghst auth token` の出力や Staff access token をログ・ファイル・コミットに残さない。
