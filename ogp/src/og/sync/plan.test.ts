/**
 * 事前生成の対象選定・描画パラメータ組み立て（純粋関数）のテスト
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GRADIENT_PRESETS } from "@/types/ogp";
import {
	buildRenderParams,
	existingSocialImage,
	type GhostPost,
	gradientForSlug,
	selectGradient,
	selectPostsNeedingOgImage,
	TAG_GRADIENTS,
} from "./plan";

const 基本記事: GhostPost = {
	id: "post-1",
	slug: "workers-ogp",
	title: "Workers で OGP 画像を自動生成する",
	updated_at: "2026-09-09T10:00:00.000Z",
	feature_image: null,
	og_image: null,
	twitter_image: null,
	primary_author: { name: "たねのぶ" },
	tags: [{ slug: "tech" }],
};

describe("gradientForSlug", () => {
	it("同じ slug には常に同じプリセットを返す", () => {
		expect(gradientForSlug("workers-ogp")).toBe(gradientForSlug("workers-ogp"));
	});

	it("既知のプリセット名のみを返す", () => {
		for (const slug of ["a", "b", "c", "hello-world", "日本語スラッグ", ""]) {
			expect(Object.keys(GRADIENT_PRESETS)).toContain(gradientForSlug(slug));
		}
	});

	it("slug が違えばプリセットが分散する", () => {
		const presets = new Set(
			Array.from({ length: 40 }, (_, i) => gradientForSlug(`post-${i}`)),
		);
		expect(presets.size).toBeGreaterThan(1);
	});
});

describe("TAG_GRADIENTS", () => {
	it("対応表のタグはすべて統制語彙（posts/tags.json）に存在する", () => {
		// タグの slug を変えたときに、対応表が黙ってハッシュでの選択に落ちるのを防ぐ
		const { tags } = JSON.parse(
			readFileSync(
				new URL("../../../../posts/tags.json", import.meta.url),
				"utf8",
			),
		) as { tags: { slug: string }[] };
		const 統制語彙 = tags.map((tag) => tag.slug);
		for (const slug of Object.keys(TAG_GRADIENTS)) {
			expect(統制語彙).toContain(slug);
		}
	});
});

describe("selectGradient", () => {
	it("統制語彙のタグに対応するプリセットを選ぶ", () => {
		const 対応表 = {
			tech: "ocean",
			diary: "sunset",
			tanehouse: "orange",
			cat: "pink",
			hunting: "forest",
			game: "purple",
			reading: "green",
		};
		for (const [tag, gradient] of Object.entries(対応表)) {
			expect(selectGradient({ ...基本記事, tags: [{ slug: tag }] })).toEqual({
				gradient,
				source: "tag",
				tag,
			});
		}
	});

	it("タグを先頭から見て、最初に対応が見つかったものを採用する", () => {
		expect(
			selectGradient({
				...基本記事,
				tags: [{ slug: "ghost-tag" }, { slug: "cat" }, { slug: "tech" }],
			}),
		).toEqual({ gradient: "pink", source: "tag", tag: "cat" });
	});

	it("対応するタグが無い記事は slug のハッシュで選び、その旨を返す", () => {
		for (const tags of [[], [{ slug: "hash-quote" }]]) {
			expect(selectGradient({ ...基本記事, tags })).toEqual({
				gradient: gradientForSlug("workers-ogp"),
				source: "hash",
			});
		}
	});

	it("tags が取得できていない記事はエラーにする", () => {
		expect(() => selectGradient({ ...基本記事, tags: undefined })).toThrow(
			/include=.*tags/,
		);
	});
});

describe("selectPostsNeedingOgImage", () => {
	it("feature_image が無く、og_image か twitter_image が未設定の記事だけを選ぶ", () => {
		const posts: GhostPost[] = [
			基本記事,
			{ ...基本記事, id: "post-2", feature_image: "https://example.com/a.jpg" },
			{ ...基本記事, id: "post-3", og_image: "https://example.com/og.png" },
			{
				...基本記事,
				id: "post-4",
				feature_image: "",
				og_image: "",
				twitter_image: "",
			},
			{
				...基本記事,
				id: "post-5",
				og_image: "https://example.com/og.png",
				twitter_image: "https://example.com/og.png",
			},
		];
		expect(selectPostsNeedingOgImage(posts).map((p) => p.id)).toEqual([
			"post-1",
			"post-3",
			"post-4",
		]);
	});
});

describe("existingSocialImage", () => {
	it("og_image、次いで twitter_image を返し、どちらも無ければ null", () => {
		expect(existingSocialImage(基本記事)).toBeNull();
		expect(
			existingSocialImage({
				...基本記事,
				twitter_image: "https://example.com/tw.png",
			}),
		).toBe("https://example.com/tw.png");
		expect(
			existingSocialImage({
				...基本記事,
				og_image: "https://example.com/og.png",
				twitter_image: "https://example.com/tw.png",
			}),
		).toBe("https://example.com/og.png");
	});
});

describe("buildRenderParams", () => {
	it("記事とサイト名から描画パラメータを組み立てる", () => {
		expect(buildRenderParams(基本記事, "はなしのタネ", "ocean")).toEqual({
			title: "Workers で OGP 画像を自動生成する",
			siteName: "はなしのタネ",
			authorName: "たねのぶ",
			gradient: "ocean",
		});
	});

	it("著者名が無い記事はエラーにする", () => {
		expect(() =>
			buildRenderParams(
				{ ...基本記事, primary_author: null },
				"はなしのタネ",
				"ocean",
			),
		).toThrow(/著者/);
	});
});
