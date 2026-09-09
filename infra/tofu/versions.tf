# OpenTofu / プロバイダバージョン固定
#
# Cloudflare provider v5 は v4 から破壊的変更あり（リソース名・属性名が変更）
# 詳細: https://github.com/cloudflare/terraform-provider-cloudflare/blob/main/docs/guides/version-5-migration.md
terraform {
  required_version = ">= 1.12.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
