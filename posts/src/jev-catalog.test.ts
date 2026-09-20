/**
 * `strata catalog` の一覧に、Jev が判定した「関係がある確率」を付ける処理のテスト
 *
 * 確率は関係の候補選びの補助で、関係を採用するかは Claude Code が本文を読んで決める。
 * 限定記事の要約は外部の API に送らないので、判定の対象から外す。
 */
import { describe, expect, it } from "vitest";
import {
	checkJevSummaryPath,
	rankCatalog,
	selectJevCandidates,
} from "./jev-catalog";
import type { CatalogEntry, PublishedPost } from "./strata";

const 古民家を買った: CatalogEntry = {
	slug: "tanehouse-2023",
	title: "古民家を買った",
	published_at: "2023-04-01T00:00:00.000Z",
	visibility: "public",
	summary: "古民家を購入し、たねハウスと名付けた経緯を書いた。",
};
const 会員向けの近況: CatalogEntry = {
	slug: "members-letter",
	title: "会員向けの近況",
	published_at: "2023-08-01T00:00:00.000Z",
	visibility: "members",
	summary: "会員だけに向けて近況を書いた。",
};
const 注釈が無い記事: CatalogEntry = {
	slug: "gw2023",
	title: "2023 年の連休",
	published_at: "2023-05-05T00:00:00.000Z",
	visibility: "public",
	summary: null,
};
const 猫を迎えた: CatalogEntry = {
	slug: "welcome-cat",
	title: "猫を迎えた",
	published_at: "2024-06-01T00:00:00.000Z",
	visibility: "public",
	summary: "保護猫を迎えた。",
};

const 対象記事: PublishedPost = {
	slug: "window-film",
	title: "窓にフィルムを貼った",
	status: "published",
	visibility: "public",
	published_at: "2024-08-01T00:00:00.000Z",
};

describe("selectJevCandidates", () => {
	it("公開記事で要約があるものだけを判定の対象にする", () => {
		const candidates = selectJevCandidates(対象記事, [
			古民家を買った,
			会員向けの近況,
			注釈が無い記事,
			猫を迎えた,
		]);
		expect(candidates.map((entry) => entry.slug)).toEqual([
			"tanehouse-2023",
			"welcome-cat",
		]);
	});

	it("対象が限定記事なら、要約を外部に送らないようエラーにする", () => {
		expect(() =>
			selectJevCandidates({ ...対象記事, visibility: "members" }, [
				古民家を買った,
			]),
		).toThrow("window-film");
	});
});

describe("rankCatalog", () => {
	it("確率を付けて高い順に並べ、判定していない記事は null にして元の順のまま末尾に置く", () => {
		const ranked = rankCatalog(
			[古民家を買った, 注釈が無い記事, 会員向けの近況, 猫を迎えた],
			new Map([
				["tanehouse-2023", 0.4],
				["welcome-cat", 0.9],
			]),
		);
		expect(ranked.map((entry) => [entry.slug, entry.jev_probability])).toEqual([
			["welcome-cat", 0.9],
			["tanehouse-2023", 0.4],
			["gw2023", null],
			["members-letter", null],
		]);
	});

	it("一覧のほかの項目（title や summary）はそのまま残す", () => {
		const [entry] = rankCatalog(
			[古民家を買った],
			new Map([["tanehouse-2023", 0.4]]),
		);
		expect(entry).toEqual({ ...古民家を買った, jev_probability: 0.4 });
	});
});

describe("checkJevSummaryPath", () => {
	const postsDir = "/repo/posts";

	it("限定記事の置き場所の外にある要約ファイルは受け付ける", () => {
		expect(() =>
			checkJevSummaryPath("/tmp/scratchpad/summary.txt", postsDir),
		).not.toThrow();
	});

	it("限定記事の注釈の平文作業ファイルは、外部に送らないようエラーにする", () => {
		expect(() =>
			checkJevSummaryPath(
				"/repo/posts/strata/private/members-letter.plain.json",
				postsDir,
			),
		).toThrow("strata/private");
	});

	it("限定記事の本文の置き場所にあるファイルも、相対パスで指定されてもエラーにする", () => {
		expect(() =>
			checkJevSummaryPath(
				"/repo/posts/strata/../content/private/members-letter.md",
				postsDir,
			),
		).toThrow("content/private");
	});
});
