# 運用ランブック — Ghost VPS（hanatane.net）

## 構成概要

| 領域 | ツール | 場所 |
|---|---|---|
| Ghost ブログ（本番） | Docker Compose on さくらVPS | `debian@sakura:~/ghost/` |
| Ansible デプロイ | ansible-playbook | `ansible/deploy.yml` |
| DNS 管理 | OpenTofu + Cloudflare provider v5 | `tofu/` |
| シークレット暗号化 | SOPS + age | `secrets/ghost.env`（暗号化済みコミット） |
| リモートリポジトリ | GitHub private | `mtane0412/ghost-vps` |

---

## 初回セットアップ（ローカル Mac）

### 1. 依存ツールの確認

```bash
sops --version    # >= 3.13.1
age --version
ansible --version # >= 2.21
tofu version      # >= 1.12
gh auth status    # mtane0412 でログイン済み
```

### 2. Ansible コレクションのインストール

```bash
ansible-galaxy collection install -r ansible/requirements.yml
```

### 3. age 秘密鍵の確認

```bash
ls -la ~/.config/sops/age/keys.txt
# 存在しない場合は秘密鍵をリストアする（下記「鍵ロストからのリストア」参照）
```

### 4. sops 復号確認

```bash
sops -d secrets/ghost.env
# 正常に復号できれば環境OK
```

---

## デプロイ手順

### dry-run（差分確認）

```bash
cd ansible
ansible-playbook -C -i inventory.ini deploy.yml
```

### 本適用

```bash
cd ansible
ansible-playbook -i inventory.ini deploy.yml
```

### 手動でサービス確認

```bash
ssh sakura 'docker compose -f ~/ghost/docker-compose.yml ps'
curl -I https://hanatane.net/
```

---

## Cloudflare DNS 管理（OpenTofu）

### 初回: Cloudflare API トークンの取得

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/profile/api-tokens) へアクセス
2. 「Edit zone DNS」テンプレートで `hanatane.net` に限定したトークンを作成
3. 取得したトークンを sops で更新:
   ```bash
   sops secrets/ghost.env
   # CLOUDFLARE_API_TOKEN=<取得したトークン> に書き換えて保存
   ```

### Zone ID の取得

```bash
sops exec-env secrets/ghost.env -- \
  curl -s "https://api.cloudflare.com/client/v4/zones?name=hanatane.net" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id'
# 取得した zone_id を docs/runbook.md に記録する（機密情報ではない）
```

**zone_id**: `f39970ba35adb2b88ce029c3f0e4d02a`

### 現在の DNS レコードの確認

```bash
sops exec-env secrets/ghost.env -- \
  curl -s "https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | \
  jq '.result[] | {id, name, type, content, proxied}'
```

### 初回 tofu init & import

```bash
cd tofu
sops exec-env ../secrets/ghost.env -- tofu init

# zone_id を設定して plan（最初は REPLACE_AFTER_IMPORT で差分あり）
sops exec-env ../secrets/ghost.env -- \
  tofu plan -var='zone_id=<ZONE_ID>'

# 既存レコードを import
sops exec-env ../secrets/ghost.env -- \
  tofu import -var='zone_id=<ZONE_ID>' \
  cloudflare_dns_record.apex_a_1 <ZONE_ID>/<RECORD_ID>

sops exec-env ../secrets/ghost.env -- \
  tofu import -var='zone_id=<ZONE_ID>' \
  cloudflare_dns_record.www_cname <ZONE_ID>/<RECORD_ID>

# import 後に dns.tf の content を実際の値に更新してから:
sops exec-env ../secrets/ghost.env -- \
  tofu plan -var='zone_id=<ZONE_ID>'
# "No changes." になることを確認（現状非破壊）
```

### 通常の DNS 変更手順

