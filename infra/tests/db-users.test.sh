#!/usr/bin/env bash
# db-users.test.sh
#
# 目的:
#   ansible/templates/db-users.sql.j2（アプリ専用 MySQL ユーザーの作成 SQL）を、
#   使い捨ての mysql:8.0 コンテナに適用して次を確かめる。
#     1. 2 回適用しても失敗しない（冪等）
#     2. ghost ユーザーは ghost DB だけ、activitypub ユーザーは activitypub DB だけを操作できる
#     3. パスワードを変えて再適用すると新しいパスワードに切り替わる
#
# 使い方（infra/ で実行）:
#   tests/db-users.test.sh sakura
#   引数は Docker が使える SSH ホスト。テスト用コンテナはそのホスト上で起動し、終了時に削除する。
#
# 注意:
#   本番の db コンテナ・ボリュームには触れない。テスト用のパスワードはダミー値を使う。

set -euo pipefail

host="${1:?SSH ホストを指定してください（例: sakura）}"
container="db-users-test-$$"
work="$(mktemp -d)"

# SSH 接続を 1 本に多重化する（接続回数を抑え、sshd 側の ufw limit による遮断を避ける）
ssh_opts=(-o ControlMaster=auto -o ControlPath="/tmp/db-users-test-%C" -o ControlPersist=120)
remote() { ssh "${ssh_opts[@]}" "$host" "$@"; }
trap 'remote "docker rm -f $container >/dev/null 2>&1 || true"; ssh "${ssh_opts[@]}" -O exit "$host" 2>/dev/null; rm -rf "$work"' EXIT

# テンプレートを展開する（パスワードはテスト用のダミー値）
render() {
  ansible localhost -c local -m ansible.builtin.template \
    -a "src=ansible/templates/db-users.sql.j2 dest=$work/$1" \
    -e "{\"ghost_activitypub_enabled\": true, \"ghost_secrets\": {\"GHOST_DB_PASSWORD\": \"$2\", \"ACTIVITYPUB_DB_PASSWORD\": \"$3\"}}" \
    >/dev/null
}
render first.sql ghosttestpass1 aptestpass1
render second.sql ghosttestpass2 aptestpass2

remote "docker run -d --name $container -e MYSQL_ROOT_PASSWORD=roottestpass mysql:8.0 >/dev/null"
# MySQL の起動を最大 120 秒待つ（待機はリモート側のループで行い、SSH 接続を増やさない）
remote "for i in \$(seq 1 60); do docker exec $container mysql -h 127.0.0.1 -uroot -proottestpass -e 'SELECT 1' >/dev/null 2>&1 && exit 0; sleep 2; done; echo 'MySQL が起動しませんでした' >&2; exit 1"

# root で SQL を適用する
apply() { remote "docker exec -i $container mysql -uroot -proottestpass" < "$work/$1" 2>/dev/null; }
# 指定ユーザーで SQL を実行し、成功なら ok、失敗なら denied を出力する
try_sql() {
  if remote "docker exec $container mysql -u$1 -p$2 -e \"$3\"" >/dev/null 2>&1; then echo ok; else echo denied; fi
}

failures=0
expect() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name（期待: $want / 実際: $got）"
    failures=$((failures + 1))
  fi
}

rc=0; apply first.sql || rc=$?
expect "1 回目の適用が成功する" 0 "$rc"
rc=0; apply first.sql || rc=$?
expect "2 回目の適用も成功する（冪等）" 0 "$rc"

expect "ghost は ghost DB にテーブルを作れる" ok "$(try_sql ghost ghosttestpass1 'CREATE TABLE ghost.t (id INT)')"
expect "ghost は activitypub DB を読めない" denied "$(try_sql ghost ghosttestpass1 'SHOW TABLES FROM activitypub')"
expect "activitypub は activitypub DB にテーブルを作れる" ok "$(try_sql activitypub aptestpass1 'CREATE TABLE activitypub.t (id INT)')"
expect "activitypub は ghost DB を読めない" denied "$(try_sql activitypub aptestpass1 'SELECT * FROM ghost.t')"
expect "ghost は mysql.user を読めない" denied "$(try_sql ghost ghosttestpass1 'SELECT user FROM mysql.user')"

rc=0; apply second.sql || rc=$?
expect "パスワード変更後の再適用が成功する" 0 "$rc"
expect "ghost は新しいパスワードで接続できる" ok "$(try_sql ghost ghosttestpass2 'SELECT 1')"
expect "ghost は古いパスワードでは接続できない" denied "$(try_sql ghost ghosttestpass1 'SELECT 1')"

if [ "$failures" -gt 0 ]; then
  echo "$failures 件失敗しました"
  exit 1
fi
echo "すべて成功しました"
