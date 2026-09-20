/**
 * Hyperstrata の関係の強さ（strata-strength.json）の読み書きと、計算が要る関係の洗い出しのテスト
 *
 * 強さは注釈（strata/<slug>.json）を書き換えずに別ファイルに置く。
 * Jev に聞くのは、まだ強さが無い公開記事どうしの関係だけ（計算済みの値は聞き直さない）。
 */
import { describe, expect, it } from "vitest";
import type { PublishedPost, StrataAnnotation } from "./strata";
import {
	parseStrengthFile,
	planStrengthUpdate,
	selectStrengthTargets,
	serializeStrengthFile,
} from "./strata-strength";

function 記事(
	slug: string,
	title: string,
	visibility: PublishedPost["visibility"] = "public",
): PublishedPost {
	return {
		slug,
		title,
		status: "published",
		visibility,
		published_at: "2024-01-10T00:00:00.000Z",
	};
}

function 注釈(
	slug: string,
	summary: string,
	relations: StrataAnnotation["relations"] = [],
): StrataAnnotation {
	return {
		slug,
		summary,
		relations,
		annotator: "claude-fable-5-1",
		annotated_at: "2026-09-20T00:00:00.000Z",
		icon: null,
	};
}

describe("selectStrengthTargets", () => {
	it("公開記事どうしの関係を、両方の記事のタイトルと要約つきで返す", () => {
		const posts = [
			記事("tanehouse-2023", "古民家を買った"),
			記事("window-film", "窓にフィルムを貼った"),
		];
		const annotations = new Map([
			["tanehouse-2023", 注釈("tanehouse-2023", "古民家を購入した。")],
			[
				"window-film",
				注釈("window-film", "窓に断熱フィルムを貼った。", [
					{
						slug: "tanehouse-2023",
						type: "continues",
						reason: "たねハウスの改修の続き",
					},
				]),
			],
		]);
		const targets = selectStrengthTargets(posts, annotations);
		expect(targets).toEqual([
			{
				newer: {
					slug: "window-film",
					title: "窓にフィルムを貼った",
					published_at: "2024-01-10T00:00:00.000Z",
					summary: "窓に断熱フィルムを貼った。",
				},
				older: {
					slug: "tanehouse-2023",
					title: "古民家を買った",
					published_at: "2024-01-10T00:00:00.000Z",
					summary: "古民家を購入した。",
				},
			},
		]);
	});

	it("相手が公開記事の注釈に無い関係（限定記事など、要約を送れない相手）は対象にしない", () => {
		// 前提: members-diary は限定記事なので、公開記事の注釈（strata/ 直下）には無い
		const posts = [
			記事("members-diary", "メンバー向けの日記", "members"),
			記事("window-film", "窓にフィルムを貼った"),
		];
		const annotations = new Map([
			[
				"window-film",
				注釈("window-film", "窓に断熱フィルムを貼った。", [
					{ slug: "members-diary", type: "continues", reason: "日記の続き" },
				]),
			],
		]);
		expect(selectStrengthTargets(posts, annotations)).toEqual([]);
	});

	it("公開記事の注釈に限定記事が混ざっていたら、外部の API に送らないようエラーにする", () => {
		const posts = [記事("members-diary", "メンバー向けの日記", "members")];
		const annotations = new Map([
			["members-diary", 注釈("members-diary", "メンバー向けの近況。")],
		]);
		expect(() => selectStrengthTargets(posts, annotations)).toThrow(
			"members-diary: 限定記事の注釈が公開記事の注釈に混ざっています",
		);
	});
});

describe("parseStrengthFile", () => {
	it("関係ごとの強さ（from / to / strength / model）を読む", () => {
		const content = JSON.stringify({
			strengths: [
				{
					from: "window-film",
					to: "tanehouse-2023",
					strength: 0.82,
					model: "jev-1.13.0",
				},
			],
		});
		expect(parseStrengthFile(content, "strata-strength.json")).toEqual([
			{
				from: "window-film",
				to: "tanehouse-2023",
				strength: 0.82,
				model: "jev-1.13.0",
			},
		]);
	});

	it("strength が 0〜1 の数値でなければエラーにする", () => {
		const content = JSON.stringify({
			strengths: [
				{
					from: "window-film",
					to: "tanehouse-2023",
					strength: 1.2,
					model: "jev-1.13.0",
				},
			],
		});
		expect(() => parseStrengthFile(content, "strata-strength.json")).toThrow(
			"strata-strength.json: strengths[0].strength は 0〜1 の数値にしてください",
		);
	});

	it("同じ組（from, to）が 2 回あればエラーにする", () => {
		const 窓から古民家 = {
			from: "window-film",
			to: "tanehouse-2023",
			strength: 0.8,
			model: "jev-1.13.0",
		};
		const content = JSON.stringify({ strengths: [窓から古民家, 窓から古民家] });
		expect(() => parseStrengthFile(content, "strata-strength.json")).toThrow(
			"strata-strength.json: window-film → tanehouse-2023 が重複しています",
		);
	});
});

describe("planStrengthUpdate", () => {
	// 前提: 公開記事の注釈にある関係は 2 本。うち 1 本は計算済み
	const 関係 = [
		{ from: "window-film", to: "tanehouse-2023" },
		{ from: "welcome-cat", to: "tanehouse-2023" },
	];
	const 計算済み = [
		{
			from: "window-film",
			to: "tanehouse-2023",
			strength: 0.82,
			model: "jev-1.13.0",
		},
	];

	it("計算済みの強さは残し、強さが無い関係だけを Jev に聞く対象にする", () => {
		expect(planStrengthUpdate(関係, 計算済み)).toEqual({
			kept: 計算済み,
			missing: [{ from: "welcome-cat", to: "tanehouse-2023" }],
		});
	});

	it("注釈から消えた関係の強さは捨てる（再検討で関係が外れた場合）", () => {
		const 消えた関係の強さ = {
			from: "welcome-cat",
			to: "window-film",
			strength: 0.1,
			model: "jev-1.13.0",
		};
		const plan = planStrengthUpdate(関係, [...計算済み, 消えた関係の強さ]);
		expect(plan.kept).toEqual(計算済み);
	});
});

describe("serializeStrengthFile", () => {
	it("from → to の順に並べ、強さを小数 2 桁に丸めて、差分の出にくい JSON にする", () => {
		const text = serializeStrengthFile([
			{
				from: "window-film",
				to: "tanehouse-2023",
				strength: 0.8249,
				model: "jev-1.13.0",
			},
			{
				from: "welcome-cat",
				to: "tanehouse-2023",
				strength: 0.3,
				model: "jev-1.13.0",
			},
		]);
		expect(text.endsWith("\n")).toBe(true);
		expect(JSON.parse(text)).toEqual({
			strengths: [
				{
					from: "welcome-cat",
					to: "tanehouse-2023",
					strength: 0.3,
					model: "jev-1.13.0",
				},
				{
					from: "window-film",
					to: "tanehouse-2023",
					strength: 0.82,
					model: "jev-1.13.0",
				},
			],
		});
	});
});
