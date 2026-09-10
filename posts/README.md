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

## 記事ファイルの書き方

`posts/content/<slug>.md` に 1 記事 1 ファイルで置きます。ファイル名（拡張子を除いたもの）が Ghost の slug になります。

```markdown
---
title: 記事タイトル          # 必須
slug: custom-slug           # 省略時はファイル名
status: draft               # draft（既定）| published
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

## 反映

```bash
pnpm --filter ./posts push content/<slug>.md --dry-run   # 実行予定のコマンドを表示するだけ
pnpm --filter ./posts push content/<slug>.md             # slug が存在すれば更新、無ければ作成
```

`push` は `ghst post update --slug <slug>` を試み、記事が無い（終了コード 5）ときだけ `ghst post create` にフォールバックします。frontmatter の `status` をそのまま送るため、`status: published` にして push すると公開されます。

公開・予約・削除など push が扱わない操作は ghst を直接使います。

```bash
pnpm ghst post list --limit 10
pnpm ghst post get --slug <slug> --json --jq '.posts[0] | {id, status, url}'
pnpm ghst post publish <id>
pnpm ghst post schedule <id> --at 2026-10-01T09:00:00+09:00
pnpm ghst --enable-destructive-actions post delete <id>
```

## 制約

- Ghost 側で編集した内容をこのリポジトリに戻す（pull）機能はありません。Ghost の本文は Lexical 形式で保存されるため、Markdown への逆変換は行っていません。このリポジトリを正とし、Ghost エディタでは本文を編集しない運用を前提にしています。
- `status` は `draft` と `published` のみ受け付けます。予約公開は `ghst post schedule` を使ってください。

## 開発

```bash
pnpm --filter ./posts test
pnpm --filter ./posts lint
pnpm --filter ./posts type-check
```
