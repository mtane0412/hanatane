/**
 * Hyperstrata の注釈ファイル（posts/strata/<slug>.json）のルール
 *
 * 記事本文のリンクから作る引用（人間の層、theme/scripts/hyperstrata-sync.mjs の `#ref-*`）とは別に、
 * Claude Code のセッションが過去記事との関係を推定して書く「機械の層」を、記事ごとに 1 ファイルで堆積させます。
 *
 * 形式:
 *   {
 *     "slug": "<記事 slug>",
 *     "summary": "<記事の要約（200〜300 字程度）>",
 *     "relations": [{ "slug": "<過去記事 slug>", "type": "continues" | "revisits" | "updates", "reason": "<一行の理由>" }],
 *     "annotated_at": "<ISO 8601>",
 *     "annotator": "<注釈を書いたモデル名>",
 *     "icon": "<TOPIC_ICONS のいずれか、該当なしなら省略>"
 *   }
 *
 * ルール:
 *   - 注釈は公開済みの記事にだけ付け、関係は自分より前に公開された記事だけを指す（後方参照のみ、DAG を保つ）
 *   - 一度書いた注釈は書き換えない（解釈も地層として積む）
 *   - 限定記事（visibility が members / paid）の注釈は strata/private/ に置き、summary と reason を sops で暗号化する
 *     （関係の存在と種類、icon は title と同じく公開情報として平文で残す）
 *
 * このモジュールは純粋関数だけを持ち、ファイル入出力と sops の実行は scripts/strata.ts が担当します。
 */
import type { PostStatus, PostVisibility } from "./post-file";
import { isPostVisibility } from "./post-file";
import { isPrivateVisibility, PRIVATE_DIR } from "./private-post";

/** 注釈ファイルを置くディレクトリ（posts からの相対パス） */
export const STRATA_DIR = "strata";
/** 注釈ファイルの拡張子 */
export const STRATA_SUFFIX = ".json";
/** 限定記事の注釈を復号した平文作業ファイルの拡張子（.gitignore で除外する） */
export const PLAIN_STRATA_SUFFIX = ".plain.json";

/**
 * 関係の種類
 *   - continues: 続報。同じ出来事・プロジェクトの次の報告（例: たねハウスの進捗、週報）
 *   - revisits: 再訪。同じテーマに別の角度や時期から戻った
 *   - updates: 更新。過去記事の内容や考えを改める意図がある（思考の変遷）
 */
