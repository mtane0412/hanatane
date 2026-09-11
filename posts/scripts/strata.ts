/**
 * Hyperstrata の注釈（strata/<slug>.json）を扱うスクリプト
 *
 * 注釈の中身（要約と過去記事との関係）は Claude Code のセッションが判断して書く。
 * このスクリプトは、その前後の決定的な処理だけを担当する。
 *
 * 使い方:
 *   pnpm strata pending            # 公開済みでまだ注釈が無い記事を、公開日の古い順に一覧する
 *   pnpm strata catalog <slug>     # <slug> より前に公開された記事の一覧（要約付き）を JSON で出す。関係の候補選びに使う
 *   pnpm strata text <slug>        # <slug> の本文をプレーンテキストで出す（限定記事は sops で復号する）
 *   pnpm strata check              # すべての注釈の形式・置き場所・暗号化・整合（後方参照のみ・再検討の順序）を検査する（CI と pre-commit hook）
 *   pnpm strata decrypt <stem>     # strata/private/<stem>.json を復号して <stem>.plain.json（.gitignore 対象）を作る
 *   pnpm strata encrypt <stem>     # <stem>.plain.json を暗号化して strata/private/<stem>.json に書き、平文を削除する
 *
 *   <stem> は注釈ファイル名から .json を除いたもの。初回の注釈は <slug>、再検討は <slug>.<YYYYMMDDTHHMMSSZ>
 *   再検討の注釈（同じ記事の 2 つ目以降）は初回を書き換えずに別ファイルとして積み、
 *   pending / catalog / graph.json は記事ごとに annotated_at が最新の注釈を採用する
 *
 * 注意:
 *   - 記事一覧は content/**\/*.post.json の平文メタ情報から作る。注釈を付ける前に `pnpm pull` で最新にすること
 *   - check は復号しないため age の秘密鍵は不要で、CI でもそのまま動く
 *   - catalog と text は限定記事の復号に age の秘密鍵（~/.config/sops/age/keys.txt）が必要
 *   - 判定ルールは src/strata.ts に集約している。ここではファイル入出力と sops の実行だけを扱う
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { POST_JSON_SUFFIX } from "../src/post-json";
import { isPrivateVisibility, PRIVATE_DIR } from "../src/private-post";
import { decryptPostJson, encryptJson } from "../src/sops";
import {
	buildCatalog,
	checkStrataAnnotation,
	checkStrataHistory,
	checkStrataPlacement,
	isSopsEncryptedStrata,
	lexicalToText,
	listPendingPosts,
	PLAIN_STRATA_SUFFIX,
	type PublishedPost,
	parseStrataAnnotation,
	STRATA_DIR,
	STRATA_SUFFIX,
	type StrataAnnotation,
	type StrataFile,
	selectLatestAnnotations,
	strataRelativePath,
} from "../src/strata";
import { loadPosts as loadPostsFrom } from "./lib/load-posts";

const POSTS_DIR = path.resolve(import.meta.dirname, "..");
const CONTENT_DIR = path.join(POSTS_DIR, "content");
const STRATA_ROOT = path.join(POSTS_DIR, STRATA_DIR);
const PRIVATE_STRATA_DIR = path.join(STRATA_ROOT, PRIVATE_DIR);

function usage(): never {
	console.error(
		"使い方: pnpm strata pending | catalog <slug> | text <slug> | check | decrypt <stem> | encrypt <stem>（stem は <slug> または <slug>.<YYYYMMDDTHHMMSSZ>）",
	);
	process.exit(2);
}

/** content/ と content/private/ の `.post.json` から記事一覧を作る（lexical は読まない） */
function loadPosts(): PublishedPost[] {
	return loadPostsFrom(CONTENT_DIR);
}

/** strata/ 配下の注釈ファイルを列挙する（strata 相対パス、public → private の順） */
function listStrataFiles(): string[] {
	const files: string[] = [];
	for (const [dir, prefix] of [
		[STRATA_ROOT, ""],
		[PRIVATE_STRATA_DIR, `${PRIVATE_DIR}/`],
	] as const) {
		if (!existsSync(dir)) continue;
		for (const fileName of readdirSync(dir).sort()) {
			if (
				fileName.endsWith(STRATA_SUFFIX) &&
				!fileName.endsWith(PLAIN_STRATA_SUFFIX)
			) {
				files.push(`${prefix}${fileName}`);
			}
		}
	}
	return files;
}

