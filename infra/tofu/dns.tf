# hanatane.net DNS レコード管理（Cloudflare provider v5）
#
# 全レコードは既存リソースを tofu import で取り込み済み。
# 変更前に必ず（tofu/ 内で実行）:
#   sops exec-env ../secrets/ghost.env -- sops exec-file origin.sops.tfvars 'tofu plan -var="zone_id=..." -var-file={}'
# origin の IP は origin.sops.tfvars（sops 暗号化）に置く。平文で dns.tf に書かないこと。
# Zone ID: f39970ba35adb2b88ce029c3f0e4d02a（docs/runbook.md にも記録）
#
# TXT records:
#   content フィールドは引用符なしで記述する（provider v5 の仕様）。
#   DNS レコードとして提供される際の引用符は Cloudflare が自動付与する。

# ---- apex（hanatane.net）----

resource "cloudflare_dns_record" "apex_a" {
  zone_id = var.zone_id
  name    = "hanatane.net"
  type    = "A"
  content = var.origin_ipv4
  proxied = true
  ttl     = 1
  comment = "ghostのcloudflare設定に対応"
}

resource "cloudflare_dns_record" "apex_aaaa" {
  zone_id = var.zone_id
  name    = "hanatane.net"
  type    = "AAAA"
  content = var.origin_ipv6
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "apex_txt_google_verification" {
  zone_id = var.zone_id
  name    = "hanatane.net"
  type    = "TXT"
  content = "google-site-verification=WXBu9DvkuBzeex81kC6rSFNnIauJC3UAMOPAlj66fYM"
  proxied = false
  ttl     = 3600
}

# ---- www ----

resource "cloudflare_dns_record" "www_cname" {
  zone_id = var.zone_id
  name    = "www"
  type    = "CNAME"
  content = "hanatane.net"
  proxied = true
  ttl     = 1
  comment = "ghostのcloudflare設定に対応"
}

# ---- Mailgun（mg.hanatane.net）----

resource "cloudflare_dns_record" "mg_mx_a" {
  zone_id  = var.zone_id
  name     = "mg.hanatane.net"
  type     = "MX"
  content  = "mxa.mailgun.org"
  priority = 10
  proxied  = false
  ttl      = 1
  comment  = "mailgun"
}

resource "cloudflare_dns_record" "mg_mx_b" {
  zone_id  = var.zone_id
  name     = "mg.hanatane.net"
  type     = "MX"
  content  = "mxb.mailgun.org"
  priority = 10
  proxied  = false
  ttl      = 1
  comment  = "mailgun"
}

resource "cloudflare_dns_record" "mg_txt_spf" {
  zone_id = var.zone_id
  name    = "mg.hanatane.net"
  type    = "TXT"
  content = "v=spf1 include:mailgun.org ~all"
  proxied = false
  ttl     = 1
  comment = "mailgun"
}

resource "cloudflare_dns_record" "mg_cname_email" {
  zone_id = var.zone_id
  name    = "email.mg.hanatane.net"
  type    = "CNAME"
  content = "mailgun.org"
  proxied = false
  ttl     = 1
  comment = "mailgun"
}

resource "cloudflare_dns_record" "mg_dkim_pdk1" {
  zone_id = var.zone_id
  name    = "pdk1._domainkey.mg.hanatane.net"
  type    = "CNAME"
  content = "pdk1._domainkey.323087.dkim1.us.mgsend.org"
  proxied = false
  ttl     = 1
  comment = "mailgun"
}

resource "cloudflare_dns_record" "mg_dkim_pdk2" {
  zone_id = var.zone_id
  name    = "pdk2._domainkey.mg.hanatane.net"
  type    = "CNAME"
  content = "pdk2._domainkey.323087.dkim1.us.mgsend.org"
  proxied = false
  ttl     = 1
  comment = "mailgun"
}

resource "cloudflare_dns_record" "mg_dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.mg.hanatane.net"
  type    = "TXT"
  content = "v=DMARC1; p=none; pct=100; fo=1; ri=3600; rua=mailto:19ab10e7@dmarc.mailgun.org,mailto:a76d6ee6@inbox.ondmarc.com; ruf=mailto:19ab10e7@dmarc.mailgun.org,mailto:a76d6ee6@inbox.ondmarc.com;"
  proxied = false
  ttl     = 1
  comment = "mailgun"
}
