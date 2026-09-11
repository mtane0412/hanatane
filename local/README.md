# local

テーマ(`theme/`)の見た目を、本番と同じ Ghost の Docker イメージでローカル確認するための環境です。本番の VPS 構成(`infra/`)とは独立しており、MySQL や Mailgun は使わず SQLite で動きます。

## 構成

| ファイル | 内容 |
|---|---|
| `docker-compose.yml` | Ghost を 1 コンテナで起動する。`theme/` をテーマ `source` としてバインドマウントし、`node_modules/` は空のボリュームで隠す |
| `seed-posts.mjs` | `posts/content/*.post.json` の公開記事を、本番と同じ公開日(`published_at`)付きでローカルの Ghost に投入する |
| `seed-posts.test.mjs` | `seed-posts.mjs` の純粋関数のテスト(`pnpm test:local`) |

記事データ(SQLite と画像)は Docker のボリューム `local_ghost_content` に入り、リポジトリには含まれません。

## 初回セットアップ

1. Ghost を起動する。

   ```bash
   docker compose -f local/docker-compose.yml up -d
   ```

2. ブラウザで <http://localhost:2368/ghost/> を開き、管理者アカウントを作る(ローカル専用なので任意のメールアドレスとパスワードでよい)。
3. Ghost Admin → Settings → Staff → 自分のプロフィール → **Staff access token** を作成してコピーする。
4. ghst に alias `local` として登録する。alias 名は `seed-posts.mjs` が固定で使うので変えない。

   ```bash
   pnpm ghst auth login --site local --url http://localhost:2368 --staff-token <id>:<secret>
   pnpm ghst site info --site local --json   # url が http://localhost:2368/ ならよい
   ```

   `.ghst/config.json` が本番の alias `hanatane` を指しているため、`--site local` を付けない ghst コマンドは本番に向きます。ローカルを操作するときは必ず `--site local`(または環境変数 `GHOST_SITE=local`)を付けてください。

5. 記事を投入する。

   ```bash
   node local/seed-posts.mjs                 # 公開記事をすべて投入(2 回目以降は更新)
   node local/seed-posts.mjs <slug> <slug>   # 一部だけ
   ```

   投入前に `ghst site info --site local` で接続先の URL が `localhost` / `127.0.0.1` であることを確かめ、そうでなければ何もせずに止まります。メンバー限定記事(`posts/content/private/`)は投入しません。

6. <http://localhost:2368/> を開き、トップページの地層タイムラインと記事ページ左側の地層グラフを確認する。

## 日常の使い方

```bash
docker compose -f local/docker-compose.yml up -d     # 起動
docker compose -f local/docker-compose.yml logs -f    # ログ
docker compose -f local/docker-compose.yml down       # 停止(データは残る)
docker compose -f local/docker-compose.yml down -v    # データも消す(次回は初回セットアップからやり直し)
```

- テーマの CSS / JS を編集したら `pnpm --filter ./theme build`(または `pnpm --filter ./theme dev` で監視)で `theme/assets/built/` を更新し、ブラウザを再読み込みする。Handlebars テンプレートの変更は再読み込みだけで反映される。
- `theme/assets/graph.json`(Hyperstrata の引用グラフ)はリポジトリにあるものがそのまま配信される。記事の slug が本番と同じなので、グラフの表示確認には投入した記事で足りる。ただし graph.json の中の URL は本番を指すので、グラフからのリンク先は hanatane.net になる。
- 本番の記事を最新にしたいときは `pnpm --filter ./posts pull` で `posts/content/` を更新してから `node local/seed-posts.mjs` を実行する。
- Ghost のバージョンは本番(`infra/ansible/group_vars/all.yml` の `ghost_image_tag`)に合わせて `docker-compose.yml` の `image` を更新する。

## 既知の注意点

- 起動直後のログに `IMAGE_SIZE_URL` / `URL empty or invalid.` が出ることがある。サイトのロゴやアイコンが未設定のときに `{{ghost_head}}` が画像サイズを取れずに出す警告で、表示には影響しない。Ghost Admin → Settings → Design でロゴやアイコンを設定すると消える。
- テーマのフォルダ名は Ghost 既定テーマと同じ `source` なので、Ghost 側の既定テーマは表示されない(このリポジトリの `theme/` が最初から有効になる)。
