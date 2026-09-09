# CLAUDE.md

hanatane.net（Ghost）に関わるものを束ねるモノレポ。パッケージ管理は pnpm workspaces（`pnpm install` はルートで実行）。

## 構成

| ディレクトリ | 内容 | 詳細 |
|---|---|---|
| `theme/` | Ghost テーマ（TryGhost/Source から派生、upstream 同期は終了し独自開発） | `theme/AGENTS.md` |
| `ogp/` | OGP 画像生成。手動作成 Web アプリ（Cloudflare Workers）と、Ghost の `og_image` への事前生成 | `ogp/CLAUDE.md` |
| `infra/` | さくら VPS の構成管理（Ansible、OpenTofu、sops+age 暗号化シークレット） | `infra/README.md`, `infra/docs/runbook.md` |
| `packages/` | 共有パッケージ（今後: Ghost Admin API クライアントの共通化） | |

## コマンド

```bash
pnpm install --frozen-lockfile
pnpm test            # theme の gscan + scripts テスト、ogp の vitest
pnpm test:theme
pnpm test:ogp
pnpm --filter ./theme dev
pnpm --filter ./ogp dev
```

## GitHub Actions（`.github/workflows/`）

| workflow | トリガー | 内容 |
|---|---|---|
| `test-theme.yml` | PR（theme/ 変更時） | gscan と scripts テスト |
| `test-ogp.yml` | PR（ogp/ 変更時） | 型チェック、Lint、テスト、ビルド |
| `deploy-theme.yml` | main への push（theme/ 変更時）、手動 | テーマ zip を Ghost へデプロイ |
| `hyperstrata-sync.yml` | 15 分おき、手動 | 引用タグ付与と `theme/assets/graph.json` 更新 |
| `sync-og-images.yml` | 15 分おき、手動 | feature image の無い記事に OGP 画像を生成して `og_image` に設定 |

必要な Secrets: `GHOST_ADMIN_API_URL`、`GHOST_ADMIN_API_KEY`（すべての workflow で共通）。

## 公開リポジトリとしての約束

- 機密は sops + age で暗号化したものだけをコミットする（`infra/secrets/`、`infra/tofu/*.sops.tfvars`）。
- VPS の origin IP は Cloudflare Proxy で秘匿しているため、平文で書かない（`infra/tofu/origin.sops.tfvars` を使う）。
- `.tfstate` はコミットしない（`infra/tofu/.gitignore`）。

## Git

- main への直接コミットは禁止。feature ブランチから PR を作る。
- `gh pr create` には必ず `--repo mtane0412/hanatane` を付ける。
- 旧リポジトリ（mtane0412/Source、hanatane-ogp-generator、ghost-vps）はアーカイブ済みで、変更はすべてここで行う。
