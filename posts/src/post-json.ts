/**
 * Ghost から取得した記事（Lexical 形式）とリポジトリに保存する JSON ファイルの相互変換
 *
 * 既存記事はブックマーク・埋め込みなど Markdown に対応物の無い Ghost カードを多用しているため、
 * 本文は Lexical JSON をそのまま保持して往復を無損失にします。
 * ファイル名は `<slug>.post.json` とし、push 時は lexical を一時ファイルに書き出して
 * ghst の `--lexical-file` で渡します。
 */
import {
	isPostStatus,
	optionalBoolean,
	optionalString,
	optionalStringList,
	type PostMeta,
	requireString,
} from "./post-file";

export const POST_JSON_SUFFIX = ".post.json";

/** リポジトリに保存する記事ファイルの内容 */
export interface PostJson extends PostMeta {
	/** 参考情報。push では送らない */
	published_at?: string;
	/** 参考情報。pull 時点の Ghost の更新日時。push では送らない */
	updated_at?: string;
	lexical: Record<string, unknown>;
}

export interface ParsedPostJson {
	meta: PostMeta;
	/** ghst の --lexical-file に渡す JSON 文字列 */
	lexical: string;
}

/**
 * Ghost Admin API の post オブジェクトから、リポジトリに保存する形に変換します。
 */
export function toPostJson(post: Record<string, unknown>): PostJson {
	if (typeof post.lexical !== "string") {
		throw new Error(`${String(post.slug)}: lexical が無い記事は扱えません`);
	}
	const status = post.status;
	if (!isPostStatus(status)) {
		throw new Error(
			`${String(post.slug)}: 未対応の status です: ${String(status)}`,
		);
	}
	const tags = Array.isArray(post.tags)
		? post.tags.map((tag) => String((tag as Record<string, unknown>).name))
		: [];

	const result: PostJson = {
		title: requireString(post, "title"),
		slug: requireString(post, "slug"),
		status,
		tags,
		lexical: JSON.parse(post.lexical) as Record<string, unknown>,
	};
	const excerpt = optionalString(post, "custom_excerpt");
	if (excerpt) result.excerpt = excerpt;
	const featureImage = optionalString(post, "feature_image");
	if (featureImage) result.feature_image = featureImage;
	const featured = optionalBoolean(post, "featured");
	if (featured !== undefined) result.featured = featured;
	const publishedAt = optionalString(post, "published_at");
	if (publishedAt) result.published_at = publishedAt;
	const updatedAt = optionalString(post, "updated_at");
	if (updatedAt) result.updated_at = updatedAt;

	// lexical を末尾に置き、メタ情報を先頭で読めるようにする
	const { lexical, ...meta } = result;
	return { ...meta, lexical };
}

/**
 * `<slug>.post.json` の内容を、push に渡すメタ情報と Lexical JSON 文字列に分けます。
 */
export function parsePostJson(
	content: string,
	fileName: string,
): ParsedPostJson {
	const data: unknown = JSON.parse(content);
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error(`${fileName}: JSON オブジェクトである必要があります`);
	}
	const record = data as Record<string, unknown>;
	const lexical = record.lexical;
	if (
		typeof lexical !== "object" ||
		lexical === null ||
		Array.isArray(lexical)
	) {
		throw new Error(`${fileName}: lexical はオブジェクトで指定してください`);
	}
	const status = record.status ?? "draft";
	if (!isPostStatus(status)) {
		throw new Error(
			`${fileName}: status は draft / published のいずれかにしてください`,
		);
	}

	const meta: PostMeta = {
		title: requireString(record, "title"),
		slug:
			optionalString(record, "slug") ?? fileName.replace(/\.post\.json$/, ""),
		status,
	};
	const tags = optionalStringList(record, "tags");
	if (tags) meta.tags = tags;
	const excerpt = optionalString(record, "excerpt");
	if (excerpt) meta.excerpt = excerpt;
	const featureImage = optionalString(record, "feature_image");
	if (featureImage) meta.feature_image = featureImage;
	const featured = optionalBoolean(record, "featured");
	if (featured !== undefined) meta.featured = featured;

	return { meta, lexical: JSON.stringify(lexical) };
}
