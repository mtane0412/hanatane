/**
 * 公開前の整備（研究者が slug・excerpt・tags を整える工程）のルール
 *
 * hanatane.net では、著者が下書きを書き終えたあと、Claude Code のセッション（研究者）が
 * 公開前に slug・excerpt・tags を整えます（.claude/skills/publish-prepare）。
 * 判断そのものは研究者が行い、このモジュールはその判断が基準に収まっているかを検査します。
 *
 *   - 統制語彙（posts/tags.json）: 研究者が維持するタグの一覧。記事に付けるタグはこの中から選ぶ。
 *     語彙そのものも記事全体を見ながら研究者が更新する（動的に変わってよい）
 *   - 新しい slug: `YYYYMMDD-<英語の題材>`。同じ話題が繰り返される前提で、公開日で一意にする
 *   - excerpt: EXCERPT_MAX_LENGTH 字以内。「A、B、C について話しました」のような要約
 *
 * このモジュールは純粋関数だけを持ち、ファイル入出力と ghst の実行は scripts/curate.ts が担当します。
 */
import type { PublishedPost } from "./strata";

/** 統制語彙ファイル（posts からの相対パス） */
export const TAG_VOCABULARY_FILE = "tags.json";
/** excerpt の上限（字数。サロゲートペアも 1 字と数える） */
export const EXCERPT_MAX_LENGTH = 140;

/** 統制語彙の 1 件 */
export interface TagVocabularyEntry {
	/** Ghost のタグ名（記事の tags に書く値） */
	name: string;
	/** Ghost のタグ slug（英小文字・数字・ハイフン。日本語名から自動生成される中国語読みを避ける） */
	slug: string;
	/** どんな記事に付けるかの基準 */
	description: string;
}

/** Ghost 側のタグ（`ghst tag list` から取る） */
export interface GhostTag {
	name: string;
	slug: string;
}

/** 語彙と Ghost の差分を埋めるための操作 */
export type TagSyncAction =
	| { kind: "create"; name: string; slug: string }
	| { kind: "update-slug"; name: string; from: string; to: string };

const TAG_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NEW_SLUG_PATTERN = /^(\d{8})-[a-z0-9]+(-[a-z0-9]+)*$/;
const NEW_SLUG_EXAMPLE = "20260910-hyperstrata-design";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
	record: Record<string, unknown>,
	key: string,
	context: string,
): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${context}: ${key} は空でない文字列にしてください`);
	}
	return value;
}

/** `#` で始まるタグは Ghost の内部タグ（`#ref-*` や `#Import ...`）で、語彙の対象外 */
export function isInternalTag(name: string): boolean {
	return name.startsWith("#");
}

/**
 * 統制語彙ファイルの内容を検証して読み込みます。
 *
 * @param content - ファイルの内容（`{ "tags": [{ name, slug, description }] }`）
 * @param fileName - エラーメッセージ用のファイル名
 */
export function parseTagVocabulary(
	content: string,
	fileName: string,
): TagVocabularyEntry[] {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		throw new Error(`${fileName}: JSON として読めません`);
	}
	if (!isRecord(data) || !Array.isArray(data.tags)) {
		throw new Error(`${fileName}: tags は配列にしてください`);
	}
	const names = new Set<string>();
	const slugs = new Set<string>();
	return data.tags.map((item, index): TagVocabularyEntry => {
		const context = `${fileName}: tags[${String(index)}]`;
		if (!isRecord(item)) {
			throw new Error(`${context} はオブジェクトにしてください`);
		}
		const name = requireNonEmptyString(item, "name", context);
		const slug = requireNonEmptyString(item, "slug", context);
		const description = requireNonEmptyString(item, "description", context);
		if (isInternalTag(name)) {
			throw new Error(
				`${context}: # で始まる内部タグは語彙に入れません: ${name}`,
			);
		}
		if (!TAG_SLUG_PATTERN.test(slug)) {
			throw new Error(
				`${context}: slug は英小文字・数字・ハイフンだけにしてください: ${slug}`,
			);
		}
		if (names.has(name)) {
			throw new Error(`${context}: name が重複しています: ${name}`);
		}
		if (slugs.has(slug)) {
			throw new Error(`${context}: slug が重複しています: ${slug}`);
		}
		names.add(name);
		slugs.add(slug);
		return { name, slug, description };
	});
}

function unknownTags(
	tags: readonly string[],
	vocabulary: readonly TagVocabularyEntry[],
): string[] {
	const known = new Set(vocabulary.map((entry) => entry.name));
	return tags.filter((tag) => !isInternalTag(tag) && !known.has(tag));
}

function unknownTagsProblem(slug: string, tags: readonly string[]): string {
	return `${slug}: 統制語彙（${TAG_VOCABULARY_FILE}）に無いタグが付いています: ${tags.join(", ")}`;
}

