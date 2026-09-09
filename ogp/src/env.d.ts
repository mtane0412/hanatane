/**
 * Worker の環境変数・secret の型定義（手書き）
 *
 * `wrangler types` が生成する worker-configuration.d.ts には secret が含まれないため、
 * Ghost Webhook 中継（src/routes/webhooks.ghost.tsx）で使う項目をここで補います。
 * vars は wrangler.jsonc、secret は `wrangler secret put` で設定します。
 */

declare namespace Cloudflare {
	interface Env {
		/** repository_dispatch の送信先（`owner/repo`、wrangler.jsonc の vars） */
		GITHUB_REPOSITORY: string;
		/** repository_dispatch を送れる GitHub トークン（secret） */
		GITHUB_DISPATCH_TOKEN: string;
		/** Ghost の Webhook 送信先 URL に付ける token（secret） */
		GHOST_WEBHOOK_TOKEN: string;
	}
}
