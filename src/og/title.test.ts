/**
 * タイトル改行分割（BudouX + 手動改行）のテスト
 */
import { describe, expect, it } from "vitest";
import { splitTitleIntoLines } from "./title";

describe("splitTitleIntoLines", () => {
	it("日本語タイトルを BudouX で文節チャンクに分割する", () => {
		const lines = splitTitleIntoLines("今日は天気がいいので散歩に行きました");
		expect(lines).toHaveLength(1);
		// 文節単位に複数チャンクへ分割され、結合すると元の文になる
		expect(lines[0].length).toBeGreaterThan(1);
		expect(lines[0].join("")).toBe("今日は天気がいいので散歩に行きました");
	});

	it("手動改行は行として保持される", () => {
		const lines = splitTitleIntoLines("一行目\n二行目");
		expect(lines).toHaveLength(2);
		expect(lines[0].join("")).toBe("一行目");
		expect(lines[1].join("")).toBe("二行目");
	});
});
