/**
 * OGP 画像生成エンドポイントのクエリパラメータ解析テスト
 */
import { describe, expect, it } from "vitest";
import { OgpParamError, parseOgpParams } from "./params";

describe("parseOgpParams", () => {
	it("title だけを渡すと既定値で補完される", () => {
		const params = parseOgpParams(new URLSearchParams({ title: "テスト記事" }));
		expect(params).toEqual({
			title: "テスト記事",
			siteName: "はなしのタネ",
			authorName: "たねのぶ",
			gradient: "purple",
		});
	});

	it("すべてのパラメータを明示的に渡せる", () => {
		const params = parseOgpParams(
			new URLSearchParams({
				title: "Workers で OGP を生成する",
				site: "別のサイト",
				author: "別の著者",
				gradient: "ocean",
			}),
		);
		expect(params).toEqual({
			title: "Workers で OGP を生成する",
			siteName: "別のサイト",
			authorName: "別の著者",
			gradient: "ocean",
		});
	});

	it("title が無いと OgpParamError を投げる", () => {
		expect(() => parseOgpParams(new URLSearchParams())).toThrow(OgpParamError);
	});

	it("title が空白のみでも OgpParamError を投げる", () => {
		expect(() => parseOgpParams(new URLSearchParams({ title: "   " }))).toThrow(
			OgpParamError,
		);
	});

	it("未知の gradient は OgpParamError を投げる", () => {
		expect(() =>
			parseOgpParams(new URLSearchParams({ title: "x", gradient: "rainbow" })),
		).toThrow(OgpParamError);
	});

	it("長すぎる title は OgpParamError を投げる", () => {
		expect(() =>
			parseOgpParams(new URLSearchParams({ title: "あ".repeat(201) })),
		).toThrow(OgpParamError);
	});
});
