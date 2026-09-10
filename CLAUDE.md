# CLAUDE.md

hanatane.net（Ghost）に関わるものを束ねるモノレポ。パッケージ管理は pnpm workspaces（`pnpm install` はルートで実行）。

## 構成

| ディレクトリ | 内容 | 詳細 |
|---|---|---|
| `theme/` | Ghost テーマ（TryGhost/Source から派生、upstream 同期は終了し独自開発） | `theme/AGENTS.md` |
| `ogp/` | OGP 画像生成。手動作成 Web アプリ（Cloudflare Workers）と、Ghost の `og_image` への事前生成 | `ogp/CLAUDE.md` |
| `posts/` | 記事の管理（新規は Markdown、既存は `pull` で取り込んだ Lexical JSON）と、Ghost 公式 CLI `ghst` による反映。メンバー限定記事は `posts/content/private/` に sops+age で暗号化して置く。Claude Code からは `.claude/skills/ghost-posts` を使う | `posts/README.md` |
| `infra/` | さくら VPS の構成管理（Ansible、OpenTofu、sops+age 暗号化シークレット） | `infra/README.md`, `infra/docs/runbook.md` |
| `packages/` | 共有パッケージ（今後: Ghost Admin API クライアントの共通化） | |

## コマンド

```bash
pnpm install --frozen-lockfile
pnpm test            # theme の gscan + scripts テスト、ogp の vitest
pnpm test:theme
pnpm test:ogp
pnpm test:posts
pnpm ghst <command>   # Ghost 公式 CLI（認証は pnpm ghst auth login --site hanatane、posts/README.md 参照）
pnpm --filter ./posts pull                          # Ghost の記事を content/<slug>.post.json に取り込む
pnpm --filter ./posts push content/<slug>.md        # または content/<slug>.post.json
pnpm --filter ./theme dev
pnpm --filter ./ogp dev
```

## GitHub Actions（`.github/workflows/`）

| workflow | トリガー | 内容 |
|---|---|---|
| `test-theme.yml` | PR（theme/ 変更時） | gscan と scripts テスト |
| `test-ogp.yml` | PR（ogp/ 変更時） | 型チェック、Lint、テスト、ビルド |
| `test-posts.yml` | PR（posts/ 変更時） | 型チェック、Lint、テスト |
| `deploy-theme.yml` | main への push（theme/ 変更時）、手動 | テーマ zip を Ghost へデプロイ |
| `hyperstrata-sync.yml` | 15 分おき、手動 | 引用タグ付与と `theme/assets/graph.json` 更新 |
| `sync-og-images.yml` | Ghost の `post.published` Webhook（`ogp/` の Worker が `repository_dispatch` に中継）、15 分おき、手動 | feature image の無い記事に OGP 画像を生成して `og_image` に設定 |

必要な Secrets: `GHOST_ADMIN_API_URL`、`GHOST_ADMIN_API_KEY`（すべての workflow で共通）。

## 公開リポジトリとしての約束

- 機密は sops + age で暗号化したものだけをコミットする（`infra/secrets/`、`infra/tofu/*.sops.tfvars`、`posts/content/private/*.post.json`）。
- メンバー限定記事（Ghost の `visibility` が `members` / `paid`）の本文を平文でコミットしない。`posts/content/private/` に暗号化して置き、`pnpm --filter ./posts check-private`（pre-commit hook と CI で自動実行）で検査する。
- VPS の origin IP は Cloudflare Proxy で秘匿しているため、平文で書かない（`infra/tofu/origin.sops.tfvars` を使う）。
- `.tfstate` はコミットしない（`infra/tofu/.gitignore`）。
- ghst の Staff access token はキーチェーン（`~/.config/ghst/`）にのみ保存する。`.ghst/config.json` には alias 名だけを入れる。

## Git

- main への直接コミットは禁止。feature ブランチから PR を作る。
- `gh pr create` には必ず `--repo mtane0412/hanatane` を付ける。
- 旧リポジトリ（mtane0412/Source、hanatane-ogp-generator、ghost-vps）はアーカイブ済みで、変更はすべてここで行う。
