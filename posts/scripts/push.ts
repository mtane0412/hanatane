/**
 * 記事ファイルを ghst 経由で Ghost に反映するスクリプト
 *
 * 使い方:
 *   pnpm push content/<slug>.md [--dry-run]                    # Markdown（frontmatter 付き）
 *   pnpm push content/<slug>.post.json [--dry-run]             # Lexical JSON（pull で取得した既存記事）
 *   pnpm push content/private/<slug>.post.json [--dry-run]     # 限定記事（sops 暗号化済み。復号して送る）
 *   pnpm push content/private/<slug>.md [--dry-run]            # 限定記事の新規下書き（平文、.gitignore 対象）
 *   pnpm push ... --allow-public                               # Ghost 側で限定の記事を public に変更するときだけ付ける
 *
 * 処理内容:
 *   1. 拡張子と置き場所に応じてファイルを解析し、メタ情報と本文に分ける（src/post-file.ts, src/post-json.ts）
 *      content/private 配下の .post.json は sops で復号してから解析する（src/sops.ts）
 *   2. 誤公開ガード（src/private-post.ts）:
 *      - visibility が members / paid の記事は content/private 配下、public の記事は content 直下でなければエラー
 *      - Ghost 側の現在の visibility を取得し、限定記事を public に変えようとしていれば --allow-public が無い限りエラー
 *      - `--visibility` は常に明示して送る（create が Ghost の既定値 public に落ちるのを防ぐ）
 *   3. `ghst post update --slug <slug>` で既存記事の更新を試みる
 *   4. 記事が存在しない（終了コード 5）場合は `ghst post create` で新規作成する
 *
 * 注意:
 *   - 認証は ghst の設定（`ghst auth login` で登録したサイト、または GHOST_URL / GHOST_STAFF_ACCESS_TOKEN）に従う
 *   - --dry-run は Ghost を変更しない（visibility の取得だけ行い、実行予定のコマンドを表示する）
 *   - tags はファイルの内容で置き換わるため、Ghost 側で後から付いたタグ（hyperstrata-sync の #ref-* など）を
 *     落とさないよう、編集前に pull しておくこと
 */
import { spawnSync } from "node:child_process";
import {
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildGhstArgs,
	type ContentSource,
	isPostVisibility,
	type PostMeta,
	type PostVisibility,
	parsePostFile,
} from "../src/post-file";
import { POST_JSON_SUFFIX, parsePostJson } from "../src/post-json";
import {
	checkVisibilityTransition,
	isPrivateVisibility,
	isSopsEncryptedPostJson,
	PLAIN_POST_JSON_SUFFIX,
	PRIVATE_DIR,
} from "../src/private-post";
import { decryptPostJson } from "../src/sops";

/** ghst の終了コード。README の Exit code mapping に対応する */
const GHST_EXIT_NOT_FOUND = 5;
const CONTENT_DIR = path.resolve(import.meta.dirname, "../content");
const PRIVATE_CONTENT_DIR = path.join(CONTENT_DIR, PRIVATE_DIR);

interface Prepared {
	meta: PostMeta;
	source: ContentSource;
	stdin: string;
	/** create 時に --from-json で渡す `{ "slug": ... }` ファイル */
	slugJsonPath: string;
	cleanup: () => void;
}

/** ファイルの内容を読む。content/private 配下の .post.json は暗号化済みであることを確認してから復号する */
function readPostContent(
	absolutePath: string,
	fileName: string,
	inPrivateDir: boolean,
): string {
	const raw = readFileSync(absolutePath, "utf8");
	if (!fileName.endsWith(POST_JSON_SUFFIX)) {
		return raw;
	}
	if (fileName.endsWith(PLAIN_POST_JSON_SUFFIX)) {
		throw new Error(
			`${fileName}: 復号した平文作業ファイルは push できません。\`pnpm private encrypt <slug>\` で戻してから <slug>${POST_JSON_SUFFIX} を push してください`,
		);
	}
	const encrypted = isSopsEncryptedPostJson(raw);
	if (inPrivateDir && !encrypted) {
		throw new Error(
			`${fileName}: content/${PRIVATE_DIR}/ のファイルが sops で暗号化されていません`,
		);
	}
	if (!inPrivateDir && encrypted) {
		throw new Error(
			`${fileName}: sops 暗号化ファイルは content/${PRIVATE_DIR}/ に置いてください`,
		);
	}
	return encrypted ? decryptPostJson(absolutePath) : raw;
}

