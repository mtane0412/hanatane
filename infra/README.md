# infra（旧 ghost-vps）

さくらのVPS上で稼働する Ghost ブログ `https://hanatane.net/` の構成管理。hanatane モノレポの `infra/` ディレクトリで管理する（コマンドはこのディレクトリで実行する）。

リポジトリは公開のため、機密は必ず sops + age で暗号化する。origin（VPS）の IP アドレスも `tofu/origin.sops.tfvars` に暗号化して置き、`dns.tf` に平文で書かない。

## 構成

| コンポーネント | 技術 |
|---|---|
| ブログ本体 | Ghost 6 (Docker) |
| DB | MySQL 8.0 (Docker) |
| リバースプロキシ/TLS | Caddy (Docker, compose ネットワーク) |
| Web Analytics | Tinybird Cloud + traffic-analytics (Docker) |
| ActivityPub | activitypub (Docker、Social Web 自己ホスト) |
| VPS | さくらのVPS / Debian 12 |
| DNS | Cloudflare（Proxy有効） |

Web Analytics と ActivityPub は `ansible/group_vars/all.yml` の `ghost_analytics_enabled` /
`ghost_activitypub_enabled` フラグで有効/無効を切り替える（`COMPOSE_PROFILES` で制御）。

## ディレクトリ構造

```
.
├── secrets/
│   └── ghost.env                      # sops+age で暗号化済みシークレット（コミット可）
├── ansible/
│   ├── deploy.yml                      # デプロイ Playbook
│   ├── inventory.ini                   # インベントリ（Host: sakura）
│   ├── group_vars/all.yml             # 変数（ghost_image_tag、機能トグル等）
│   ├── templates/                      # Jinja2 テンプレート
│   │   ├── docker-compose.yml.j2      # Docker Compose（analytics/AP 条件付き）
│   │   ├── Caddyfile.j2               # Caddy リバースプロキシ設定
│   │   └── env.j2                     # ~/ghost/.env テンプレート
│   └── files/
│       ├── tinybird/                  # Tinybird ビルドコンテキスト（ベンダリング）
│       ├── caddy/snippets/            # Caddy snippets（TrafficAnalytics, ActivityPub）
│       └── mysql-init/                # MySQL 初期化スクリプト
├── tofu/
│   ├── dns.tf                         # hanatane.net DNS レコード（Cloudflare）
│   └── versions.tf                    # プロバイダバージョン固定
└── docs/
    └── runbook.md                     # 運用手順・Ghost 6 機能・鍵管理・リカバリ手順
```

## クイックスタート

```bash
# 依存コレクションのインストール
ansible-galaxy collection install -r ansible/requirements.yml

# dry-run
ansible-playbook -C -i ansible/inventory.ini ansible/deploy.yml

# 本適用
ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
```

詳細は [`docs/runbook.md`](docs/runbook.md) を参照。

## シークレット管理

機密情報は `secrets/ghost.env` に SOPS + age で暗号化して保存。復号には
`~/.config/sops/age/keys.txt` の秘密鍵が必要。

```bash
# 確認（復号テスト）
sops -d secrets/ghost.env

# 編集
sops secrets/ghost.env
```