export const RELATION_TYPES = ["continues", "revisits", "updates"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/**
 * 記事の題材を表すアイコン種別（地層の可視化で使う）
 *   - cat: 猫
 *   - house: 古民家・DIY・住まい
 *   - hunting: 狩猟
 *   - game: 格ゲー・ゲーム
 *   - tech: 開発・Ghost運用・ツール
 *   - travel: 旅行・遠征
 *   - journal: 週報・振り返り・エッセイ的な考え
 *   - event: 勉強会・登壇・交流イベント
 * どれにも当てはまらない記事は icon を付けない（null）。
 */
export const TOPIC_ICONS = [
	"cat",
	"house",
	"hunting",
	"game",
	"tech",
	"travel",
	"journal",
	"event",
] as const;
export type TopicIcon = (typeof TOPIC_ICONS)[number];

export interface StrataRelation {
	slug: string;
	type: RelationType;
	reason: string;
}

export interface StrataAnnotation {
	slug: string;
	summary: string;
	relations: StrataRelation[];
	annotated_at: string;
	annotator: string;
	/** 該当する題材が無ければ null */
	icon: TopicIcon | null;
}

/** 注釈の対象になる記事のメタ情報（`.post.json` の平文部分から取る） */
export interface PublishedPost {
	slug: string;
	title: string;
	status: PostStatus;
	visibility: PostVisibility;
	/** 下書きには無い */
	published_at?: string;
	/** Ghost のタグ名の一覧（`#ref-*` などの内部タグを含む）。公開前の整備（src/curate.ts）で使う */
	tags?: string[];
	/** 一覧やカードに出る抜粋（custom_excerpt）。公開前の整備（src/curate.ts）で使う */
	excerpt?: string;
}

/** `strata catalog` が Claude Code に渡す、候補となる過去記事の一覧の 1 件 */
export interface CatalogEntry {
	slug: string;
	title: string;
	published_at: string;
	visibility: PostVisibility;
	/** まだ注釈が無い記事は null */
	summary: string | null;
}

const SOPS_ENCRYPTED_VALUE_PATTERN = /^ENC\[/;
const ISO_8601_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRelationType(value: unknown): value is RelationType {
	return (RELATION_TYPES as readonly unknown[]).includes(value);
}

function isTopicIcon(value: unknown): value is TopicIcon {
	return (TOPIC_ICONS as readonly unknown[]).includes(value);
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

/**
 * 注釈ファイルの内容を構造的に検証して読み込みます。
 * 記事一覧との整合（存在・公開順）は checkStrataAnnotation で別に検査します。
 * sops で暗号化された値（ENC[...]）も文字列としてそのまま通します。
 *
 * @param content - ファイルの内容
 * @param fileName - ファイル名（slug と一致することを確認する）
 */
export function parseStrataAnnotation(
	content: string,
	fileName: string,
): StrataAnnotation {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		throw new Error(`${fileName}: JSON として読めません`);
	}
	if (!isRecord(data)) {
		throw new Error(`${fileName}: JSON オブジェクトではありません`);
	}
	const slug = requireNonEmptyString(data, "slug", fileName);
	const expectedSlug = fileName.replace(/\.json$/, "");
	if (slug !== expectedSlug) {
		throw new Error(
			`${fileName}: slug（${slug}）がファイル名（${expectedSlug}）と一致しません`,
		);
	}
	const summary = requireNonEmptyString(data, "summary", fileName);
	if (!Array.isArray(data.relations)) {
		throw new Error(`${fileName}: relations は配列にしてください`);
	}
	const relations = data.relations.map((item, index): StrataRelation => {
		const context = `${fileName}: relations[${String(index)}]`;
		if (!isRecord(item)) {
			throw new Error(`${context} はオブジェクトにしてください`);
		}
		if (!isRelationType(item.type)) {
			throw new Error(
				`${context}: type は ${RELATION_TYPES.join(" / ")} のいずれかにしてください: ${String(item.type)}`,
			);
		}
		return {
			slug: requireNonEmptyString(item, "slug", context),
			type: item.type,
			reason: requireNonEmptyString(item, "reason", context),
		};
	});
	const annotatedAt = requireNonEmptyString(data, "annotated_at", fileName);
	if (!ISO_8601_PATTERN.test(annotatedAt)) {
		throw new Error(
			`${fileName}: annotated_at は ISO 8601 形式にしてください: ${annotatedAt}`,
		);
	}
	if (data.icon !== undefined && !isTopicIcon(data.icon)) {
		throw new Error(
			`${fileName}: icon は ${TOPIC_ICONS.join(" / ")} のいずれかにしてください: ${String(data.icon)}`,
		);
	}
	return {
		slug,
		summary,
		relations,
		annotated_at: annotatedAt,
		annotator: requireNonEmptyString(data, "annotator", fileName),
		icon: data.icon ?? null,
	};
}

function findPublished(
	posts: readonly PublishedPost[],
	slug: string,
): (PublishedPost & { published_at: string }) | null {
	const post = posts.find((candidate) => candidate.slug === slug);
	if (!post || post.status !== "published" || !post.published_at) {
		return null;
	}
	return { ...post, published_at: post.published_at };
}

/**
 * 注釈と記事一覧の整合を検査し、問題の一覧を返します（無ければ空配列）。
 *
 * - 注釈の対象は公開済み記事であること
 * - 関係は自分以外の公開済み記事で、自分より前に公開されたものだけを指すこと（後方参照のみ）
 * - 同じ記事への関係を重複させないこと
 */
export function checkStrataAnnotation(
	annotation: StrataAnnotation,
	posts: readonly PublishedPost[],
): string[] {
	const problems: string[] = [];
	const target = findPublished(posts, annotation.slug);
	if (!target) {
		const exists = posts.some((post) => post.slug === annotation.slug);
		problems.push(
			exists
				? `${annotation.slug}: 公開済みでない記事には注釈を付けられません（公開後に付けてください）`
				: `${annotation.slug}: 記事一覧にありません（pull 済みの公開記事だけに注釈を付けられます）`,
		);
		return problems;
	}
	const seen = new Set<string>();
	for (const relation of annotation.relations) {
		if (seen.has(relation.slug)) {
			problems.push(
				`${annotation.slug}: ${relation.slug} への関係が重複しています`,
			);
			continue;
		}
		seen.add(relation.slug);
		if (relation.slug === annotation.slug) {
			problems.push(`${annotation.slug}: 自分自身への関係は付けられません`);
			continue;
		}
		const related = findPublished(posts, relation.slug);
		if (!related) {
			problems.push(
				`${annotation.slug}: 関係先 ${relation.slug} が公開済み記事にありません`,
			);
			continue;
		}
		if (related.published_at >= target.published_at) {
			problems.push(
				`${annotation.slug}: 関係先 ${relation.slug} は自分より後に公開された記事です（後方参照だけが許されます）`,
			);
		}
	}
	return problems;
}

/**
 * slug と visibility から、strata ディレクトリからの相対パスを返します。
 */
export function strataRelativePath(
	slug: string,
	visibility: PostVisibility,
): string {
	const fileName = `${slug}${STRATA_SUFFIX}`;
	return isPrivateVisibility(visibility)
		? `${PRIVATE_DIR}/${fileName}`
		: fileName;
}

/**
 * 注釈ファイルの置き場所が記事の visibility と合っているかを検査します。
 *
 * @returns 問題がなければ null、あれば理由
 */
export function checkStrataPlacement(
	relativePath: string,
	visibility: PostVisibility,
): string | null {
	const inPrivateDir = relativePath.startsWith(`${PRIVATE_DIR}/`);
	if (isPrivateVisibility(visibility) && !inPrivateDir) {
		return `${relativePath}: 限定記事（${visibility}）の注釈は ${STRATA_DIR}/${PRIVATE_DIR}/ に暗号化して置いてください`;
	}
	if (!isPrivateVisibility(visibility) && inPrivateDir) {
		return `${relativePath}: public の記事の注釈は ${STRATA_DIR}/ 直下に平文で置いてください`;
	}
	return null;
}

/**
 * 注釈ファイルが sops で暗号化済み（sops メタ情報があり、summary とすべての reason が ENC[...]）かを判定します。
 * JSON として解析できない内容は false を返します。
 */
export function isSopsEncryptedStrata(content: string): boolean {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		return false;
	}
	if (!isRecord(data) || !isRecord(data.sops)) {
		return false;
	}
	const encrypted = (value: unknown): boolean =>
		typeof value === "string" && SOPS_ENCRYPTED_VALUE_PATTERN.test(value);
	if (!encrypted(data.summary) || !Array.isArray(data.relations)) {
		return false;
	}
	return data.relations.every(
		(relation) => isRecord(relation) && encrypted(relation.reason),
	);
}

function publishedAsc(
	posts: readonly PublishedPost[],
): (PublishedPost & { published_at: string })[] {
	return posts
		.flatMap((post) =>
			post.status === "published" && post.published_at
				? [{ ...post, published_at: post.published_at }]
				: [],
		)
		.sort(
			(a, b) =>
				a.published_at.localeCompare(b.published_at) ||
				a.slug.localeCompare(b.slug),
		);
}

/**
 * 公開済みでまだ注釈が無い記事を、公開日の古い順に返します。
 */
export function listPendingPosts(
	posts: readonly PublishedPost[],
	annotatedSlugs: ReadonlySet<string>,
): PublishedPost[] {
	return publishedAsc(posts).filter((post) => !annotatedSlugs.has(post.slug));
}

/**
 * 対象記事より前に公開された記事を古い順に、注釈済みなら要約を付けて返します。
 * Claude Code はこの一覧から関係の候補を選び、候補だけ本文を読みます。
 *
 * @param targetSlug - 注釈を付けようとしている記事の slug（公開済みであること）
 */
export function buildCatalog(
	targetSlug: string,
	posts: readonly PublishedPost[],
	annotations: ReadonlyMap<string, StrataAnnotation>,
): CatalogEntry[] {
	const target = findPublished(posts, targetSlug);
	if (!target) {
		throw new Error(`${targetSlug}: 公開済み記事にありません`);
	}
	return publishedAsc(posts)
		.filter((post) => post.published_at < target.published_at)
		.map((post) => ({
			slug: post.slug,
			title: post.title,
			published_at: post.published_at,
			visibility: post.visibility,
			summary: annotations.get(post.slug)?.summary ?? null,
		}));
}

/**
 * `.post.json` の平文部分から注釈に必要なメタ情報を取り出します（lexical は読まない）。
 * 限定記事の暗号化済みファイルもメタ情報は平文なので、復号せずに扱えます。
 *
 * @param content - `.post.json` の内容
 * @param fileName - エラーメッセージ用のファイル名
 */
export function readPublishedPost(
	content: string,
	fileName: string,
): PublishedPost {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		throw new Error(`${fileName}: JSON として読めません`);
	}
	if (!isRecord(data)) {
		throw new Error(`${fileName}: JSON オブジェクトではありません`);
	}
	const status = data.status;
	if (status !== "draft" && status !== "published") {
		throw new Error(`${fileName}: 未対応の status です: ${String(status)}`);
	}
	const visibility = data.visibility ?? "public";
	if (!isPostVisibility(visibility)) {
		throw new Error(
			`${fileName}: 未対応の visibility です: ${String(visibility)}`,
		);
	}
	const post: PublishedPost = {
		slug: requireNonEmptyString(data, "slug", fileName),
		title: requireNonEmptyString(data, "title", fileName),
		status,
		visibility,
	};
	if (typeof data.published_at === "string" && data.published_at !== "") {
		post.published_at = data.published_at;
	}
	if (
		Array.isArray(data.tags) &&
		data.tags.every((tag) => typeof tag === "string")
	) {
		post.tags = data.tags;
	}
	if (typeof data.excerpt === "string" && data.excerpt !== "") {
		post.excerpt = data.excerpt;
	}
	return post;
}

function collectText(node: unknown, current: string[]): void {
	if (!isRecord(node)) {
		return;
	}
	if (typeof node.text === "string") {
		current.push(node.text);
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			collectText(child, current);
		}
	}
}

/**
 * Ghost の Lexical JSON から本文のプレーンテキストを取り出します（Claude Code が本文を読むときに使う）。
 * root 直下の各ブロック（段落・見出し・リストなど）を 1 行にし、文字を持たないブロック（画像・埋め込みなど）は省きます。
 * 書式・リンク先・カードの内容は捨てるため、往復には使えません。
 */
export function lexicalToText(lexical: Record<string, unknown>): string {
	const root = lexical.root;
	if (!isRecord(root) || !Array.isArray(root.children)) {
		throw new Error("lexical に root.children がありません");
	}
	const blocks: string[] = [];
	for (const block of root.children) {
		const current: string[] = [];
		collectText(block, current);
		const text = current.join("").trim();
		if (text !== "") {
			blocks.push(text);
		}
	}
	return blocks.join("\n");
}