/** ファイルの種類に応じて、ghst に渡す本文とメタ情報の一時ファイルを用意する */
function prepare(filePath: string): Prepared {
	const absolutePath = path.resolve(filePath);
	const fileName = path.basename(absolutePath);
	const inPrivateDir = path.dirname(absolutePath) === PRIVATE_CONTENT_DIR;
	const content = readPostContent(absolutePath, fileName, inPrivateDir);
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-posts-"));
	const cleanup = () => rmSync(tempDir, { recursive: true, force: true });

	let meta: PostMeta;
	let source: ContentSource;
	let stdin = "";
	if (fileName.endsWith(POST_JSON_SUFFIX)) {
		const parsed = parsePostJson(content, fileName);
		meta = parsed.meta;
		const lexicalPath = path.join(tempDir, "lexical.json");
		writeFileSync(lexicalPath, parsed.lexical, {
			encoding: "utf8",
			mode: 0o600,
		});
		source = { kind: "lexical-file", path: lexicalPath };
	} else {
		const parsed = parsePostFile(content, fileName);
		meta = parsed.meta;
		stdin = parsed.body;
		source = { kind: "markdown-stdin" };
	}

	// 置き場所と visibility の整合を確認する（限定記事が content 直下に平文で置かれるのを防ぐ）
	if (isPrivateVisibility(meta.visibility) !== inPrivateDir) {
		cleanup();
		throw new Error(
			isPrivateVisibility(meta.visibility)
				? `${fileName}: visibility が ${meta.visibility} の限定記事は content/${PRIVATE_DIR}/ に置いてください`
				: `${fileName}: visibility が public の記事は content/${PRIVATE_DIR}/ ではなく content/ 直下に置いてください`,
		);
	}

	const slugJsonPath = path.join(tempDir, "slug.json");
	writeFileSync(slugJsonPath, JSON.stringify({ slug: meta.slug }), "utf8");
	return { meta, source, stdin, slugJsonPath, cleanup };
}

/**
 * Ghost 側の現在の visibility を取得する。記事が無ければ undefined。
 * ghst の stdout はパイプだと途切れることがあるため一時ファイル経由で読む。
 */
function fetchGhostVisibility(slug: string): PostVisibility | undefined {
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-posts-get-"));
	try {
		const outputPath = path.join(tempDir, "post.json");
		const fd = openSync(outputPath, "w");
		let result: ReturnType<typeof spawnSync>;
		try {
			result = spawnSync("ghst", ["post", "get", "--slug", slug, "--json"], {
				stdio: ["ignore", fd, "inherit"],
			});
		} finally {
			closeSync(fd);
		}
		if (result.error) {
			throw result.error;
		}
		if (result.status === GHST_EXIT_NOT_FOUND) {
			return undefined;
		}
		if (result.status !== 0) {
			throw new Error(
				`ghst post get が終了コード ${String(result.status)} で失敗しました: ${slug}`,
			);
		}
		const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
			posts?: { visibility?: unknown }[];
		};
		const visibility = payload.posts?.[0]?.visibility;
		if (!isPostVisibility(visibility)) {
			throw new Error(
				`${slug}: Ghost 側の visibility が未対応の値です: ${String(visibility)}`,
			);
		}
		return visibility;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
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
	const allowPublic = process.argv.includes("--allow-public");
	const filePath = positional[0];
	if (!filePath) {
		console.error(
			"使い方: pnpm push content/<slug>.md|<slug>.post.json|private/<slug>.post.json [--dry-run] [--allow-public]",
		);
		process.exit(2);
	}

	const { meta, source, stdin, slugJsonPath, cleanup } = prepare(filePath);
	try {
		// 誤公開ガード: Ghost 側で限定の記事を public に変えるには --allow-public が必要
		const ghostVisibility = fetchGhostVisibility(meta.slug);
		const transitionProblem = checkVisibilityTransition({
			ghost: ghostVisibility,
			file: meta.visibility,
			allowPublic,
		});
		if (transitionProblem) {
			throw new Error(`${meta.slug}: ${transitionProblem}`);
		}

		const updateArgs = buildGhstArgs("update", meta, source);
		const createArgs = buildGhstArgs("create", meta, source, slugJsonPath);
		if (dryRun) {
			console.log(`[dry-run] ghst ${updateArgs.join(" ")}`);
			console.log(`[dry-run] 記事が無ければ: ghst ${createArgs.join(" ")}`);
			return;
		}

		const updateStatus = runGhst(updateArgs, stdin);
		if (updateStatus === 0) {
			console.log(
				`更新しました: ${meta.slug}（visibility: ${meta.visibility}）`,
			);
			return;
		}
		if (updateStatus !== GHST_EXIT_NOT_FOUND) {
			process.exit(updateStatus);
		}

		const createStatus = runGhst(createArgs, stdin);
		if (createStatus !== 0) {
			process.exit(createStatus);
		}
		console.log(`作成しました: ${meta.slug}（visibility: ${meta.visibility}）`);
	} finally {
		cleanup();
	}
}

main();
