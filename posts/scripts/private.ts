/**
 * 限定記事（content/private/<slug>.post.json）を編集するための復号・再暗号化スクリプト
 *
 * 使い方:
 *   pnpm private decrypt <slug>   # content/private/<slug>.post.json を復号し、<slug>.plain.post.json（平文、.gitignore 対象）を作る
 *   pnpm private encrypt <slug>   # <slug>.plain.post.json を暗号化して <slug>.post.json に書き戻し、平文を削除する
 *
 * 処理内容:
 *   - decrypt: sops で復号した内容を content/private/<slug>.plain.post.json に書く。既に平文があれば上書きしない（fail-fast）
 *   - encrypt: 平文を src/post-json.ts で検証（visibility が members / paid であること）してから sops で暗号化し、平文を削除する
 *
 * 注意:
 *   - 平文ファイルは編集が終わったら必ず encrypt で戻すこと。pull は平文が残っている記事をエラーにする
 *   - 暗号化済みファイルを直接編集しないこと（sops の MAC 検証に失敗する）
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { POST_JSON_SUFFIX, parsePostJson } from "../src/post-json";
import {
	isPrivateVisibility,
	PLAIN_POST_JSON_SUFFIX,
	PRIVATE_DIR,
} from "../src/private-post";
import { decryptPostJson, encryptPostJson } from "../src/sops";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../content");
const PRIVATE_CONTENT_DIR = path.join(CONTENT_DIR, PRIVATE_DIR);

function usage(): never {
	console.error("使い方: pnpm private decrypt|encrypt <slug>");
	process.exit(2);
}

function decrypt(slug: string): void {
	const encryptedPath = path.join(
		PRIVATE_CONTENT_DIR,
		`${slug}${POST_JSON_SUFFIX}`,
	);
	const plainPath = path.join(
		PRIVATE_CONTENT_DIR,
		`${slug}${PLAIN_POST_JSON_SUFFIX}`,
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
	console.log(`復号しました（編集後は private encrypt で戻す）: ${plainPath}`);
}

function encrypt(slug: string): void {
	const plainPath = path.join(
		PRIVATE_CONTENT_DIR,
		`${slug}${PLAIN_POST_JSON_SUFFIX}`,
	);
	const fileName = `${slug}${POST_JSON_SUFFIX}`;
	const encryptedPath = path.join(PRIVATE_CONTENT_DIR, fileName);
	if (!existsSync(plainPath)) {
		throw new Error(`平文ファイルがありません: ${plainPath}`);
	}
	const plainJson = readFileSync(plainPath, "utf8");
	// 暗号化前に内容を検証し、限定記事でないものが private に紛れ込むのを防ぐ
	const { meta } = parsePostJson(plainJson, fileName);
	if (!isPrivateVisibility(meta.visibility)) {
		throw new Error(
			`${fileName}: visibility が public の記事は content/${PRIVATE_DIR}/ には置けません。content/ 直下に平文で置いてください`,
		);
	}
	writeFileSync(
		encryptedPath,
		encryptPostJson(plainJson, `${PRIVATE_DIR}/${fileName}`),
		"utf8",
	);
	rmSync(plainPath);
	console.log(`暗号化しました（平文は削除済み）: ${encryptedPath}`);
}

function main(): void {
	const [command, slug] = process.argv.slice(2);
	if (!slug || (command !== "decrypt" && command !== "encrypt")) {
		usage();
	}
	if (command === "decrypt") {
		decrypt(slug);
	} else {
		encrypt(slug);
	}
}

main();
