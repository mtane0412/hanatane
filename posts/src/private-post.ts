/**
 * メンバー限定記事（visibility が members / paid）を公開リポジトリに平文で置かないためのルール
 *
 * 配置ルール:
 *   - 公開記事:  content/<slug>.post.json、content/<slug>.md（平文）
 *   - 限定記事:  content/private/<slug>.post.json（sops + age で lexical を暗号化したもの）
 *   - content/private/<slug>.md と content/private/<slug>.plain.post.json は
 *     ローカル専用の平文作業ファイル（.gitignore で除外）
 *
 * このモジュールは純粋関数だけを持ち、sops の実行は src/sops.ts が担当します。
 * check-private スクリプト（CI と pre-commit hook）と push / pull スクリプトから使います。
 */
import { parse as parseYaml } from "yaml";
import { isPostVisibility, type PostVisibility } from "./post-file";
import { POST_JSON_SUFFIX } from "./post-json";

/** 限定記事を置く content 配下のディレクトリ名 */
export const PRIVATE_DIR = "private";
/** 限定記事を復号した平文作業ファイルの拡張子（.gitignore で除外する） */
export const PLAIN_POST_JSON_SUFFIX = ".plain.post.json";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SOPS_ENCRYPTED_VALUE_PATTERN = /^ENC\[/;

export function isPrivateVisibility(visibility: PostVisibility): boolean {
	return visibility !== "public";
}

/**
 * slug と visibility から、content ディレクトリからの相対パスを返します。
 */
export function contentRelativePath(
	slug: string,
	visibility: PostVisibility,
): string {
	const fileName = `${slug}${POST_JSON_SUFFIX}`;
	return isPrivateVisibility(visibility)
		? `${PRIVATE_DIR}/${fileName}`
		: fileName;
}

/**
 * visibility が変わった記事について、反対側（公開 ⇔ 限定）に残っている可能性がある
 * 古い `.post.json` の content 相対パスを返します。pull はこれを削除して二重管理を防ぎます。
 */
export function staleContentPaths(
	slug: string,
	visibility: PostVisibility,
): string[] {
	const opposite: PostVisibility = isPrivateVisibility(visibility)
		? "public"
		: "members";
	return [contentRelativePath(slug, opposite)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * lexical 配下のすべての葉が sops の ENC[...] 文字列であるかを再帰的に確認する。
 * sops は空文字列と null を暗号化せずそのまま残すため、この 2 つは許容する（情報を持たないため）。
 */
function allLeavesEncrypted(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.every(allLeavesEncrypted);
	}
	if (isRecord(value)) {
		return Object.values(value).every(allLeavesEncrypted);
	}
	if (value === null || value === "") {
		return true;
	}
	return typeof value === "string" && SOPS_ENCRYPTED_VALUE_PATTERN.test(value);
}

/**
 * `.post.json` の内容が sops で暗号化済み（sops メタ情報があり、lexical の葉がすべて ENC[...]）かを判定します。
 * JSON として解析できない内容は false を返します。
 */
export function isSopsEncryptedPostJson(content: string): boolean {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		return false;
	}
	if (!isRecord(data) || !isRecord(data.sops) || !isRecord(data.lexical)) {
		return false;
	}
	return allLeavesEncrypted(data.lexical);
}

/** ファイル内容から visibility を取り出す。visibility の無いファイルは public とみなす */
function readVisibility(relativePath: string, content: string): PostVisibility {
	let record: unknown;
	if (relativePath.endsWith(".md")) {
		const match = FRONTMATTER_PATTERN.exec(content);
		if (!match) {
			throw new Error("frontmatter がありません");
		}
		record = parseYaml(match[1]);
	} else {
		record = JSON.parse(content);
	}
	if (!isRecord(record)) {
		throw new Error("オブジェクトではありません");
	}
	const visibility = record.visibility ?? "public";
	if (!isPostVisibility(visibility)) {
		throw new Error(`未対応の visibility です: ${String(visibility)}`);
	}
	return visibility;
}

/**
 * コミット対象（git の index にある）content 配下のファイル 1 件を検査し、問題があればメッセージを返します。
 *
 * - content/private 配下: sops で暗号化済みの `.post.json` だけを許可する
 * - それ以外: visibility が public で、sops 暗号化ファイルでないことを求める
 *
 * @param relativePath - content ディレクトリからの相対パス（例: `private/secret.post.json`）
 * @param content - ファイルの内容
 * @returns 問題がなければ null、あれば理由
 */
export function checkTrackedContentFile(
	relativePath: string,
	content: string,
): string | null {
	const inPrivateDir = relativePath.startsWith(`${PRIVATE_DIR}/`);
	if (inPrivateDir) {
		if (!relativePath.endsWith(POST_JSON_SUFFIX)) {
			return `${relativePath}: content/${PRIVATE_DIR}/ にコミットできるのは sops で暗号化した ${POST_JSON_SUFFIX} だけです（平文の下書きは .gitignore の対象です）`;
		}
		if (relativePath.endsWith(PLAIN_POST_JSON_SUFFIX)) {
			return `${relativePath}: 復号した平文作業ファイルはコミットできません。encrypt して元のファイルに戻してください`;
		}
		if (!isSopsEncryptedPostJson(content)) {
			return `${relativePath}: sops で暗号化されていません。\`pnpm --filter ./posts private encrypt\` で暗号化してください`;
		}
		return null;
	}

	if (isSopsEncryptedPostJson(content)) {
		return `${relativePath}: sops 暗号化ファイルは content/${PRIVATE_DIR}/ に置いてください`;
	}
	let visibility: PostVisibility;
	try {
		visibility = readVisibility(relativePath, content);
	} catch (error) {
		return `${relativePath}: 解析できません（${error instanceof Error ? error.message : String(error)}）`;
	}
	if (isPrivateVisibility(visibility)) {
		return `${relativePath}: visibility が ${visibility} の限定記事は平文でコミットできません。content/${PRIVATE_DIR}/ に sops で暗号化して置いてください`;
	}
	return null;
}

/**
 * push 前に Ghost 側の visibility とファイルの visibility を突き合わせ、
 * 限定記事を意図せず公開に変更してしまう操作を止めます。
 *
 * @param ghost - Ghost 側の現在の visibility。記事が無い（新規作成）場合は undefined
 * @param file - push しようとしているファイルの visibility
 * @param allowPublic - `--allow-public` が指定されたか
 * @returns 問題がなければ null、あれば理由
 */
export function checkVisibilityTransition(params: {
	ghost: PostVisibility | undefined;
	file: PostVisibility;
	allowPublic: boolean;
}): string | null {
	const { ghost, file, allowPublic } = params;
	if (
		ghost !== undefined &&
		isPrivateVisibility(ghost) &&
		!isPrivateVisibility(file) &&
		!allowPublic
	) {
		return `Ghost 側では visibility が ${ghost} の限定記事ですが、ファイルは public です。公開に変更する場合は --allow-public を付けてください`;
	}
	return null;
}
