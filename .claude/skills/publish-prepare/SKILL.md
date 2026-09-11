---
name: publish-prepare
description: hanatane.net の下書きを公開する前に、研究者（Claude Code）が slug・excerpt・tags を整える。ユーザーが「公開の準備をして」「slug と excerpt を整えて」「タグを付けて」「公開して」と言ったとき、ghost-posts スキルで公開する直前に使う。判断は Claude Code が行い、posts/tags.json の統制語彙を使う。
---

# 公開前の整備（slug・excerpt・tags）

背景と形式の詳細は `posts/README.md` の「公開前の整備」を参照すること。著者は書くことに集中し、slug・excerpt・tags は研究者（Claude Code）が公開前に整える。本文には手を入れない。整備は下書きのうちに行う（slug は公開後に変えられない）。

## 手順（1 記事）

1. `pnpm --filter ./posts pull --slug <slug>` で Ghost の最新を取り込む（Ghost エディタで書かれた下書きは、この時点の slug が日本語タイトルの中国語読みになっている）。
2. `pnpm --filter ./posts strata text <slug>` で本文を読む。
3. `pnpm --filter ./posts curate tags` で統制語彙（`posts/tags.json`）を、記事での使用数とともに見る。
4. 下記の基準で slug・excerpt・tags を決める。
5. slug を変えるときは `pnpm --filter ./posts curate rename <slug> <新しい slug>`（Ghost 側を変え、`content/` を取り込み直す）。
6. `posts/content/<新しい slug>.post.json` の `excerpt` と `tags` を書き換える（`#ref-*` など `#` で始まる内部タグは残す）。
7. `pnpm --filter ./posts push content/<新しい slug>.post.json` で Ghost に反映する。
8. `pnpm --filter ./posts curate check <新しい slug>` で基準を満たしていることを確認する。
9. 決めた slug・excerpt・tags と、その理由を 1 行ずつユーザーに示す。公開は `ghost-posts` スキルの「公開する」に従い、ユーザーの明示的な依頼があるときだけ行う。
10. `content/` の `.post.json` と（語彙を変えたときは）`posts/tags.json` を feature ブランチでコミットし、PR にする（main 直接コミット禁止）。

## slug の基準（変えない。変えるときはこのファイルと posts/README.md を更新する）

- 形式は `YYYYMMDD-<英語の題材>`（例: `20260910-hyperstrata-design`）。`curate check` が検査する。
- 日付は公開予定日（JST）。公開日が未定なら整備した日。
- 題材は英小文字 2〜4 語をハイフンでつなぐ。固有名詞はそのまま（`hyperstrata`、`sigma-fp`）。記事の主題が一目で分かる語を選び、`post` `article` `about` のような意味の無い語は入れない。
- 同じ話題が繰り返されることを前提にしているので、題材が過去記事と同じでもよい（日付で区別する）。
- 既存記事（日付の無い slug）は変えない。URL と Hyperstrata の関係（`posts/strata/`、`#ref-*`）の主キーになっている。

## excerpt の基準（変えない。変えるときはこのファイルと posts/README.md を更新する）

- 140 字以内。`curate check` が検査する。
- 「A、B、C について話しました。」のように、話した題材を 2〜4 個並べる Podcast の概要のような 1〜2 文。
- 記事の結論や感想は入れない（結論まで書く要約は `strata-annotate` の `summary` の役割）。
- テーマでは記事一覧のカードと、記事ページの題名の直下（`theme/post.hbs`）の両方に表示される。副題として読んでも不自然でない文にする。

## tags の基準（変えない。変えるときはこのファイルと posts/README.md を更新する）

- `posts/tags.json` の統制語彙から 1〜3 個選ぶ。記事の主題を表すもの 1 個を必ず付け、`description` に「併用する」とあるタグは主題のタグと一緒に付ける。
- 語彙に無いタグは付けない。`curate check` と `curate tags check`（CI と pre-commit hook）が検査する。
- `#` で始まる内部タグ（`#ref-*`、`#Import ...`）は `hyperstrata-sync` などが付けるもので、消さない・付けない。

## 統制語彙を育てる

タグは記事全体をどう分類できるかの表明であり、記事が積もるにつれて変わってよい。研究者は次のときに語彙を見直す。

- 整備中の記事に合うタグが語彙に無いとき。新しいタグを `posts/tags.json` に足す（`name` は日本語または固有名詞、`slug` は英小文字・数字・ハイフン、`description` は「どんな記事に付けるか」）。1 記事にしか付かないタグを安易に増やさず、既存のタグで表せないか先に考える。
- 語彙の見直しをユーザーに頼まれたとき。`curate tags` の使用数を見て、統合・分割・改名・削除を提案する。既存記事のタグを付け替えるときは、対象記事を `pull` → `.post.json` の `tags` を編集 → `push` で反映し、`curate tags check` を通す。
- 語彙を変えたら `pnpm --filter ./posts curate tags sync --dry-run` で Ghost との差分を確認し、`--dry-run` なしで Ghost のタグを作成・slug 変更する。語彙から外したタグは Ghost に残るので、使われていなければユーザーに削除を提案する（`ghst tag delete` は destructive なので自分では実行しない）。

## 禁止・注意

- 本文（`lexical`）を編集しない。
- 公開済み記事の slug を変えない（`curate rename` も拒む）。
- `pnpm ghst post publish` や `status: published` の push は、ユーザーが明示的に公開を依頼したときだけ行う。
- push は `tags` をファイルの内容で置き換える。編集前に必ず pull し、`#ref-*` を落とさない。
