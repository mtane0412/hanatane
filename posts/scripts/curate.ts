/**
 * 公開前の整備（研究者が slug・excerpt・tags を整える工程）を支えるスクリプト
 *
 * 判断そのもの（どのタグを選ぶか、どんな要約を書くか、slug の題材）は Claude Code のセッションが
 * .claude/skills/publish-prepare に従って行う。このスクリプトはその前後の決定的な処理だけを担当する。
 *
 * 使い方:
 *   pnpm curate tags                       # 統制語彙（tags.json）を、記事での使用数とともに一覧する
 *   pnpm curate tags check                 # すべての記事のタグが統制語彙にあるかを検査する（CI と pre-commit hook）
 *   pnpm curate tags sync [--dry-run]      # 統制語彙に合わせて Ghost のタグを作成・slug 変更する
 *   pnpm curate check <slug>               # 下書きが公開の基準（slug 形式・excerpt・タグ）を満たすかを検査する
 *   pnpm curate rename <old> <new>         # 下書きの slug を変更し、content/ のファイルを pull し直す
 *
 * 注意:
 *   - 記事一覧は content/**\/*.post.json の平文メタ情報から作る。整備の前に `pnpm pull --slug <slug>` で最新にすること
 *   - rename は下書きにだけ使える。公開済み記事の slug は URL と Hyperstrata の主キーなので変えない
 *   - rename は Ghost 側を先に変え、その後 content/ の古いファイルを消して `pnpm pull --slug <new>` で取り込み直す
 *   - ghst の stdout はパイプだと 64KB 付近で途切れるため、JSON 出力は一時ファイルに書かせてから読む
 */
import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	checkNewSlug,
	checkPostTags,
	checkPublishReadiness,
	type GhostTag,
	parseTagVocabulary,
	planTagSync,
	TAG_VOCABULARY_FILE,
	type TagVocabularyEntry,
} from "../src/curate";
import { POST_JSON_SUFFIX } from "../src/post-json";
import { PRIVATE_DIR } from "../src/private-post";
import { type PublishedPost, STRATA_DIR, STRATA_SUFFIX } from "../src/strata";
import { loadPosts } from "./lib/load-posts";

/** ghst の終了コード。README の Exit code mapping に対応する */
const GHST_EXIT_NOT_FOUND = 5;
const POSTS_DIR = path.resolve(import.meta.dirname, "..");
const CONTENT_DIR = path.join(POSTS_DIR, "content");
const VOCABULARY_PATH = path.join(POSTS_DIR, TAG_VOCABULARY_FILE);

function usage(): never {
	console.error(
		"使い方: pnpm curate tags [check | sync [--dry-run]] | check <slug> | rename <old-slug> <new-slug>",
	);
	process.exit(2);
}

function loadVocabulary(): TagVocabularyEntry[] {
	return parseTagVocabulary(
		readFileSync(VOCABULARY_PATH, "utf8"),
		TAG_VOCABULARY_FILE,
	);
}

/** ghst を実行し、JSON 出力を一時ファイル経由で受け取る。見つからない（終了コード 5）ときは null */
function ghstJson(args: readonly string[]): Record<string, unknown> | null {
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-curate-"));
	const outputPath = path.join(tempDir, "out.json");
	try {
		const fd = openSync(outputPath, "w");
		let result: ReturnType<typeof spawnSync>;
		try {
			result = spawnSync("ghst", [...args, "--json"], {
				stdio: ["ignore", fd, "inherit"],
			});
		} finally {
			closeSync(fd);
		}
		if (result.error) {
			throw result.error;
		}
		if (result.status === GHST_EXIT_NOT_FOUND) {
			return null;
		}
		if (result.status !== 0) {
			throw new Error(
				`ghst ${args.join(" ")} が終了コード ${String(result.status)} で失敗しました`,
			);
		}
		return JSON.parse(readFileSync(outputPath, "utf8")) as Record<
			string,
			unknown
		>;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/** ghst を実行する（出力はそのまま表示）。失敗したらエラーにする */
function ghstRun(args: readonly string[]): void {
	const result = spawnSync("ghst", args, { stdio: "inherit" });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`ghst ${args.join(" ")} が終了コード ${String(result.status)} で失敗しました`,
		);
	}
}

