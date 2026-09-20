/**
 * Jev による Hyperstrata の関係候補の絞り込みを、既存の注釈の関係を正解にして測る評価のテスト
 *
 * strata-annotate スキルでは、Claude Code が過去記事の一覧から関係の候補を最大 8 本選ぶ。
 * その候補選びを Jev の確率の順位で代替・補助できるかを、既知の関係が上位に入る割合で測る。
 */
import { describe, expect, it } from "vitest";
import {
	buildRelationPairs,
	buildRelationQuestions,
	buildRelationState,
	buildStrengthQuestion,
	evaluateRelationRanking,
	evaluateRelationTypes,
	evaluateStrength,
	NO_RELATION_LABEL,
	normalizeStrength,
	STRENGTH_RUBRIC,
	type SummarizedPost,
} from "./jev-relation-eval";
import { RELATION_TYPES } from "./strata";

const 古民家を買った: SummarizedPost = {
	slug: "tanehouse-2023",
	title: "古民家を買った",
	published_at: "2023-04-01T00:00:00.000Z",
	summary: "古民家を購入し、たねハウスと名付けた経緯を書いた。",
};
const 窓にフィルムを貼った: SummarizedPost = {
	slug: "window-film",
	title: "窓にフィルムを貼った",
	published_at: "2024-01-10T00:00:00.000Z",
	summary: "たねハウスの窓に断熱フィルムを貼った。",
};
const 猫を迎えた: SummarizedPost = {
	slug: "welcome-cat",
	title: "猫を迎えた",
	published_at: "2024-06-01T00:00:00.000Z",
	summary: "保護猫を迎えた。",
};

describe("buildRelationPairs", () => {
	it("新しい記事から、それより前に公開された記事への組だけを作る（後方参照のみ）", () => {
		const pairs = buildRelationPairs([
			猫を迎えた,
			古民家を買った,
			窓にフィルムを貼った,
		]);
		expect(pairs.map((pair) => [pair.newer.slug, pair.older.slug])).toEqual([
			["window-film", "tanehouse-2023"],
			["welcome-cat", "tanehouse-2023"],
			["welcome-cat", "window-film"],
		]);
	});
});

describe("buildRelationState", () => {
	it("新しい記事と過去記事のタイトルと要約を、名前付きのフィールドにする", () => {
		expect(buildRelationState(窓にフィルムを貼った, 古民家を買った)).toEqual({
			newer_post: {
				title: "窓にフィルムを貼った",
				summary: "たねハウスの窓に断熱フィルムを貼った。",
			},
			older_post: {
				title: "古民家を買った",
				summary: "古民家を購入し、たねハウスと名付けた経緯を書いた。",
			},
		});
	});
});

describe("buildRelationQuestions", () => {
	it("関係の有無を聞く noul と、種類を選ぶ choice を作る", () => {
		const questions = buildRelationQuestions();
		expect(questions.related.type).toBe("noul");
		expect(questions.relation_type.type).toBe("choice");
		expect(Object.keys(questions.relation_type.criteria)).toEqual([
			...RELATION_TYPES,
			NO_RELATION_LABEL,
		]);
	});
});

describe("evaluateRelationRanking", () => {
	const 判定 = [
		{ newer: "welcome-cat", older: "tanehouse-2023", probability: 0.4 },
		{ newer: "welcome-cat", older: "window-film", probability: 0.7 },
		{ newer: "window-film", older: "tanehouse-2023", probability: 0.9 },
	];

	it("新しい記事ごとに確率の高い順に並べ、既知の関係が上位 K 件に入った割合を出す", () => {
		const report = evaluateRelationRanking(
			判定,
			[
				{ newer: "window-film", older: "tanehouse-2023" },
				{ newer: "welcome-cat", older: "tanehouse-2023" },
			],
			1,
		);
		expect(report.knownTotal).toBe(2);
		expect(report.knownInTopK).toBe(1);
		// 上位に入らなかった既知の関係は、その順位と確率を残す
		expect(report.missed).toEqual([
			{
				newer: "welcome-cat",
				older: "tanehouse-2023",
				rank: 2,
				probability: 0.4,
			},
		]);
	});

	it("注釈に無い組を、確率の高い順に「埋もれた関係の候補」として一覧にする", () => {
		const report = evaluateRelationRanking(
			判定,
			[{ newer: "window-film", older: "tanehouse-2023" }],
			8,
		);
		expect(report.unlisted).toEqual([
			{ newer: "welcome-cat", older: "window-film", probability: 0.7 },
			{ newer: "welcome-cat", older: "tanehouse-2023", probability: 0.4 },
		]);
	});

	it("既知の関係の判定結果が無ければエラーにする", () => {
		expect(() =>
			evaluateRelationRanking(
				判定,
				[{ newer: "welcome-cat", older: "first-hunt" }],
				8,
			),
		).toThrow("welcome-cat → first-hunt");
	});
});

