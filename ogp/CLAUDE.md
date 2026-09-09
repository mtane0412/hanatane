# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

このディレクトリは hanatane モノレポの `ogp/` パッケージです（依存はリポジトリルートで `pnpm install`）。TanStack Start（React Router + SSR）とCloudflare Workersを組み合わせたフルスタックReactアプリケーションです。

## 開発コマンド

### 基本コマンド
```bash
pnpm dev             # 開発サーバー起動（ポート3000）
pnpm build           # プロダクションビルド
pnpm preview         # プロダクションビルドのプレビュー
pnpm deploy          # Cloudflare Workersへデプロイ
```

### テスト・品質管理
```bash
pnpm test            # Vitestでテスト実行
pnpm lint            # Biomeでリント実行
pnpm format          # Biomeでフォーマット実行
pnpm check           # Biomeでリント+フォーマットチェック
```

### 単一テストの実行
```bash
pnpm exec vitest run <test-file-name>
```

## アーキテクチャ

### ルーティングシステム（TanStack Router）

**ファイルベースルーティング**を採用しています。ルートファイルは `src/routes/` ディレクトリに配置され、TanStack Routerが自動的に `src/routeTree.gen.ts` を生成します。

- ルートレイアウト: `src/routes/__root.tsx` - すべてのルートに共通のレイアウト（Header、devtools、Scripts）を定義
- ルート定義: `src/router.tsx` - ルーターインスタンスを作成する `getRouter()` 関数をエクスポート
- ルート追加方法: `src/routes/` に新規ファイルを作成すると自動的にルートとして認識される

### SSRとレンダリングモード

TanStack Startは複数のレンダリングモードをサポートしています：
- **Full SSR**: サーバーサイドでHTMLを完全にレンダリング
- **Data-only SSR**: データのみをサーバーで取得し、クライアントでレンダリング
- **SPA mode**: 完全にクライアントサイドでレンダリング

デモファイル（`src/routes/demo/start.ssr.*`）に各モードの実装例があります。

### デプロイターゲット（Cloudflare Workers）

- デプロイ設定: `wrangler.jsonc` - Cloudflare Workers向けの設定
- Viteプラグイン: `@cloudflare/vite-plugin` を使用してSSR環境を構築
- エントリーポイント: `@tanstack/react-start/server-entry` がサーバーエントリーポイントとして自動的に使用される

### パスエイリアス

`tsconfig.json` で `@/*` を `./src/*` にマッピングしています。インポート時は以下のように使用します：
```tsx
import Header from '@/components/Header'
```

## コーディング規約

### Biome設定（biome.json）

- **インデント**: タブ（`indentStyle: "tab"`）
- **クォート**: ダブルクォート（`quoteStyle: "double"`）
- **対象ファイル**: `src/**/*`、`.vscode/**/*`、`index.html`、`vite.config.js`
- **除外ファイル**: `src/routeTree.gen.ts`（自動生成）、`src/styles.css`

### コード修正時の必須手順

1. コード変更後は必ず `pnpm lint` を実行してエラー・警告をクリアする
2. テストが存在する場合は `pnpm test` を実行して全テストがパスすることを確認する

## デモファイルについて

`demo` プレフィックスが付いたファイル（`src/routes/demo/*`、`src/data/demo.punk-songs.ts`）は、学習用のサンプルファイルです。削除しても問題ありません。

## スタイリング

Tailwind CSS v4を使用しています。Viteプラグイン（`@tailwindcss/vite`）によってビルド時に自動的に処理されます。

## OGP 画像生成エンドポイント（`/og`）

`GET /og?title=...&site=...&author=...&gradient=...` で 1200x630 の PNG を返すサーバールートです。Ghost テーマ側から `og:image` として参照する用途を想定しています。

- ルート: `src/routes/og.tsx`（`createFileRoute` の `server.handlers.GET`）
- パラメータ解析: `src/og/params.ts`（`title` 必須、`gradient` は `src/types/ogp.ts` のプリセット名のみ受け付け、不正値は 400）
- レンダリング: `src/og/render.tsx`（Satori で JSX → SVG、resvg で SVG → PNG）、レイアウトは `src/og/layout.tsx`
- フォント: `public/fonts/LINESeedJP_OTF_Bd.otf`（Satori は woff2 を読めないため OTF を使用）。Workers では `ASSETS` バインディング経由で取得し、モジュール単位でキャッシュする
- wasm: Cloudflare Workers では実行時バイト列から wasm をコンパイルできないため、`satori/yoga.wasm` と `@resvg/resvg-wasm/index_bg.wasm` を素インポートして `WebAssembly.Module` として渡す（型宣言は `src/wasm.d.ts`）