function fetchGhostTags(): GhostTag[] {
	const payload = ghstJson(["tag", "list", "--limit", "all"]);
	if (!payload || !Array.isArray(payload.tags)) {
		throw new Error("ghst tag list の出力に tags 配列がありません");
	}
	return payload.tags.map((tag): GhostTag => {
		const record = tag as Record<string, unknown>;
		if (typeof record.name !== "string" || typeof record.slug !== "string") {
			throw new Error(
				`ghst tag list の出力に name/slug の無いタグがあります: ${JSON.stringify(tag)}`,
			);
		}
		return { name: record.name, slug: record.slug };
	});
}

function tagsList(): void {
	const vocabulary = loadVocabulary();
	const counts = new Map<string, number>();
	for (const post of loadPosts(CONTENT_DIR)) {
		for (const tag of post.tags ?? []) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	for (const entry of vocabulary) {
		console.log(
			`${String(counts.get(entry.name) ?? 0)}\t${entry.name}\t${entry.slug}\t${entry.description}`,
		);
	}
}

function tagsCheck(): void {
	const vocabulary = loadVocabulary();
	const posts = loadPosts(CONTENT_DIR);
	const problems = checkPostTags(posts, vocabulary);
	if (problems.length > 0) {
		console.error(`統制語彙（${TAG_VOCABULARY_FILE}）に無いタグがあります:`);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}
	console.log(
		`curate tags check: ${String(posts.length)} 件の記事のタグはすべて統制語彙（${String(vocabulary.length)} 語）にあります`,
	);
}

function tagsSync(dryRun: boolean): void {
	const vocabulary = loadVocabulary();
	const actions = planTagSync(vocabulary, fetchGhostTags());
	if (actions.length === 0) {
		console.log("Ghost のタグは統制語彙と一致しています");
		return;
	}
	for (const action of actions) {
		const args =
			action.kind === "create"
				? ["tag", "create", "--name", action.name, "--slug", action.slug]
				: ["tag", "update", "--slug", action.from, "--new-slug", action.to];
		console.log(`${dryRun ? "[dry-run] " : ""}ghst ${args.join(" ")}`);
		if (!dryRun) {
			ghstRun(args);
		}
	}
}

function findPost(posts: PublishedPost[], slug: string): PublishedPost {
	const post = posts.find((candidate) => candidate.slug === slug);
	if (!post) {
		throw new Error(
			`${slug}: content/ に記事がありません（pnpm pull --slug ${slug} で取り込んでください）`,
		);
	}
	return post;
}

function check(slug: string): void {
	const post = findPost(loadPosts(CONTENT_DIR), slug);
	const problems = checkPublishReadiness(post, loadVocabulary());
	if (problems.length > 0) {
		console.error(`${slug} は公開の基準を満たしていません:`);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}
	console.log(`curate check: ${slug} は公開の基準を満たしています`);
}

/** Ghost から記事の id と status を取る。無ければ null */
function fetchGhostPost(slug: string): { id: string; status: string } | null {
	const payload = ghstJson(["post", "get", "--slug", slug]);
	if (!payload) {
		return null;
	}
	const posts = payload.posts;
	if (!Array.isArray(posts) || posts.length === 0) {
		throw new Error(`ghst post get の出力に posts がありません: ${slug}`);
	}
	const record = posts[0] as Record<string, unknown>;
	if (typeof record.id !== "string" || typeof record.status !== "string") {
		throw new Error(`ghst post get の出力に id/status がありません: ${slug}`);
	}
	return { id: record.id, status: record.status };
}

function rename(oldSlug: string, newSlug: string): void {
	const slugProblem = checkNewSlug(newSlug);
	if (slugProblem) {
		throw new Error(slugProblem);
	}
	if (oldSlug === newSlug) {
		throw new Error(`${oldSlug}: 変更前と変更後の slug が同じです`);
	}
	for (const relativePath of [
		path.join(STRATA_DIR, `${oldSlug}${STRATA_SUFFIX}`),
		path.join(STRATA_DIR, PRIVATE_DIR, `${oldSlug}${STRATA_SUFFIX}`),
	]) {
		if (existsSync(path.join(POSTS_DIR, relativePath))) {
			throw new Error(
				`${oldSlug}: Hyperstrata の注釈（${relativePath}）がある記事の slug は変えられません`,
			);
		}
	}
	const newFiles = [
		path.join(CONTENT_DIR, `${newSlug}${POST_JSON_SUFFIX}`),
		path.join(CONTENT_DIR, `${newSlug}.md`),
		path.join(CONTENT_DIR, PRIVATE_DIR, `${newSlug}${POST_JSON_SUFFIX}`),
		path.join(CONTENT_DIR, PRIVATE_DIR, `${newSlug}.md`),
	];
	for (const file of newFiles) {
		if (existsSync(file)) {
			throw new Error(
				`${newSlug}: content/ に同じ slug のファイルが既にあります: ${file}`,
			);
		}
	}
	const ghostPost = fetchGhostPost(oldSlug);
	if (!ghostPost) {
		throw new Error(`${oldSlug}: Ghost に記事がありません`);
	}
	if (ghostPost.status !== "draft") {
		throw new Error(
			`${oldSlug}: status が ${ghostPost.status} の記事の slug は変えられません（下書きだけ変更できます）`,
		);
	}
	if (fetchGhostPost(newSlug)) {
		throw new Error(`${newSlug}: Ghost に同じ slug の記事が既にあります`);
	}
	// ghst 0.17.1 の post update には slug を変える専用オプションが無いため、patch を JSON で渡す
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-curate-"));
	try {
		const patchPath = path.join(tempDir, "slug.json");
		writeFileSync(patchPath, JSON.stringify({ slug: newSlug }), "utf8");
		ghstRun(["post", "update", ghostPost.id, "--from-json", patchPath]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
	const renamed = fetchGhostPost(newSlug);
	if (!renamed) {
		throw new Error(
			`${newSlug}: Ghost の slug が変わっていません（Ghost 側で ${oldSlug} を確認してください）`,
		);
	}
	console.log(`Ghost の slug を変更しました: ${oldSlug} → ${newSlug}`);
	const oldFiles = [
		path.join(CONTENT_DIR, `${oldSlug}${POST_JSON_SUFFIX}`),
		path.join(CONTENT_DIR, PRIVATE_DIR, `${oldSlug}${POST_JSON_SUFFIX}`),
	];
	for (const file of oldFiles) {
		if (existsSync(file)) {
			rmSync(file);
			console.log(`削除しました: ${path.relative(POSTS_DIR, file)}`);
		}
	}
	const pull = spawnSync("pnpm", ["pull", "--slug", newSlug], {
		cwd: POSTS_DIR,
		stdio: "inherit",
	});
	if (pull.error) {
		throw pull.error;
	}
	if (pull.status !== 0) {
		throw new Error(
			`pnpm pull --slug ${newSlug} が終了コード ${String(pull.status)} で失敗しました`,
		);
	}
}

function main(): void {
	const [command, ...rest] = process.argv.slice(2);
	switch (command) {
		case "tags": {
			const [sub, flag] = rest;
			if (sub === undefined) {
				tagsList();
			} else if (sub === "check") {
				tagsCheck();
			} else if (sub === "sync") {
				if (flag !== undefined && flag !== "--dry-run") usage();
				tagsSync(flag === "--dry-run");
			} else {
				usage();
			}
			break;
		}
		case "check": {
			const [slug] = rest;
			if (!slug) usage();
			check(slug);
			break;
		}
		case "rename": {
			const [oldSlug, newSlug] = rest;
			if (!oldSlug || !newSlug) usage();
			rename(oldSlug, newSlug);
			break;
		}
		default:
			usage();
	}
}

main();
