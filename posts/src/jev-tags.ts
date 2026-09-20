/**
 * 公開前の記事のタグを、Jev（TypeSafe の判定モデル）の確率で見直す
 *
 * `curate check` の形式の検査は、タグが統制語彙にあるかだけを見る。タグが記事の内容に合っているかは分からない。
 * タグごとに「記事の主題がこのタグに当てはまるか」を Jev に聞き（質問は src/jev-eval.ts の buildTagQuestions）、
 * 付け忘れの候補と付けすぎの候補を警告として出す。
 *
 * 警告は見直しのきっかけで、タグを決めるのはこれまでどおり Claude Code（publish-prepare スキル）。
 * 本文に書かれていない事情でタグが付くこともあるので、警告があっても公開の基準は満たしたままにする。
 *
 * しきい値の根拠（2026-09-20、公開 82 記事 × 8 タグ = 656 判定）:
 *   付いていない記事の確率は 90% 点で 0.11 以下、付いている記事の確率は中央値で 0.84 以上と大きく離れており、
 *   高 0.7 / 低 0.3 では警告が 9 件に収まった（どれも見直す価値のある候補だった）。
 *
 * このモジュールは対象の絞り込みと判定だけを担当する。API の呼び出しは scripts/curate.ts が行う。
 */
import { isInternalTag, type TagVocabularyEntry } from "./curate";

/** 付いていないタグの確率がこれ以上なら、付け忘れの候補にする */
export const JEV_TAG_HIGH = 0.7;
/** 付いているタグの確率がこれ未満なら、付けすぎの候補にする */
export const JEV_TAG_LOW = 0.3;

/**
 * Jev が判定できないタグの slug。
 * 「たねのぶの話」（diary）は「特定の題材に寄らない」という除外で定義されている。
 * Jev は否定や間接的な推論が苦手で、付いている記事も付いていない記事も確率が 0.4〜0.85 に固まり、
 * どのしきい値でも分けられなかった（質問を改善した後も同じ）。
 */
const JEV_UNSUITED_TAG_SLUGS: readonly string[] = ["diary"];

/** 統制語彙から、Jev に判定させるタグを選びます。 */
export function selectJevTags(
	vocabulary: readonly TagVocabularyEntry[],
): TagVocabularyEntry[] {
	return vocabulary.filter(
		(entry) => !JEV_UNSUITED_TAG_SLUGS.includes(entry.slug),
	);
}

/**
 * タグの見直しの警告
 *   - missing: 付いていないのに確率が高い（付け忘れの候補）
 *   - doubtful: 付いているのに確率が低い（付けすぎの候補。本文に書かれていない事情で付けたのなら、そのままでよい）
 */
export interface TagWarning {
	kind: "missing" | "doubtful";
	tag: string;
	probability: number;
}

/**
 * 記事のタグを Jev の確率と突き合わせ、警告を統制語彙の順で返します。
 * 対象外のタグ（selectJevTags が外すもの）と内部タグ（`#ref-*` など）は見ません。
 *
 * @param postTags - 記事に付いているタグ名
 * @param probabilities - タグの slug をキーにした「主題が当てはまる」確率
 */
export function reviewTags(
	postTags: readonly string[],
	vocabulary: readonly TagVocabularyEntry[],
	probabilities: ReadonlyMap<string, number>,
): TagWarning[] {
	const attached = new Set(postTags.filter((tag) => !isInternalTag(tag)));
	const warnings: TagWarning[] = [];
	for (const entry of selectJevTags(vocabulary)) {
		const probability = probabilities.get(entry.slug);
		if (probability === undefined) {
			throw new Error(
				`タグ「${entry.name}」（${entry.slug}）の判定結果がありません`,
			);
		}
		if (!attached.has(entry.name) && probability >= JEV_TAG_HIGH) {
			warnings.push({ kind: "missing", tag: entry.name, probability });
		}
		if (attached.has(entry.name) && probability < JEV_TAG_LOW) {
			warnings.push({ kind: "doubtful", tag: entry.name, probability });
		}
	}
	return warnings;
}
