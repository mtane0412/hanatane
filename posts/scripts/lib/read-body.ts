/**
 * `.post.json` の内容から本文のプレーンテキストを取り出す（scripts/jev-eval.ts と scripts/curate.ts で共有）
 *
 * 平文の `.post.json` だけを扱う。限定記事（lexical が暗号化されている）を渡さないこと。
 */
import { lexicalToText } from "../../src/strata";

/**
 * @param content - `.post.json` の内容
 * @param fileName - エラーメッセージ用のファイル名
 */
export function readBodyText(content: string, fileName: string): string {
	const data: unknown = JSON.parse(content);
	if (
		typeof data !== "object" ||
		data === null ||
		!("lexical" in data) ||
		typeof data.lexical !== "object" ||
		data.lexical === null
	) {
		throw new Error(`${fileName}: lexical がありません`);
	}
	return lexicalToText(data.lexical as Record<string, unknown>);
}
