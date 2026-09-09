# Cloudflare プロバイダ設定
#
# 認証は CLOUDFLARE_API_TOKEN 環境変数で行う。
# 実行方法（シークレットを環境に流す）:
#   sops exec-env ../secrets/ghost.env -- tofu plan
provider "cloudflare" {
  # api_token は CLOUDFLARE_API_TOKEN 環境変数から自動読み込み
}
