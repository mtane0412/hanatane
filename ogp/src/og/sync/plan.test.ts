/**
 * 事前生成の対象選定・描画パラメータ組み立て（純粋関数）のテスト
 */
import { describe, expect, it } from "vitest";
import { GRADIENT_PRESETS } from "@/types/ogp";
import {
	buildRenderParams,
	type GhostPost,
	gradientForSlug,
	selectPostsNeedingOgImage,
} from "./plan";

const 基本記事: GhostPost = {
	id: "post-1",
	slug: "workers-ogp",
	title: "Workers で OGP 画像を自動生成する",
	updated_at: "2026-09-09T10:00:00.000Z",
	feature_image: null,
	og_image: null,
	primary_author: { name: "たねのぶ" },
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

describe("selectPostsNeedingOgImage", () => {
	it("feature_image と og_image が両方無い記事だけを選ぶ", () => {
		const posts: GhostPost[] = [
			基本記事,
			{ ...基本記事, id: "post-2", feature_image: "https://example.com/a.jpg" },
			{ ...基本記事, id: "post-3", og_image: "https://example.com/og.png" },
			{ ...基本記事, id: "post-4", feature_image: "", og_image: "" },
		];
		expect(selectPostsNeedingOgImage(posts).map((p) => p.id)).toEqual([
			"post-1",
			"post-4",
		]);
	});
});

describe("buildRenderParams", () => {
	it("記事とサイト名から描画パラメータを組み立てる", () => {
		expect(buildRenderParams(基本記事, "はなしのタネ")).toEqual({
			title: "Workers で OGP 画像を自動生成する",
			siteName: "はなしのタネ",
			authorName: "たねのぶ",
			gradient: gradientForSlug("workers-ogp"),
		});
	});

	it("著者名が無い記事はエラーにする", () => {
		expect(() =>
			buildRenderParams({ ...基本記事, primary_author: null }, "はなしのタネ"),
		).toThrow(/著者/);
	});
});
