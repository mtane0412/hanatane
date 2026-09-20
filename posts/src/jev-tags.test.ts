/**
 * 公開前の記事のタグを、Jev の確率で見直す検査のテスト
 *
 * `curate check` の形式の検査（タグが統制語彙にあるか）では、タグが記事の内容に合っているかは分からない。
 * Jev の確率から「付け忘れの候補」と「付けすぎの候補」を警告として出す。決めるのは Claude Code。
 */
import { describe, expect, it } from "vitest";
import type { TagVocabularyEntry } from "./curate";
import {
	JEV_TAG_HIGH,
	JEV_TAG_LOW,
	reviewTags,
	selectJevTags,
} from "./jev-tags";

const 語彙: TagVocabularyEntry[] = [
	{ name: "技術の話", slug: "tech", description: "技術が主題の記事" },
	{ name: "たねのぶの話", slug: "diary", description: "日記的な記事" },
	{ name: "猫の話", slug: "cat", description: "飼い猫の記事" },
];

describe("selectJevTags", () => {
	it("除外で定義されていて Jev が判定できないタグ（たねのぶの話）を対象から外す", () => {
		expect(selectJevTags(語彙).map((entry) => entry.slug)).toEqual([
			"tech",
			"cat",
		]);
	});
});

describe("reviewTags", () => {
	it("付いていないのに確率が高いタグを、付け忘れの候補にする", () => {
		const warnings = reviewTags(
			["技術の話"],
			語彙,
			new Map([
				["tech", 0.95],
				["cat", JEV_TAG_HIGH],
			]),
		);
		expect(warnings).toEqual([
			{ kind: "missing", tag: "猫の話", probability: JEV_TAG_HIGH },
		]);
	});

	it("付いているのに確率が低いタグを、付けすぎの候補にする", () => {
		const warnings = reviewTags(
			["技術の話", "猫の話"],
			語彙,
			new Map([
				["tech", 0.9],
				["cat", 0.1],
			]),
		);
		expect(warnings).toEqual([
			{ kind: "doubtful", tag: "猫の話", probability: 0.1 },
		]);
	});

	it("どちらとも言えない確率（低と高のあいだ）は警告にしない", () => {
		const warnings = reviewTags(
			["技術の話"],
			語彙,
			new Map([
				["tech", JEV_TAG_LOW],
				["cat", 0.5],
			]),
		);
		expect(warnings).toEqual([]);
	});

	it("対象外のタグ（たねのぶの話）と内部タグ（#ref-*）は、付いていても見ない", () => {
		const warnings = reviewTags(
			["技術の話", "たねのぶの話", "#ref-hyperstrata"],
			語彙,
			new Map([
				["tech", 0.9],
				["cat", 0.0],
			]),
		);
		expect(warnings).toEqual([]);
	});

	it("対象のタグの確率が無ければエラーにする", () => {
		expect(() =>
			reviewTags(["技術の話"], 語彙, new Map([["tech", 0.9]])),
		).toThrow("猫の話");
	});
});
