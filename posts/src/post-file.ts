/**
 * 記事 Markdown ファイル（frontmatter 付き）の解析と、ghst に渡す引数の組み立て
 *
 * ghst の `--markdown-file` / `--markdown-stdin` は frontmatter を解釈せず本文として扱うため、
 * このモジュールで frontmatter を取り除き、メタ情報は ghst のフラグに変換します。
 */
import { parse as parseYaml } from "yaml";

/** 記事の公開状態。scheduled は ghst の `post schedule` で扱うため、ここでは対象外にしています。 */
export type PostStatus = "draft" | "published";

/**
 * 記事の閲覧範囲。Ghost の visibility のうち public / members / paid だけを扱い、
 * tiers（特定ティア限定）は未対応としてエラーにします。
 */
export type PostVisibility = "public" | "members" | "paid";

/** frontmatter で指定できる記事のメタ情報 */
export interface PostMeta {
	title: string;
	slug: string;
	status: PostStatus;
	/**
	 * 省略不可。push では常に `--visibility` を明示して送り、
	 * create が Ghost の既定値（public）に落ちて限定記事が公開されるのを防ぎます。
	 */
	visibility: PostVisibility;
	tags?: string[];
	excerpt?: string;
	feature_image?: string;
	featured?: boolean;
}

/**
 * 本文の渡し方。Markdown は stdin、Lexical はファイルパスで ghst に渡します。
 */
export type ContentSource =
	| { kind: "markdown-stdin" }
	| { kind: "lexical-file"; path: string };

export interface ParsedPostFile {
	meta: PostMeta;
	body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const POST_STATUSES: readonly PostStatus[] = ["draft", "published"];
export const POST_VISIBILITIES: readonly PostVisibility[] = [
	"public",
	"members",
	"paid",
];

export function isPostStatus(value: unknown): value is PostStatus {
	return (
		typeof value === "string" &&
		(POST_STATUSES as readonly string[]).includes(value)
	);
}

export function isPostVisibility(value: unknown): value is PostVisibility {
	return (
		typeof value === "string" &&
		(POST_VISIBILITIES as readonly string[]).includes(value)
	);
}

/**
 * ファイルの `visibility` を検証します。省略時は public です。
 *
 * @param record - frontmatter または JSON のオブジェクト
 * @param fileName - エラーメッセージに使うファイル名
 */
export function parseVisibility(
	record: Record<string, unknown>,
	fileName: string,
): PostVisibility {
	const visibility = record.visibility ?? "public";
	if (!isPostVisibility(visibility)) {
		throw new Error(
			`${fileName}: visibility は ${POST_VISIBILITIES.join(" / ")} のいずれかにしてください`,
		);
	}
	return visibility;
}

export function requireString(
	data: Record<string, unknown>,
	key: string,
): string {
	const value = data[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`frontmatter の ${key} は必須の文字列です`);
	}
	return value;
}

export function optionalString(
	data: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = data[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`frontmatter の ${key} は文字列で指定してください`);
	}
	return value;
}

export function optionalStringList(
	data: Record<string, unknown>,
	key: string,
): string[] | undefined {
	const value = data[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		throw new Error(`frontmatter の ${key} は文字列の配列で指定してください`);
	}
	return value;
}

export function optionalBoolean(
	data: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = data[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`frontmatter の ${key} は true / false で指定してください`);
	}
	return value;
}

/**
 * 記事ファイルの内容を frontmatter（meta）と本文（body）に分けます。
 *
 * @param content - Markdown ファイルの内容
 * @param fileName - slug の既定値に使うファイル名（拡張子は除去する）
 */
export function parsePostFile(
	content: string,
	fileName: string,
): ParsedPostFile {
	const match = FRONTMATTER_PATTERN.exec(content);
	if (!match) {
		throw new Error(
			`${fileName}: 先頭に frontmatter（--- で囲んだ YAML）が必要です`,
		);
	}
	const data: unknown = parseYaml(match[1]);
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error(
			`${fileName}: frontmatter は key: value 形式で記述してください`,
		);
	}
	const record = data as Record<string, unknown>;

	const status = record.status ?? "draft";
	if (!isPostStatus(status)) {
		throw new Error(
			`${fileName}: status は ${POST_STATUSES.join(" / ")} のいずれかにしてください`,
		);
	}

	const meta: PostMeta = {
		title: requireString(record, "title"),
		slug: optionalString(record, "slug") ?? fileName.replace(/\.md$/, ""),
		status,
		visibility: parseVisibility(record, fileName),
	};
	const tags = optionalStringList(record, "tags");
	if (tags) meta.tags = tags;
	const excerpt = optionalString(record, "excerpt");
	if (excerpt) meta.excerpt = excerpt;
	const featureImage = optionalString(record, "feature_image");
	if (featureImage) meta.feature_image = featureImage;
	const featured = optionalBoolean(record, "featured");
	if (featured !== undefined) meta.featured = featured;

	return {
		meta,
		body: content.slice(match[0].length).replace(/^(\r?\n)+/, ""),
	};
}

/**
 * ghst の `post create` / `post update` に渡す引数を組み立てます。
 *
 * - update では `--slug` が既存記事の検索キーとして使われます（ghst は patch には含めない）。
 * - create には `--slug` オプションが無い（ghst 0.17.1）ため、`{ "slug": ... }` を書いた JSON ファイルを
 *   `--from-json` で渡します。ghst はこの JSON をペイロードの土台にし、他のフラグを上書きします。
 *
 * @param action - create（新規作成）または update（既存記事の更新）
 * @param meta - frontmatter や JSON ファイルから取り出したメタ情報
 * @param source - 本文の渡し方（Markdown は stdin、Lexical はファイル）
 * @param slugJsonPath - create のときに必須。`{ "slug": meta.slug }` を書き出したファイルのパス
 */
export function buildGhstArgs(
	action: "update",
	meta: PostMeta,
	source: ContentSource,
): string[];
export function buildGhstArgs(
	action: "create",
	meta: PostMeta,
	source: ContentSource,
	slugJsonPath: string,
): string[];
export function buildGhstArgs(
	action: "create" | "update",
	meta: PostMeta,
	source: ContentSource,
	slugJsonPath?: string,
): string[] {
	const args = ["post", action];
	if (action === "update") {
		args.push("--slug", meta.slug);
	}
	if (source.kind === "markdown-stdin") {
		args.push("--markdown-stdin");
	} else {
		args.push("--lexical-file", source.path);
	}
	if (action === "create") {
		if (!slugJsonPath) {
			throw new Error(
				"create には slug を書いた JSON ファイルのパスが必要です",
			);
		}
		args.push("--from-json", slugJsonPath);
	}
	args.push(
		"--title",
		meta.title,
		"--status",
		meta.status,
		"--visibility",
		meta.visibility,
	);
	if (meta.tags && meta.tags.length > 0) {
		args.push("--tags", meta.tags.join(","));
	}
	if (meta.excerpt) {
		args.push("--excerpt", meta.excerpt);
	}
	if (meta.feature_image) {
		args.push("--feature-image", meta.feature_image);
	}
	if (meta.featured !== undefined) {
		// create は値を取らないフラグ、update は true|false を取る仕様の違いを吸収する
		if (action === "create") {
			if (meta.featured) args.push("--featured");
		} else {
			args.push("--featured", String(meta.featured));
		}
	}
	return args;
}
