/**
 * 公開前の整備（研究者が slug・excerpt・tags を整える工程）のルールのテスト
 *
 * 判断そのもの（どのタグを選ぶか、どんな要約を書くか）は Claude Code のセッションが行い、
 * このモジュールは統制語彙の形式、記事のタグが語彙に収まっているか、
 * 新しい slug の形式、公開前の記事が基準を満たしているかを検査する。
 */
import { describe, expect, it } from "vitest";
import {
	checkNewSlug,
	checkPostTags,
	checkPublishReadiness,
	countCharacters,
	EXCERPT_MAX_LENGTH,
	isInternalTag,
	parseTagVocabulary,
	planTagSync,
	type TagVocabularyEntry,
} from "./curate";
import type { PublishedPost } from "./strata";

const 語彙: TagVocabularyEntry[] = [
	{ name: "技術の話", slug: "tech", description: "開発・Ghost 運用・ツール" },
	{ name: "猫の話", slug: "cat", description: "猫" },
];

const 下書き: PublishedPost = {
	slug: "20260910-hyperstrata-design",
	title: "Hyperstrataの地層を考える",
	status: "draft",
	visibility: "public",
	tags: ["技術の話"],
	excerpt:
		"Hyperstrata の地層の設計、注釈の置き場所、引用との違いについて話しました。",
};

describe("parseTagVocabulary", () => {
	it("name・slug・description を持つ一覧を読み込む", () => {
		const content = JSON.stringify({ tags: 語彙 });
		expect(parseTagVocabulary(content, "tags.json")).toEqual(語彙);
	});

	it("JSON として読めなければエラーにする", () => {
		expect(() => parseTagVocabulary("{", "tags.json")).toThrow(
			"tags.json: JSON として読めません",
		);
	});

	it("tags が配列でなければエラーにする", () => {
		expect(() => parseTagVocabulary("{}", "tags.json")).toThrow(
			"tags.json: tags は配列にしてください",
		);
	});

	it("name が重複していればエラーにする", () => {
		const content = JSON.stringify({
			tags: [
				{ name: "猫の話", slug: "cat", description: "猫" },
				{ name: "猫の話", slug: "cats", description: "猫" },
			],
		});
		expect(() => parseTagVocabulary(content, "tags.json")).toThrow(
			"tags.json: tags[1]: name が重複しています: 猫の話",
		);
	});

	it("slug が重複していればエラーにする", () => {
		const content = JSON.stringify({
			tags: [
				{ name: "猫の話", slug: "cat", description: "猫" },
				{ name: "猫", slug: "cat", description: "猫" },
			],
		});
		expect(() => parseTagVocabulary(content, "tags.json")).toThrow(
			"tags.json: tags[1]: slug が重複しています: cat",
		);
	});

	it("slug が英小文字・数字・ハイフン以外を含めばエラーにする", () => {
		const content = JSON.stringify({
			tags: [{ name: "猫の話", slug: "mao-nohua_", description: "猫" }],
		});
		expect(() => parseTagVocabulary(content, "tags.json")).toThrow(
			"tags.json: tags[0]: slug は英小文字・数字・ハイフンだけにしてください: mao-nohua_",
		);
	});

	it("description が空ならエラーにする", () => {
		const content = JSON.stringify({
			tags: [{ name: "猫の話", slug: "cat", description: "" }],
		});
		expect(() => parseTagVocabulary(content, "tags.json")).toThrow(
			"tags.json: tags[0]: description は空でない文字列にしてください",
		);
	});

	it("# で始まる内部タグは語彙に入れられない", () => {
		const content = JSON.stringify({
			tags: [{ name: "#ref-cat", slug: "hash-ref-cat", description: "引用" }],
		});
		expect(() => parseTagVocabulary(content, "tags.json")).toThrow(
			"tags.json: tags[0]: # で始まる内部タグは語彙に入れません: #ref-cat",
		);
	});
});

describe("isInternalTag", () => {
	it("# で始まるタグを内部タグとみなす", () => {
		expect(isInternalTag("#ref-window-film")).toBe(true);
		expect(isInternalTag("#Import 2025-03-18 13:46")).toBe(true);
		expect(isInternalTag("技術の話")).toBe(false);
	});
});

describe("checkPostTags", () => {
	it("すべての記事のタグが語彙にあれば問題なし", () => {
		const posts: PublishedPost[] = [
			{ ...下書き, tags: ["技術の話", "猫の話", "#ref-window-film"] },
		];
		expect(checkPostTags(posts, 語彙)).toEqual([]);
	});

	it("語彙に無いタグを持つ記事を指摘する", () => {
		const posts: PublishedPost[] = [
			{ ...下書き, slug: "welcome-cat", tags: ["猫の話", "Manga"] },
		];
		expect(checkPostTags(posts, 語彙)).toEqual([
			"welcome-cat: 統制語彙（tags.json）に無いタグが付いています: Manga",
		]);
	});

	it("タグの無い記事は指摘しない（公開前の検査は checkPublishReadiness が行う）", () => {
		const posts: PublishedPost[] = [{ ...下書き, tags: undefined }];
		expect(checkPostTags(posts, 語彙)).toEqual([]);
	});
});

