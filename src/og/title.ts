/**
 * 記事タイトルの改行分割
 *
 * 手動改行（`\n`）で行に分け、各行を BudouX で文節チャンクに分割します。
 * Satori は `<wbr>` を解釈しないため、チャンクごとに要素を分けて
 * flex-wrap で自然な位置に折り返させる前処理として使います。
 */

import { loadDefaultJapaneseParser } from "budoux";

/** BudouX パーサーはモジュール単位で 1 回だけ生成する */
const parser = loadDefaultJapaneseParser();

/**
 * タイトルを「行 → 文節チャンク」の二次元配列に分割する
 *
 * @param title - 記事タイトル（`\n` を含んでよい）
 * @returns 行ごとのチャンク配列。空行は空配列になる
 */
export function splitTitleIntoLines(title: string): string[][] {
	return title.split("\n").map((line) => parser.parse(line));
}