```bash
cd tofu
# dns.tf を編集
sops exec-env ../secrets/ghost.env -- tofu plan -var='zone_id=<ZONE_ID>'
sops exec-env ../secrets/ghost.env -- tofu apply -var='zone_id=<ZONE_ID>'
```

---

## Ghost 6 フル機能

Ghost 6 の Web Analytics（Tinybird）と ActivityPub（Social Web 自己ホスト）は、
`ansible/group_vars/all.yml` のトグルで有効/無効を切り替える。

```yaml
ghost_analytics_enabled: true   # Web Analytics
ghost_activitypub_enabled: true # ActivityPub
```

各機能は独立して有効化でき、トグルを `false` にして再デプロイすれば切り戻せる。

---

### Caddy ネットワーク方式の変更について（Ghost 6 対応で実施済み）

Ghost 6 対応で Caddy を `network_mode: host` から compose ネットワーク（`ghost_network`）へ移行した。

- **変更前**: `network_mode: host`、`reverse_proxy localhost:8080`
- **変更後**: compose ネットワーク、`ports: 80/443 公開`、`reverse_proxy ghost:2368`（サービス名解決）

変更時は Caddy のコンテナ再作成が発生し、**一時的な接続断（数十秒）が発生する**。
TLS 証明書は `caddy_data` named volume に保存されるため再取得は不要。

---

### Tinybird ブートストラップ手順（初回のみ・手動）

`ghost_analytics_enabled: true` にして最初にデプロイする前に、以下を実施する。

#### 前提