describe("evaluateRelationTypes", () => {
	it("既知の関係について、Jev が選んだ種類が注釈と一致した件数を出す", () => {
		const report = evaluateRelationTypes([
			{
				newer: "window-film",
				older: "tanehouse-2023",
				expected: "continues",
				predicted: "continues",
				confidence: 0.8,
			},
			{
				newer: "welcome-cat",
				older: "tanehouse-2023",
				expected: "revisits",
				predicted: NO_RELATION_LABEL,
				confidence: 0.6,
			},
		]);
		expect(report.total).toBe(2);
		expect(report.matched).toBe(1);
		expect(report.mismatches.map((item) => item.newer)).toEqual([
			"welcome-cat",
		]);
	});
});

describe("buildStrengthQuestion", () => {
	it("関係の強さを段階で聞く score の質問を作る（0 が最も弱く、最後の段階が最も強い）", () => {
		const question = buildStrengthQuestion();
		expect(question.type).toBe("score");
		expect(question.criteria).toEqual(STRENGTH_RUBRIC);
	});
});

describe("normalizeStrength", () => {
	it("Jev の期待値の score を、段階の数に依らない 0〜1 の強さにする", () => {
		// 前提: 段階は 0 から STRENGTH_RUBRIC.length - 1 まで
		const 最大の段階 = STRENGTH_RUBRIC.length - 1;
		expect(normalizeStrength(0)).toBe(0);
		expect(normalizeStrength(最大の段階)).toBe(1);
		expect(normalizeStrength(最大の段階 / 2)).toBe(0.5);
	});

	it("段階の範囲を外れた score はエラーにする", () => {
		expect(() => normalizeStrength(-0.1)).toThrow("score が段階の範囲");
		expect(() => normalizeStrength(STRENGTH_RUBRIC.length)).toThrow(
			"score が段階の範囲",
		);
	});
});

describe("evaluateStrength", () => {
	it("関係の種類ごとに、強さと確率の件数・中央値・最小・最大を出す", () => {
		// 前提: continues が 3 本、updates が 1 本。probability は relations-run の「関係がある確率」
		const report = evaluateStrength([
			{
				newer: "window-film",
				older: "tanehouse-2023",
				type: "continues",
				strength: 0.9,
				probability: 0.8,
			},
			{
				newer: "welcome-cat",
				older: "tanehouse-2023",
				type: "continues",
				strength: 0.3,
				probability: 0.2,
			},
			{
				newer: "welcome-cat",
				older: "window-film",
				type: "continues",
				strength: 0.6,
				probability: 0.5,
			},
			{
				newer: "cat-tower",
				older: "welcome-cat",
				type: "updates",
				strength: 0.7,
				probability: null,
			},
		]);
		expect(report.byType).toEqual([
			{
				type: "continues",
				count: 3,
				strength: { median: 0.6, min: 0.3, max: 0.9 },
				probability: { median: 0.5, min: 0.2, max: 0.8 },
			},
			{
				type: "updates",
				count: 1,
				strength: { median: 0.7, min: 0.7, max: 0.7 },
				// 確率の判定が無い組だけなので集計できない
				probability: null,
			},
		]);
	});

	it("強さの分解能として、0.1 刻みの度数分布を出す（1.0 は最後の区間に入れる）", () => {
		const report = evaluateStrength([
			{
				newer: "window-film",
				older: "tanehouse-2023",
				type: "continues",
				strength: 0.05,
				probability: null,
			},
			{
				newer: "welcome-cat",
				older: "tanehouse-2023",
				type: "continues",
				strength: 0.95,
				probability: null,
			},
			{
				newer: "welcome-cat",
				older: "window-film",
				type: "continues",
				strength: 1,
				probability: null,
			},
		]);
		expect(report.histogram).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
	});
});
