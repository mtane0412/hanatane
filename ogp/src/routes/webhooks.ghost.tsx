/**
 * Ghost Webhook 受け口（サーバールート）
 *
 * `POST /webhooks/ghost?token=...` で Ghost の `post.published` イベントを受け取り、
 * GitHub の repository_dispatch に中継します。処理本体は `@/webhooks/ghost-dispatch` を参照。
 *
 * 必要な設定（wrangler.jsonc の vars と `wrangler secret put`）:
 * - GITHUB_REPOSITORY: `owner/repo`（vars）
 * - GITHUB_DISPATCH_TOKEN: repository_dispatch を送れる GitHub トークン（secret）
 * - GHOST_WEBHOOK_TOKEN: Ghost の送信先 URL に付ける token（secret）
 */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { handleGhostWebhook } from "@/webhooks/ghost-dispatch";

/**
 * 環境変数を 1 つ取り出す
 *
 * @throws 未設定の場合（設定ミスを 500 として表面化させる）
 */
function requireEnv(name: keyof Env): string {
	const value = env[name];
	if (typeof value !== "string" || value === "") {
		throw new Error(`環境変数 ${name} が設定されていません`);
	}
	return value;
}

export const Route = createFileRoute("/webhooks/ghost")({
	server: {
		handlers: {
			POST: ({ request }) =>
				handleGhostWebhook(request, {
					webhookToken: requireEnv("GHOST_WEBHOOK_TOKEN"),
					githubToken: requireEnv("GITHUB_DISPATCH_TOKEN"),
					githubRepository: requireEnv("GITHUB_REPOSITORY"),
				}),
		},
	},
});