- [Tinybird](https://www.tinybird.co/) の無料アカウントを作成済みであること
- Tinybird ワークスペースを作成済みであること（Cloud/Region は任意）

#### 手順

```bash
# 1. VPS に SSH してブートストラップ用コンテナを起動
ssh sakura
cd ~/ghost

# 2. tinybird-login: ブラウザ認証（表示された URL を Mac で開いてログイン）
docker compose run --rm tinybird-login

# 3. Ghost の Tinybird データファイルを同期
docker compose run --rm tinybird-sync

# 4. Tinybird Cloud へ Ghost の分析スキーマをデプロイ
docker compose run --rm tinybird-deploy

# 5. トークンを取得（出力を控えておく）
docker compose run --rm tinybird-login get-tokens
# 出力例:
#   TINYBIRD_API_URL=https://api.tinybird.co
#   TINYBIRD_WORKSPACE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#   TINYBIRD_ADMIN_TOKEN=p.ey...
#   TINYBIRD_TRACKER_TOKEN=p.ey...
```

#### トークンを sops に保存（Mac 側で実施）

```bash
exit  # VPS から Mac に戻る
sops secrets/ghost.env
# 以下のキーを追記して保存（自動再暗号化）:
#   TINYBIRD_API_URL=https://api.tinybird.co
#   TINYBIRD_WORKSPACE_ID=<上記の値>
#   TINYBIRD_ADMIN_TOKEN=<上記の値>
#   TINYBIRD_TRACKER_TOKEN=<上記の値>
```

#### 本適用（トークン保存後に Ansible デプロイを実行）

```bash
ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
```

---

### ActivityPub 有効化手順

`ghost_activitypub_enabled: true` にして `ansible-playbook` を実行するだけで有効化される。
初回デプロイ時に `activitypub` データベースが自動作成され、マイグレーションが実行される。

```bash
ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
```

#### Ghost 管理画面での設定

デプロイ後、Ghost Admin → Settings → Social Web で ActivityPub を有効化する。

#### 上限・制約

- フォロワー最大 2000
- フォロー最大 2000
- 1 日あたり 100 インタラクション

#### 動作確認

```bash
# WebFinger が応答することを確認
curl 'https://hanatane.net/.well-known/webfinger?resource=acct:<handle>@hanatane.net'

# activitypub コンテナのログ確認
ssh sakura 'docker compose -f ~/ghost/docker-compose.yml logs activitypub'
```

---

## シークレット管理

### secrets/ghost.env の内容（暗号化済み）

| キー | 説明 |
|---|---|
| `MYSQL_ROOT_PASSWORD` | MySQL root パスワード（Ghost/DB 共用） |
| `MAIL_AUTH_USER` | Mailgun SMTP 認証ユーザー |
| `MAIL_AUTH_PASS` | Mailgun SMTP パスワード |
| `CLOUDFLARE_API_TOKEN` | Cloudflare DNS 編集 API トークン（tofu 用） |
| `TINYBIRD_API_URL` | Tinybird API エンドポイント（analytics 有効時） |
| `TINYBIRD_ADMIN_TOKEN` | Tinybird 管理者トークン（analytics 有効時） |
| `TINYBIRD_WORKSPACE_ID` | Tinybird ワークスペース ID（analytics 有効時） |
| `TINYBIRD_TRACKER_TOKEN` | Tinybird トラッカートークン（analytics 有効時） |

### シークレットの編集

```bash
sops secrets/ghost.env
# デフォルトエディタで復号→編集→保存時に自動再暗号化
```

### パスワードローテーション（将来実施推奨）

現在の MySQL パスワード・Mailgun パスワードは初期設定時からローテーションされていない。
ローテーション手順:
1. 新しいパスワードを生成: `openssl rand -base64 32`
2. `sops secrets/ghost.env` で更新
3. Ghost コンテナを再起動（既存 DB データは named volume で保護）: `ansible-playbook -i ansible/inventory.ini ansible/deploy.yml`
4. MySQL でパスワード変更: `ssh sakura 'docker compose -f ~/ghost/docker-compose.yml exec db mysql -u root -p'`

---

## age 秘密鍵のバックアップと管理

### 現在の鍵情報

| 公開鍵 | 作成日 |
|---|---|
| `age1wegta6e9stczq4k56djgnuym48eup5k5gkysnm0aawmuqurnw3xspepxry` | 2026-06-11 |
| `age187xyvlrhufzdpyxlvcasuqr5k6du0dht7p5g5zslaztr9pgh6sgs26tj9s` | 2026-06-21 |

秘密鍵ファイル: `~/.config/sops/age/keys.txt`

### バックアップ方針（必須）

- `~/.config/sops/age/keys.txt` を 1Password または同等のパスワードマネージャの secure note に保存する
- Mac の移行・再セットアップ時にリストア必須（鍵を失うと全シークレットが復号不可になる）

### 鍵ロストからのリストア

1. バックアップから `keys.txt` を取り出す
2. `mkdir -p ~/.config/sops/age && chmod 700 ~/.config/sops/age`
3. `cat keys.txt > ~/.config/sops/age/keys.txt && chmod 600 ~/.config/sops/age/keys.txt`
4. `sops -d secrets/ghost.env` で復号できることを確認

---

## VPS 障害・コンテナ復旧

### コンテナ全停止からの復旧

```bash
ssh sakura 'cd ~/ghost && docker compose up -d'
# または Ansible で:
ansible-playbook -i ansible/inventory.ini ansible/deploy.yml
```

### Ghost named volume が壊れた場合

**警告**: named volume を削除するとブログデータが失われる。必ずバックアップを先に取ること。

```bash
# ブログデータのバックアップ（Ghost 管理画面から Labs > Export を推奨）
# コンテナとボリュームの確認
ssh sakura 'docker volume ls | grep ghost'
```

### Caddy TLS 証明書の更新

Caddy は自動更新するため通常は不要。
証明書は named volume の `./data/caddy/` に保存される（`~/ghost/data/caddy/`、root 所有）。

---

## OpenTofu state の将来的なリモート化

現在は state をローカル管理（`.gitignore` で除外）。
複数人での運用が必要になった場合の選択肢:
- **Cloudflare R2** を backend として使用（Cloudflare エコシステムと統一）
- **Terraform Cloud / Spacelift** での state 管理
