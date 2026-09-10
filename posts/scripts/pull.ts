/**
 * Ghost の記事を `content/<slug>.post.json`（Lexical JSON）としてリポジトリに取り込むスクリプト
 *
 * 使い方:
 *   pnpm pull                 # 全記事
 *   pnpm pull --slug <slug>   # 1 記事だけ
 *
 * 処理内容:
 *   1. `ghst post list --limit all --json`（または `post get --slug`）で記事を取得する
 *   2. src/post-json.ts で push に必要な項目と lexical だけに絞り、content/<slug>.post.json に書き出す
 *   3. 同じ slug の Markdown（content/<slug>.md）がある記事は、Markdown 側を正とみなしてスキップする
 *   4. lexical を持たない記事（旧 mobiledoc 形式）は取り込めないため、slug を表示してスキップする
 *
 * 注意:
 *   - 既存の .post.json は上書きする。ローカルで編集中の内容がある場合は先にコミットしておくこと
 *   - ghst は stdout がパイプだと 64KB 付近で出力が途切れる（書き込み完了前に終了する）ため、
 *     stdout は一時ファイルに書かせてから読み込む
 */
import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST_JSON_SUFFIX, toPostJson } from "../src/post-json";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../content");

function fetchPosts(slug: string | undefined): Record<string, unknown>[] {
	const args = slug
		? ["post", "get", "--slug", slug, "--json"]
		: ["post", "list", "--limit", "all", "--json"];
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-posts-pull-"));
	const outputPath = path.join(tempDir, "posts.json");
	let stdout: string;
	try {
		const fd = openSync(outputPath, "w");
		let result: ReturnType<typeof spawnSync>;
		try {
			result = spawnSync("ghst", args, { stdio: ["ignore", fd, "inherit"] });
		} finally {
			closeSync(fd);
		}
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
		stdout = readFileSync(outputPath, "utf8");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
	const payload = JSON.parse(stdout) as { posts?: unknown };
	if (!Array.isArray(payload.posts)) {
		throw new Error("ghst の出力に posts 配列がありません");
	}
	return payload.posts as Record<string, unknown>[];
}

function main(): void {
	const argv = process.argv.slice(2);
	const slugIndex = argv.indexOf("--slug");
	const slug = slugIndex >= 0 ? argv[slugIndex + 1] : undefined;
	if (slugIndex >= 0 && !slug) {
		console.error("使い方: pnpm pull [--slug <slug>]");
		process.exit(2);
	}

	mkdirSync(CONTENT_DIR, { recursive: true });
	const posts = fetchPosts(slug);
	let written = 0;
	let skipped = 0;
	for (const post of posts) {
		if (typeof post.lexical !== "string") {
			console.log(
				`スキップ（lexical が無い旧形式。Ghost エディタで一度保存すると変換される）: ${String(post.slug)}`,
			);
			skipped += 1;
			continue;
		}
		const postJson = toPostJson(post);
		if (existsSync(path.join(CONTENT_DIR, `${postJson.slug}.md`))) {
			console.log(`スキップ（Markdown 管理）: ${postJson.slug}`);
			skipped += 1;
			continue;
		}
		const filePath = path.join(
			CONTENT_DIR,
			`${postJson.slug}${POST_JSON_SUFFIX}`,
		);
		writeFileSync(
			filePath,
			`${JSON.stringify(postJson, null, "\t")}\n`,
			"utf8",
		);
		written += 1;
	}
	console.log(
		`完了: 取得 ${posts.length} 件、書き出し ${written} 件、スキップ ${skipped} 件`,
	);
}

main();