### 依存バージョンの固定理由

- `satori` は **0.32.0 に固定**しています。0.33.0 以降は harfbuzzjs に依存し、Workers 上で `self.location` 参照と実行時 wasm コンパイルにより起動時に失敗します。更新する場合は `pnpm build && pnpm preview` で `/og` が 200 を返すことを確認してください
- `tsconfig.json` に `baseUrl` を設定しないでください。設定すると vite-tsconfig-paths が `@resvg/...` のような bare import をプロジェクト直下の相対パスとして解決しようとし、Cloudflare プラグインの `.wasm` 解決が失敗します

### テスト

`vitest.config.ts` は `vite.config.ts` と分離しています（Cloudflare / TanStack Start プラグインを Node のテストに読み込まないため）。`src/og/render.test.tsx` は実フォントと実 wasm をディスクから読み込んで PNG を生成する結合テストです。

## OGP 画像の事前生成（`scripts/sync-og-images.ts`）

`/og` の実行時レンダリングは Workers 無料プランの CPU 上限（10ms）を超えるため、本番運用は事前生成方式です。GitHub Actions（リポジトリルートの `.github/workflows/sync-og-images.yml`、15 分おき + 手動）が Ghost Admin API で「公開済み・feature_image なし・og_image なし」の記事を取得し、PNG を生成して images/upload にアップロードし、記事の `og_image` に設定します。`ghost_head` は `og_image` を最優先で使うため、テーマ側の変更は不要です。

- 対象選定・配色決定: `src/og/sync/plan.ts`（slug の FNV-1a ハッシュでグラデーションを決定的に選ぶ）
- Admin API クライアント: `src/og/sync/ghost-admin.ts`（JWT 生成、記事取得、画像アップロード、og_image 更新）
- 実行フロー: `src/og/sync/run.ts`（失敗時は例外で停止し、暗黙にスキップしない）
- Node 用資源ローダー: `src/og/resources-node.ts`
- 必要な Secrets: `GHOST_ADMIN_API_URL`、`GHOST_ADMIN_API_KEY`（deploy-theme と共通）
- ローカル実行: `GHOST_ADMIN_API_URL=... GHOST_ADMIN_API_KEY=... pnpm sync:og -- --dry-run`

## Ghost Webhook 中継（`/webhooks/ghost`）

公開直後に cron を待たず事前生成を走らせるため、Ghost の `post.published` Webhook をこの Worker で受け、GitHub の `repository_dispatch`（event_type: `ghost-post-published`）に中継します。Ghost の Webhook は任意ヘッダーを付けられないため GitHub を直接叩けず、また管理画面では署名 secret を指定できないため、送信先 URL のクエリ `token` で認証します。

- ルート: `src/routes/webhooks.ghost.tsx`（`POST /webhooks/ghost?token=...`）
- 処理本体: `src/webhooks/ghost-dispatch.ts`（token を定数時間比較、`post.current` を検証、feature_image あり・未公開なら dispatch せず 200、GitHub が 204 以外なら 502）
- 設定: `wrangler.jsonc` の vars `GITHUB_REPOSITORY`、secret `GITHUB_DISPATCH_TOKEN`（`wrangler secret put`、repository_dispatch を送れる fine-grained PAT で Contents: Read and write）、secret `GHOST_WEBHOOK_TOKEN`（任意のランダム文字列）。型は `src/env.d.ts`
- Ghost 側: Settings > Integrations > Custom integration に Webhook を追加し、Event を `Post published`、Target URL を `https://<worker>/webhooks/ghost?token=<GHOST_WEBHOOK_TOKEN>` にする
- `og_image` の書き込みは `post.published.edited` であり `post.published` は再発火しないためループしない。仮に再発火しても Admin API のフィルタで対象ゼロになる
