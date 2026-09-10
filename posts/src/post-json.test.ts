/**
 * Ghost から取得した記事（Lexical 形式）と、リポジトリに保存する JSON ファイルの相互変換のテスト
 */
import { describe, expect, it } from "vitest";
import { parsePostJson, toPostJson } from "./post-json";

const Ghostの記事 = {
	id: "67d97940caff7b00011ec0ff",
	slug: "why-ghost",
	title: "なぜブログプラットフォームにGhostを選んだか",
	status: "published",
	custom_excerpt: "Ghostを選定した理由を話します。",
	feature_image: "https://example.com/cat.jpg",
	featured: false,
	published_at: "2023-04-02T22:00:08.000Z",
	updated_at: "2024-01-08T09:47:24.000Z",
	tags: [
		{ name: "技術の話", slug: "tech" },
		{ name: "#Import 2025-03-18", slug: "hash-import" },
	],
	lexical: '{"root":{"children":[],"type":"root","version":1}}',
	html: "<p>使わない</p>",
};

describe("toPostJson", () => {
	it("push に必要なメタ情報と、オブジェクトに戻した lexical だけを取り出す", () => {
		expect(toPostJson(Ghostの記事)).toEqual({
			title: "なぜブログプラットフォームにGhostを選んだか",
			slug: "why-ghost",
			status: "published",
			tags: ["技術の話", "#Import 2025-03-18"],
			excerpt: "Ghostを選定した理由を話します。",
			feature_image: "https://example.com/cat.jpg",
			featured: false,
			published_at: "2023-04-02T22:00:08.000Z",
			updated_at: "2024-01-08T09:47:24.000Z",
			lexical: { root: { children: [], type: "root", version: 1 } },
		});
	});

	it("null の項目は出力に含めない", () => {
		const result = toPostJson({
			...Ghostの記事,
			custom_excerpt: null,
			feature_image: null,
			published_at: null,
		});
		expect(result).not.toHaveProperty("excerpt");
		expect(result).not.toHaveProperty("feature_image");
		expect(result).not.toHaveProperty("published_at");
	});

	it("lexical が無い記事はエラーになる", () => {
		expect(() => toPostJson({ ...Ghostの記事, lexical: null })).toThrow(
			/lexical/,
		);
	});
});

describe("parsePostJson", () => {
	const ファイル内容 = JSON.stringify(toPostJson(Ghostの記事));

	it("meta（push に渡す項目）と lexical（JSON 文字列）に分ける", () => {
		const result = parsePostJson(ファイル内容, "why-ghost.post.json");
		expect(result.meta).toEqual({
			title: "なぜブログプラットフォームにGhostを選んだか",
			slug: "why-ghost",
			status: "published",
			tags: ["技術の話", "#Import 2025-03-18"],
			excerpt: "Ghostを選定した理由を話します。",
			feature_image: "https://example.com/cat.jpg",
			featured: false,
		});
		expect(JSON.parse(result.lexical)).toEqual({
			root: { children: [], type: "root", version: 1 },
		});
	});

	it("slug を省略した場合はファイル名（.post.json を除いたもの）を使う", () => {
		const content = JSON.stringify({ title: "t", lexical: { root: {} } });
		expect(parsePostJson(content, "from-file.post.json").meta.slug).toBe(
			"from-file",
		);
	});

	it("title が無い場合はエラーになる", () => {
		const content = JSON.stringify({ lexical: { root: {} } });
		expect(() => parsePostJson(content, "a.post.json")).toThrow(/title/);
	});

	it("lexical がオブジェクトでない場合はエラーになる", () => {
		const content = JSON.stringify({ title: "t", lexical: "text" });
		expect(() => parsePostJson(content, "a.post.json")).toThrow(/lexical/);
	});
});
