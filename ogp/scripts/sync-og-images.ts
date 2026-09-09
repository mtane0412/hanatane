/**
 * OGP 画像の事前生成スクリプト（GitHub Actions / ローカルから実行）
 *
 * 環境変数:
 *   GHOST_ADMIN_API_URL - サイト URL（例: https://hanatane.net）
 *   GHOST_ADMIN_API_KEY - Admin API キー（<id>:<secret>）
 * 引数:
 *   --dry-run - 対象記事を表示するだけで何も書き換えない
 *
 * 実行例: npx tsx scripts/sync-og-images.ts --dry-run
 */

import { renderOgpPng } from "@/og/render";
import { loadResourcesFromDisk } from "@/og/resources-node";
import { createGhostAdminClient } from "@/og/sync/ghost-admin";
import { syncOgImages } from "@/og/sync/run";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`環境変数 ${name} が設定されていません`);
	}
	return value;
}

const dryRun = process.argv.includes("--dry-run");
const client = createGhostAdminClient({
	adminUrl: requireEnv("GHOST_ADMIN_API_URL"),
	apiKey: requireEnv("GHOST_ADMIN_API_KEY"),
});
const resources = await loadResourcesFromDisk();

const result = await syncOgImages({
	client,
	render: (params) => renderOgpPng(params, resources),
	dryRun,
	log: (message) => console.log(message),
});
console.log(`完了: 対象 ${result.planned.length} 件、更新 ${result.updated.length} 件`);
