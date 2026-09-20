/**
 * Jev（TypeSafe の判定モデル）の日本語精度を、既存の正解ラベルで測る評価のテスト
 *
 * 正解ラベルは、公開記事に付いているタグ（tags.json の統制語彙）と、Hyperstrata の注釈の icon。
 * このモジュールは質問の組み立てと集計だけを担当し、API の呼び出しは scripts/jev-eval.ts が行う。
 */
import { describe, expect, it } from "vitest";
import type { TagVocabularyEntry } from "./curate";
import {
	BODY_MAX_CHARACTERS,
	buildIconQuestion,
	buildPostState,
	buildTagQuestions,
	evaluateIcons,
	evaluateTags,
	NO_ICON_LABEL,
} from "./jev-eval";
import { TOPIC_ICONS } from "./strata";

const 語彙: TagVocabularyEntry[] = [
	{ name: "技術の話", slug: "tech", description: "技術が主題の記事" },
	{ name: "猫の話", slug: "cat", description: "飼い猫の記事" },
];

describe("buildPostState", () => {
	it("タイトルと本文を名前付きのフィールドにする", () => {
		expect(buildPostState("猫を迎えた", "保護猫を迎えました。")).toEqual({
			title: "猫を迎えた",
			body: "保護猫を迎えました。",
		});
	});

	it("長い本文は上限の文字数で切る", () => {
		const 長い本文 = "あ".repeat(BODY_MAX_CHARACTERS + 100);
		const state = buildPostState("長い記事", 長い本文);
		expect(Array.from(state.body)).toHaveLength(BODY_MAX_CHARACTERS);
	});
});

describe("buildTagQuestions", () => {
	it("タグごとに、slug をキーにした noul の質問を作る", () => {
		const questions = buildTagQuestions(語彙);
		expect(Object.keys(questions)).toEqual(["tech", "cat"]);
		expect(questions.cat.type).toBe("noul");
	});

	it("質問にタグ名を、yes の基準に統制語彙の説明文を入れる", () => {
		const questions = buildTagQuestions(語彙);
		expect(questions.cat.instructions).toContain("猫の話");
		expect(questions.cat.criteria?.true).toBe("飼い猫の記事");
	});
});

describe("buildIconQuestion", () => {
	it("すべての icon と「該当なし」を選択肢にした choice の質問を作る", () => {
		const question = buildIconQuestion();
		expect(question.type).toBe("choice");
		expect(Object.keys(question.criteria)).toEqual([
			...TOPIC_ICONS,
			NO_ICON_LABEL,
		]);
	});
});

describe("evaluateTags", () => {
	it("しきい値以上の確率を「付く」とみなして、タグごとの適合率と再現率を出す", () => {
		const report = evaluateTags(
			[
				{
					slug: "welcome-cat",
					expected: ["猫の話"],
					probabilities: { tech: 0.1, cat: 0.9 },
				},
				{
					slug: "cat-feeder",
					expected: ["技術の話", "猫の話"],
					probabilities: { tech: 0.8, cat: 0.3 },
				},
				{
					slug: "ghost-toc",
					expected: ["技術の話"],
					probabilities: { tech: 0.7, cat: 0.6 },
				},
			],
			語彙,
			0.5,
		);
		expect(report.perTag).toEqual([
			{
				tag: "技術の話",
				truePositive: 2,
				falsePositive: 0,
				falseNegative: 0,
				precision: 1,
				recall: 1,
			},
			{
				tag: "猫の話",
				truePositive: 1,
				falsePositive: 1,
				falseNegative: 1,
				precision: 0.5,
				recall: 0.5,
			},
		]);
	});

	it("正解と食い違った判定を、記事とタグの組で一覧にする", () => {
		const report = evaluateTags(
			[
				{
					slug: "cat-feeder",
					expected: ["技術の話", "猫の話"],
					probabilities: { tech: 0.8, cat: 0.3 },
				},
			],
			語彙,
			0.5,
		);
		expect(report.disagreements).toEqual([
			{ slug: "cat-feeder", tag: "猫の話", expected: true, probability: 0.3 },
		]);
	});

	it("一度も「付く」と判定されなかったタグの適合率は null にする", () => {
		const report = evaluateTags(
			[
				{
					slug: "ghost-toc",
					expected: ["技術の話"],
					probabilities: { tech: 0.9, cat: 0.1 },
				},
			],
			語彙,
			0.5,
		);
		expect(report.perTag[1].precision).toBeNull();
		expect(report.perTag[1].recall).toBeNull();
	});

	it("判定結果に語彙のタグの確率が無ければエラーにする", () => {
		expect(() =>
			evaluateTags(
				[{ slug: "ghost-toc", expected: [], probabilities: { tech: 0.9 } }],
				語彙,
				0.5,
			),
		).toThrow("ghost-toc");
	});
});

describe("evaluateIcons", () => {
	it("注釈の icon と一致した割合を出し、icon が無い記事は「該当なし」を正解にする", () => {
		const report = evaluateIcons([
			{
				slug: "welcome-cat",
				expected: "cat",
				predicted: "cat",
				confidence: 0.9,
			},
			{
				slug: "iwate-trip",
				expected: "travel",
				predicted: "journal",
				confidence: 0.4,
			},
			{
				slug: "thin-vs-thing",
				expected: null,
				predicted: NO_ICON_LABEL,
				confidence: 0.6,
			},
		]);
		expect(report.total).toBe(3);
		expect(report.matched).toBe(2);
		expect(report.mismatches).toEqual([
			{
				slug: "iwate-trip",
				expected: "travel",
				predicted: "journal",
				confidence: 0.4,
			},
		]);
	});
});
