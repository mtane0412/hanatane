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
 *   3. 同じ slug の Markdown（content/<slug>.md、content/private/<slug>.md）がある記事は、Markdown 側を正とみなしてスキップする
 *   4. lexical を持たない記事（旧 mobiledoc 形式）は取り込めないため、slug を表示してスキップする
 *   5. visibility が members / paid の限定記事は content/private/<slug>.post.json に sops で暗号化して書く
 *      （src/private-post.ts、src/sops.ts）。平文は一切ディスクに残さない
 *   6. visibility が変わった記事は反対側に残った古い .post.json を削除する
 *
 * 注意:
 *   - 既存の .post.json は上書きする。ローカルで編集中の内容がある場合は先にコミットしておくこと
 *   - 限定記事を復号したまま（<slug>.plain.post.json が残ったまま）だとエラーで止まる
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
import { toPostJson } from "../src/post-json";
import {
	contentRelativePath,
	isPrivateVisibility,
	PLAIN_POST_JSON_SUFFIX,
	PRIVATE_DIR,
	staleContentPaths,
} from "../src/private-post";
import { decryptPostJson, encryptPostJson } from "../src/sops";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../content");
const PRIVATE_CONTENT_DIR = path.join(CONTENT_DIR, PRIVATE_DIR);

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
	let unchanged = 0;
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
		const { slug: postSlug, visibility } = postJson;
		if (
			existsSync(path.join(CONTENT_DIR, `${postSlug}.md`)) ||
			existsSync(path.join(PRIVATE_CONTENT_DIR, `${postSlug}.md`))
		) {
			console.log(`スキップ（Markdown 管理）: ${postSlug}`);
			skipped += 1;
			continue;
		}
		// 復号したまま編集中の平文があれば、上書きで編集内容を失わないよう止める
		const plainPath = path.join(
			PRIVATE_CONTENT_DIR,
			`${postSlug}${PLAIN_POST_JSON_SUFFIX}`,
		);
		if (existsSync(plainPath)) {
			throw new Error(
				`編集中の平文ファイルがあります。\`pnpm private encrypt ${postSlug}\` で戻すか削除してから pull してください: ${plainPath}`,
			);
		}

		const relativePath = contentRelativePath(postSlug, visibility);
		const filePath = path.join(CONTENT_DIR, relativePath);
		const plainJson = `${JSON.stringify(postJson, null, "\t")}\n`;
		if (isPrivateVisibility(visibility)) {
			// 限定記事は平文をディスクに残さず、sops で暗号化した内容だけを書く。
			// sops は毎回異なる暗号文を出すため、内容が変わっていなければ書き換えない（無駄な diff を避ける）
			mkdirSync(PRIVATE_CONTENT_DIR, { recursive: true });
			if (
				existsSync(filePath) &&
				JSON.stringify(JSON.parse(decryptPostJson(filePath))) ===
					JSON.stringify(postJson)
			) {
				unchanged += 1;
			} else {
				writeFileSync(
					filePath,
					encryptPostJson(plainJson, relativePath),
					"utf8",
				);
				written += 1;
			}
		} else {
			writeFileSync(filePath, plainJson, "utf8");
			written += 1;
		}
		// visibility が変わった記事は、反対側（公開 ⇔ 限定）に残った古いファイルを消して二重管理を防ぐ
		for (const stale of staleContentPaths(postSlug, visibility)) {
			const stalePath = path.join(CONTENT_DIR, stale);
			if (existsSync(stalePath)) {
				rmSync(stalePath);
				console.log(
					`削除（visibility が ${visibility} に変わったため）: ${stale}`,
				);
			}
		}
	}
	console.log(
		`完了: 取得 ${posts.length} 件、書き出し ${written} 件、変更なし（限定記事）${unchanged} 件、スキップ ${skipped} 件`,
	);
}

main();
