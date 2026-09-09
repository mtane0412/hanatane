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
