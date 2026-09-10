/**
 * 記事ファイルを ghst 経由で Ghost に反映するスクリプト
 *
 * 使い方:
 *   pnpm push content/<slug>.md [--dry-run]           # Markdown（frontmatter 付き）
 *   pnpm push content/<slug>.post.json [--dry-run]    # Lexical JSON（pull で取得した既存記事）
 *
 * 処理内容:
 *   1. 拡張子に応じてファイルを解析し、メタ情報と本文に分ける（src/post-file.ts, src/post-json.ts）
 *   2. `ghst post update --slug <slug>` で既存記事の更新を試みる
 *   3. 記事が存在しない（終了コード 5）場合は `ghst post create` で新規作成する
 *
 * 注意:
 *   - 認証は ghst の設定（`ghst auth login` で登録したサイト、または GHOST_URL / GHOST_STAFF_ACCESS_TOKEN）に従う
 *   - --dry-run は ghst を実行せず、実行予定のコマンドだけを表示する
 *   - tags はファイルの内容で置き換わるため、Ghost 側で後から付いたタグ（hyperstrata-sync の #ref-* など）を
 *     落とさないよう、編集前に pull しておくこと
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildGhstArgs,
	type ContentSource,
	type PostMeta,
	parsePostFile,
} from "../src/post-file";
import { POST_JSON_SUFFIX, parsePostJson } from "../src/post-json";

/** ghst の終了コード。README の Exit code mapping に対応する */
const GHST_EXIT_NOT_FOUND = 5;

interface Prepared {
	meta: PostMeta;
	source: ContentSource;
	stdin: string;
	/** create 時に --from-json で渡す `{ "slug": ... }` ファイル */
	slugJsonPath: string;
	cleanup: () => void;
}

/** ファイルの種類に応じて、ghst に渡す本文とメタ情報の一時ファイルを用意する */
function prepare(filePath: string): Prepared {
	const fileName = path.basename(filePath);
	const content = readFileSync(filePath, "utf8");
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-posts-"));
	const cleanup = () => rmSync(tempDir, { recursive: true, force: true });

	let meta: PostMeta;
	let source: ContentSource;
	let stdin = "";
	if (fileName.endsWith(POST_JSON_SUFFIX)) {
		const parsed = parsePostJson(content, fileName);
		meta = parsed.meta;
		const lexicalPath = path.join(tempDir, "lexical.json");
		writeFileSync(lexicalPath, parsed.lexical, "utf8");
		source = { kind: "lexical-file", path: lexicalPath };
	} else {
		const parsed = parsePostFile(content, fileName);
		meta = parsed.meta;
		stdin = parsed.body;
		source = { kind: "markdown-stdin" };
	}

	const slugJsonPath = path.join(tempDir, "slug.json");
	writeFileSync(slugJsonPath, JSON.stringify({ slug: meta.slug }), "utf8");
	return { meta, source, stdin, slugJsonPath, cleanup };
}

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
		console.error(
			"使い方: pnpm push content/<slug>.md|<slug>.post.json [--dry-run]",
		);
		process.exit(2);
	}

	const { meta, source, stdin, slugJsonPath, cleanup } = prepare(filePath);
	try {
		const updateArgs = buildGhstArgs("update", meta, source);
		const createArgs = buildGhstArgs("create", meta, source, slugJsonPath);
		if (dryRun) {
			console.log(`[dry-run] ghst ${updateArgs.join(" ")}`);
			console.log(`[dry-run] 記事が無ければ: ghst ${createArgs.join(" ")}`);
			return;
		}

		const updateStatus = runGhst(updateArgs, stdin);
		if (updateStatus === 0) {
			console.log(`更新しました: ${meta.slug}`);
			return;
		}
		if (updateStatus !== GHST_EXIT_NOT_FOUND) {
			process.exit(updateStatus);
		}

		const createStatus = runGhst(createArgs, stdin);
		if (createStatus !== 0) {
			process.exit(createStatus);
		}
		console.log(`作成しました: ${meta.slug}`);
	} finally {
		cleanup();
	}
}

main();