describe("planTagSync", () => {
	it("Ghost に無いタグは語彙の slug で作成する", () => {
		expect(planTagSync(語彙, [{ name: "技術の話", slug: "tech" }])).toEqual([
			{ kind: "create", name: "猫の話", slug: "cat" },
		]);
	});

	it("Ghost 側の slug が語彙と違えば slug を変更する（中国語読みの slug を直す）", () => {
		expect(
			planTagSync(語彙, [
				{ name: "技術の話", slug: "tech" },
				{ name: "猫の話", slug: "mao-nohua" },
			]),
		).toEqual([
			{ kind: "update-slug", name: "猫の話", from: "mao-nohua", to: "cat" },
		]);
	});

	it("一致していれば何もしない。語彙に無い Ghost のタグには触れない", () => {
		expect(
			planTagSync(語彙, [
				{ name: "技術の話", slug: "tech" },
				{ name: "猫の話", slug: "cat" },
				{ name: "Manga", slug: "manga" },
				{ name: "#ref-window-film", slug: "hash-ref-window-film" },
			]),
		).toEqual([]);
	});

	it("語彙の slug が別の名前のタグで既に使われていればエラーにする", () => {
		expect(() =>
			planTagSync(語彙, [
				{ name: "技術の話", slug: "tech" },
				{ name: "猫", slug: "cat" },
			]),
		).toThrow("猫の話: slug cat は Ghost で別のタグ（猫）に使われています");
	});
});

describe("checkNewSlug", () => {
	it("公開日（YYYYMMDD）と英語の題材をハイフンでつないだ形式を受け付ける", () => {
		expect(checkNewSlug("20260910-hyperstrata-design")).toBeNull();
		expect(checkNewSlug("20260228-first-hunt")).toBeNull();
	});

	it("日付の無い slug は拒む", () => {
		expect(checkNewSlug("hyperstrata-design")).toBe(
			"hyperstrata-design: slug は YYYYMMDD-<英語の題材> の形式にしてください（例: 20260910-hyperstrata-design）",
		);
	});

	it("日付だけの slug は拒む", () => {
		expect(checkNewSlug("20260910")).toBe(
			"20260910: slug は YYYYMMDD-<英語の題材> の形式にしてください（例: 20260910-hyperstrata-design）",
		);
	});

	it("大文字・アンダースコア・連続ハイフンを含む slug は拒む", () => {
		expect(checkNewSlug("20260910-Hyperstrata")).not.toBeNull();
		expect(checkNewSlug("20260910-hyper_strata")).not.toBeNull();
		expect(checkNewSlug("20260910--hyperstrata")).not.toBeNull();
		expect(checkNewSlug("20260910-hyperstrata-")).not.toBeNull();
	});

	it("存在しない日付は拒む", () => {
		expect(checkNewSlug("20261340-hyperstrata")).toBe(
			"20261340-hyperstrata: slug の日付が正しくありません: 20261340",
		);
		expect(checkNewSlug("20260230-hyperstrata")).toBe(
			"20260230-hyperstrata: slug の日付が正しくありません: 20260230",
		);
	});
});

describe("countCharacters", () => {
	it("サロゲートペアの文字も 1 字として数える", () => {
		expect(countCharacters("猫🐈")).toBe(2);
		expect(countCharacters("")).toBe(0);
	});
});

describe("checkPublishReadiness", () => {
	it("基準を満たす下書きは問題なし", () => {
		expect(checkPublishReadiness(下書き, 語彙)).toEqual([]);
	});

	it("公開済みの記事は整備の対象にしない（slug は公開後に変えられない）", () => {
		const post: PublishedPost = {
			...下書き,
			status: "published",
			published_at: "2026-09-10T12:24:41.000Z",
		};
		expect(checkPublishReadiness(post, 語彙)).toEqual([
			`${下書き.slug}: 公開済みの記事です。整備は下書きのうちに行ってください`,
		]);
	});

	it("slug の形式、excerpt の有無と長さ、タグの有無と語彙をまとめて指摘する", () => {
		const post: PublishedPost = {
			...下書き,
			slug: "hyperstratanodi-ceng",
			tags: ["#ref-window-film"],
			excerpt: undefined,
		};
		expect(checkPublishReadiness(post, 語彙)).toEqual([
			"hyperstratanodi-ceng: slug は YYYYMMDD-<英語の題材> の形式にしてください（例: 20260910-hyperstrata-design）",
			"hyperstratanodi-ceng: excerpt がありません",
			"hyperstratanodi-ceng: 統制語彙のタグを 1 つ以上付けてください",
		]);
	});

	it(`excerpt が ${String(EXCERPT_MAX_LENGTH)} 字を超えれば指摘する`, () => {
		const post: PublishedPost = {
			...下書き,
			excerpt: "あ".repeat(EXCERPT_MAX_LENGTH + 1),
		};
		expect(checkPublishReadiness(post, 語彙)).toEqual([
			`${下書き.slug}: excerpt は ${String(EXCERPT_MAX_LENGTH)} 字以内にしてください（現在 ${String(EXCERPT_MAX_LENGTH + 1)} 字）`,
		]);
	});

	it("語彙に無いタグを指摘する", () => {
		const post: PublishedPost = { ...下書き, tags: ["Manga"] };
		expect(checkPublishReadiness(post, 語彙)).toEqual([
			`${下書き.slug}: 統制語彙（tags.json）に無いタグが付いています: Manga`,
		]);
	});
});
