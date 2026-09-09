# 変数定義
#
# zone_id は Cloudflare ダッシュボードの「概要」または以下のコマンドで取得:
#   curl -s "https://api.cloudflare.com/client/v4/zones?name=hanatane.net" \
#     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq -r '.result[0].id'

variable "zone_id" {
  description = "hanatane.net の Cloudflare Zone ID"
  type        = string
  # TF_VAR_zone_id 環境変数または -var='zone_id=...' で指定する
  # 値は docs/runbook.md を参照
}

# ---- origin（VPS）のアドレス ----
# Cloudflare Proxy で秘匿している origin の IP はリポジトリを公開するため平文で置かず、
# sops で暗号化した tofu/origin.sops.tfvars から読み込む:
#   sops exec-file tofu/origin.sops.tfvars 'tofu plan -var-file={}' （tofu/ 内で実行する場合はパスを調整）

variable "origin_ipv4" {
  description = "VPS の IPv4 アドレス（apex A レコードの値）"
  type        = string
  sensitive   = true
}

variable "origin_ipv6" {
  description = "VPS の IPv6 アドレス（apex AAAA レコードの値）"
  type        = string
  sensitive   = true
}
