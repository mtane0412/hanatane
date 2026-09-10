/**
 * 記事 Markdown ファイルを ghst 経由で Ghost に反映するスクリプト
 *
 * 使い方:
 *   pnpm push content/<slug>.md [--dry-run]
 *
 * 処理内容:
 *   1. frontmatter を解析してメタ情報と本文に分ける（src/post-file.ts）
 *   2. `ghst post update --slug <slug>` で既存記事の更新を試みる
 *   3. 記事が存在しない（終了コード 5）場合は `ghst post create` で新規作成する
 *
 * 注意:
 *   - 認証は ghst の設定（`ghst auth login` で登録したサイト、または GHOST_URL / GHOST_STAFF_ACCESS_TOKEN）に従う
 *   - --dry-run は ghst を実行せず、実行予定のコマンドだけを表示する
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildGhstArgs, parsePostFile } from "../src/post-file";

/** ghst の終了コード。README の Exit code mapping に対応する */
const GHST_EXIT_NOT_FOUND = 5;

function runGhst(args: string[], stdin: string): number {
	const result = spawnSync("ghst", [...args, "--json"], {
		input: stdin,
		stdio: ["pipe", "inherit", "inherit"],
		encoding: "utf8",
	});
	if (result.error) {
		throw result.error;
	}
	return result.status ?? 1;
}

function main(): void {
	const positional = process.argv
		.slice(2)
		.filter((arg) => !arg.startsWith("--"));
	const dryRun = process.argv.includes("--dry-run");
	const filePath = positional[0];
	if (!filePath) {
		console.error("使い方: pnpm push content/<slug>.md [--dry-run]");
		process.exit(2);
	}

	const content = readFileSync(filePath, "utf8");
	const { meta, body } = parsePostFile(content, path.basename(filePath));

	const updateArgs = buildGhstArgs("update", meta);
	const createArgs = buildGhstArgs("create", meta);
	if (dryRun) {
		console.log(`[dry-run] ghst ${updateArgs.join(" ")}`);
		console.log(`[dry-run] 記事が無ければ: ghst ${createArgs.join(" ")}`);
		return;
	}

	const updateStatus = runGhst(updateArgs, body);
	if (updateStatus === 0) {
		console.log(`更新しました: ${meta.slug}`);
		return;
	}
	if (updateStatus !== GHST_EXIT_NOT_FOUND) {
		process.exit(updateStatus);
	}

	const createStatus = runGhst(createArgs, body);
	if (createStatus !== 0) {
		process.exit(createStatus);
	}
	console.log(`作成しました: ${meta.slug}`);
}

main();
