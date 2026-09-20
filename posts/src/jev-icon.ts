/**
 * Jev（TypeSafe の判定モデル）の choice から、Hyperstrata の注釈の icon の候補を作る
 *
 * strata-annotate スキルでは、Claude Code が記事の題材から icon を 1 つ選び、拮抗したら省略する。
 * Jev の choice は選択肢の確率分布と確信度を返すので、候補と「拮抗しているか」を示して判断を補助する。
 * 評価（src/jev-eval.ts、2026-09-20、公開 82 記事）では、Jev の選択が注釈と一致したのは
 * 確信度 0.9 以上で 57 件中 54 件（95%）、0.7 以上 0.9 未満で 12 件中 11 件、0.7 未満で 13 件中 4 件。
 * 確率分布を見た別の測定（issue #54）では、上位 2 候補に 82 件中 78 件で注釈の icon が入った。
 *
 * 候補は判断の補助にすぎない。icon を付けるか、どれにするかは、これまでどおり Claude Code が本文を読んで決める。
 * このモジュールは対象の確認と候補の整形だけを担当する。API の呼び出しは scripts/strata.ts が行う。
 */
import { NO_ICON_LABEL } from "./jev-eval";
import { isPrivateVisibility } from "./private-post";
import { isTopicIcon, type PublishedPost, type TopicIcon } from "./strata";

/**
 * 確信度がこの値未満なら「拮抗している」とみなす。
 * 評価では、0.7 未満の判定は 3 分の 2 が注釈と食い違った（モジュール冒頭のコメントを参照）。
 */
export const ICON_CONTESTED_THRESHOLD = 0.7;

/** icon の候補の 1 件。icon: null は「該当なし（icon を省略する）」 */
export interface IconCandidate {
	icon: TopicIcon | null;
	probability: number;
}

export interface IconSuggestion {
	/** 確率の高い順 */
	candidates: IconCandidate[];
	/** 題材が拮抗している（icon の省略も検討する） */
	contested: boolean;
}

/**
 * 記事が Jev に判定させてよいものかを確かめます。
 * 限定記事の本文は外部の API に送らないので、エラーにします。
 */
export function checkJevIconTarget(post: PublishedPost): void {
	if (isPrivateVisibility(post.visibility)) {
		throw new Error(
			`${post.slug}: 限定記事の本文は外部の API に送れません。icon は本文を読んで決めてください`,
		);
	}
}

/**
 * Jev の choice の回答を、確率の高い順の候補にします。
 *
 * @param answer - choice の回答の確信度と、選択肢（TOPIC_ICONS と NO_ICON_LABEL）ごとの確率
 */
export function suggestIcon(answer: {
	confidence: number;
	probabilities: Readonly<Record<string, number>>;
}): IconSuggestion {
	const candidates = Object.entries(answer.probabilities)
		.map(([label, probability]): IconCandidate => {
			if (label === NO_ICON_LABEL) return { icon: null, probability };
			if (!isTopicIcon(label)) {
				throw new Error(`Jev が icon の種別に無い選択肢を返しました: ${label}`);
			}
			return { icon: label, probability };
		})
		.sort((a, b) => b.probability - a.probability);
	return {
		candidates,
		contested: answer.confidence < ICON_CONTESTED_THRESHOLD,
	};
}