/**
 * すべての注釈を読み込み、記事ごとに annotated_at が最新の注釈（再検討があればそれ）を返す。
 * decryptPrivate が true のときは限定記事の注釈を sops で復号して要約を平文にする。
 */
function loadAnnotations(
	decryptPrivate: boolean,
): Map<string, StrataAnnotation> {
	const annotations: StrataAnnotation[] = [];
	for (const relativePath of listStrataFiles()) {
		const absolutePath = path.join(STRATA_ROOT, relativePath);
		const fileName = path.basename(relativePath);
		const content =
			decryptPrivate && relativePath.startsWith(`${PRIVATE_DIR}/`)
				? decryptPostJson(absolutePath)
				: readFileSync(absolutePath, "utf8");
		annotations.push(parseStrataAnnotation(content, fileName));
	}
	return selectLatestAnnotations(annotations);
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

function pending(): void {
	const posts = loadPosts();
	const annotated = new Set(loadAnnotations(false).keys());
	const list = listPendingPosts(posts, annotated);
	if (list.length === 0) {
		console.log("注釈が無い公開記事はありません");
		return;
	}
	for (const post of list) {
		console.log(
			`${post.published_at ?? ""}\t${post.visibility}\t${post.slug}\t${post.title}`,
		);
	}
	console.error(`${String(list.length)} 件の公開記事に注釈がありません`);
}

function catalog(slug: string): void {
	const posts = loadPosts();
	const annotations = loadAnnotations(true);
	console.log(JSON.stringify(buildCatalog(slug, posts, annotations), null, 2));
}

function text(slug: string): void {
	const post = findPost(loadPosts(), slug);
	const fileName = `${slug}${POST_JSON_SUFFIX}`;
	const content = isPrivateVisibility(post.visibility)
		? decryptPostJson(path.join(CONTENT_DIR, PRIVATE_DIR, fileName))
		: readFileSync(path.join(CONTENT_DIR, fileName), "utf8");
	const data: unknown = JSON.parse(content);
	if (
		typeof data !== "object" ||
		data === null ||
		!("lexical" in data) ||
		typeof data.lexical !== "object" ||
		data.lexical === null
	) {
		throw new Error(`${fileName}: lexical がありません`);
	}
	console.log(`# ${post.title}`);
	console.log(lexicalToText(data.lexical as Record<string, unknown>));
}

function check(): void {
	const posts = loadPosts();
	const files = listStrataFiles();
	const problems: string[] = [];
	// 再検討の順序検査（checkStrataHistory）は public と private を分けて行う（置き場所は別に検査する）
	const parsedByDir = new Map<string, StrataFile[]>();
	for (const relativePath of files) {
		const absolutePath = path.join(STRATA_ROOT, relativePath);
		const content = readFileSync(absolutePath, "utf8");
		let annotation: StrataAnnotation;
		try {
			annotation = parseStrataAnnotation(content, path.basename(relativePath));
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
			continue;
		}
		const dir = path.dirname(relativePath);
		parsedByDir.set(dir, [
			...(parsedByDir.get(dir) ?? []),
			{ fileName: path.basename(relativePath), annotation },
		]);
		const post = posts.find((candidate) => candidate.slug === annotation.slug);
		if (post) {
			const placement = checkStrataPlacement(relativePath, post.visibility);
			if (placement) problems.push(placement);
		}
		const inPrivateDir = relativePath.startsWith(`${PRIVATE_DIR}/`);
		if (inPrivateDir && !isSopsEncryptedStrata(content)) {
			problems.push(
				`${relativePath}: sops で暗号化されていません。\`pnpm --filter ./posts strata encrypt ${annotation.slug}\` で暗号化してください`,
			);
		}
		if (!inPrivateDir && isSopsEncryptedStrata(content)) {
			problems.push(
				`${relativePath}: public の注釈が暗号化されています。平文で置いてください`,
			);
		}
		problems.push(...checkStrataAnnotation(annotation, posts));
	}
	for (const [dir, parsed] of parsedByDir) {
		const prefix = dir === "." ? "" : `${dir}/`;
		problems.push(
			...checkStrataHistory(parsed).map((problem) => `${prefix}${problem}`),
		);
	}
	if (problems.length > 0) {
		console.error("Hyperstrata の注釈に問題があります:");
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}
	console.log(
		`strata check: ${String(files.length)} 件の注釈を検査し、問題はありませんでした`,
	);
}

function decrypt(stem: string): void {
	const encryptedPath = path.join(
		PRIVATE_STRATA_DIR,
		`${stem}${STRATA_SUFFIX}`,
	);
	const plainPath = path.join(
		PRIVATE_STRATA_DIR,
		`${stem}${PLAIN_STRATA_SUFFIX}`,
	);
	if (!existsSync(encryptedPath)) {
		throw new Error(`見つかりません: ${encryptedPath}`);
	}
	if (existsSync(plainPath)) {
		throw new Error(
			`平文ファイルが既にあります（編集中の内容を失わないよう上書きしません）: ${plainPath}`,
		);
	}
	writeFileSync(plainPath, decryptPostJson(encryptedPath), {
		encoding: "utf8",
		mode: 0o600,
	});
	console.log(`復号しました（編集後は strata encrypt で戻す）: ${plainPath}`);
}

function encrypt(stem: string): void {
	const plainPath = path.join(
		PRIVATE_STRATA_DIR,
		`${stem}${PLAIN_STRATA_SUFFIX}`,
	);
	const fileName = `${stem}${STRATA_SUFFIX}`;
	const encryptedPath = path.join(PRIVATE_STRATA_DIR, fileName);
	if (existsSync(encryptedPath)) {
		throw new Error(
			`暗号化済みの注釈が既にあります（一度書いた注釈は書き換えません。再検討は <slug>.<YYYYMMDDTHHMMSSZ>.json に積んでください）: ${encryptedPath}`,
		);
	}
	if (!existsSync(plainPath)) {
		throw new Error(`平文ファイルがありません: ${plainPath}`);
	}
	const plainJson = readFileSync(plainPath, "utf8");
	// 暗号化前に検証し、public の記事の注釈や壊れた注釈が private に紛れ込むのを防ぐ
	const annotation = parseStrataAnnotation(plainJson, fileName);
	const posts = loadPosts();
	const post = findPost(posts, annotation.slug);
	if (!isPrivateVisibility(post.visibility)) {
		throw new Error(
			`${fileName}: public の記事の注釈は ${STRATA_DIR}/ 直下に平文で置いてください`,
		);
	}
	const problems = checkStrataAnnotation(annotation, posts);
	if (problems.length > 0) {
		throw new Error(problems.join("\n"));
	}
	mkdirSync(PRIVATE_STRATA_DIR, { recursive: true });
	// sops の creation_rules（strata/private/.*\.json$）に突き合わせるための相対パス。再検討はファイル名だけが異なる
	const relativePath = path.join(
		STRATA_DIR,
		path.dirname(strataRelativePath(annotation.slug, post.visibility)),
		fileName,
	);
	writeFileSync(encryptedPath, encryptJson(plainJson, relativePath), "utf8");
	rmSync(plainPath);
	console.log(`暗号化しました（平文は削除済み）: ${encryptedPath}`);
}

function main(): void {
	const [command, slug] = process.argv.slice(2);
	const withSlug = (run: (slug: string) => void): void => {
		if (!slug) usage();
		run(slug);
	};
	switch (command) {
		case "pending":
			pending();
			break;
		case "check":
			check();
			break;
		case "catalog":
			withSlug(catalog);
			break;
		case "text":
			withSlug(text);
			break;
		case "decrypt":
			withSlug(decrypt);
			break;
		case "encrypt":
			withSlug(encrypt);
			break;
		default:
			usage();
	}
}

main();