/**
 * すべての記事のタグ（内部タグを除く）が統制語彙にあるかを検査し、問題の一覧を返します。
 * 語彙を絞ったときに、古い記事のタグを付け替え忘れていないかを見つけるための検査です。
 */
export function checkPostTags(
	posts: readonly PublishedPost[],
	vocabulary: readonly TagVocabularyEntry[],
): string[] {
	const problems: string[] = [];
	for (const post of posts) {
		const unknown = unknownTags(post.tags ?? [], vocabulary);
		if (unknown.length > 0) {
			problems.push(unknownTagsProblem(post.slug, unknown));
		}
	}
	return problems;
}

/**
 * 統制語彙に合わせて Ghost のタグをどう変えるかを決めます（実行は scripts/curate.ts）。
 * 語彙に無い Ghost のタグ（内部タグ、使われなくなったタグ）には触れません。
 *
 * @param vocabulary - 統制語彙
 * @param ghostTags - Ghost のタグ一覧
 */
export function planTagSync(
	vocabulary: readonly TagVocabularyEntry[],
	ghostTags: readonly GhostTag[],
): TagSyncAction[] {
	const byName = new Map(ghostTags.map((tag) => [tag.name, tag]));
	const bySlug = new Map(ghostTags.map((tag) => [tag.slug, tag]));
	const actions: TagSyncAction[] = [];
	for (const entry of vocabulary) {
		const existing = byName.get(entry.name);
		if (existing?.slug === entry.slug) {
			continue;
		}
		const occupant = bySlug.get(entry.slug);
		if (occupant && occupant.name !== entry.name) {
			throw new Error(
				`${entry.name}: slug ${entry.slug} は Ghost で別のタグ（${occupant.name}）に使われています`,
			);
		}
		actions.push(
			existing
				? {
						kind: "update-slug",
						name: entry.name,
						from: existing.slug,
						to: entry.slug,
					}
				: { kind: "create", name: entry.name, slug: entry.slug },
		);
	}
	return actions;
}

function isValidDate(yyyymmdd: string): boolean {
	const year = Number(yyyymmdd.slice(0, 4));
	const month = Number(yyyymmdd.slice(4, 6));
	const day = Number(yyyymmdd.slice(6, 8));
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

/**
 * 新しい記事の slug が `YYYYMMDD-<英語の題材>` の形式かを検査します。
 * 既存記事の slug は URL と Hyperstrata の関係の主キーなので変えず、新しい記事だけがこの形式に従います。
 *
 * @returns 問題があればその説明、無ければ null
 */
export function checkNewSlug(slug: string): string | null {
	const match = NEW_SLUG_PATTERN.exec(slug);
	if (!match) {
		return `${slug}: slug は YYYYMMDD-<英語の題材> の形式にしてください（例: ${NEW_SLUG_EXAMPLE}）`;
	}
	const date = match[1];
	if (!isValidDate(date)) {
		return `${slug}: slug の日付が正しくありません: ${date}`;
	}
	return null;
}

/** 文字数を数える（サロゲートペアも 1 字） */
export function countCharacters(text: string): number {
	return [...text].length;
}

/**
 * 下書きが公開の基準（slug の形式、excerpt の有無と長さ、統制語彙のタグ）を満たしているかを検査します。
 *
 * @returns 問題の一覧（無ければ空配列）
 */
export function checkPublishReadiness(
	post: PublishedPost,
	vocabulary: readonly TagVocabularyEntry[],
): string[] {
	if (post.status !== "draft") {
		return [
			`${post.slug}: 公開済みの記事です。整備は下書きのうちに行ってください`,
		];
	}
	const problems: string[] = [];
	const slugProblem = checkNewSlug(post.slug);
	if (slugProblem) {
		problems.push(slugProblem);
	}
	if (!post.excerpt) {
		problems.push(`${post.slug}: excerpt がありません`);
	} else {
		const length = countCharacters(post.excerpt);
		if (length > EXCERPT_MAX_LENGTH) {
			problems.push(
				`${post.slug}: excerpt は ${String(EXCERPT_MAX_LENGTH)} 字以内にしてください（現在 ${String(length)} 字）`,
			);
		}
	}
	const tags = post.tags ?? [];
	const publicTags = tags.filter((tag) => !isInternalTag(tag));
	if (publicTags.length === 0) {
		problems.push(`${post.slug}: 統制語彙のタグを 1 つ以上付けてください`);
	} else {
		const unknown = unknownTags(publicTags, vocabulary);
		if (unknown.length > 0) {
			problems.push(unknownTagsProblem(post.slug, unknown));
		}
	}
	return problems;
}
