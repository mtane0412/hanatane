/**
 * Jev による Hyperstrata の関係候補の絞り込みを、既存の注釈の関係を正解にして測る評価
 *
 * strata-annotate スキルでは、Claude Code が過去記事の一覧（strata catalog）から関係の候補を最大 8 本、目で選ぶ。
 * 記事が増えるほど見落としやすい工程なので、注釈の要約どうしの全組を Jev に判定させ、
 *   - 既知の関係（注釈の relations）が、確率の順位の上位に入るか（候補選びの代替・補助になるか）
 *   - 注釈に無いのに確率が高い組（埋もれた関係の候補）はどれか
 *   - 関係の種類（continues / revisits / updates）を当てられるか
 * を測る。関係を採用するかの最終判断は、これまでどおり Claude Code が本文を読んで行う。
 *
 * このモジュールは組と質問の組み立てと集計だけを担当する。API の呼び出しとファイル入出力は scripts/jev-eval.ts が行う。
 */
import type { ChoiceQuestion, NoulQuestion } from "@typesafe-ai/sdk";
import { RELATION_TYPES, type RelationType } from "./strata";

/** 種類の質問で「関係が無い」を表す選択肢 */
export const NO_RELATION_LABEL = "none";

/** 種類の選択肢に付ける説明文（.claude/skills/strata-annotate/SKILL.md の「判定の基準」に合わせる） */
const RELATION_DESCRIPTIONS: Record<RelationType, string> = {
	continues:
		"続報。同じ出来事・プロジェクト・企画の次の報告（例: 同じ家の改修の進捗、週報の翌週、同じ猫の次の話、同じ大会の次の結果）",
	revisits:
		"再訪。別の出来事や時期から同じテーマに戻っている（例: 数年ぶりに同じ趣味を再開した、別の道具で同じ課題に取り組んだ）",
	updates:
		"更新。過去記事で述べた内容・判断・考えを改めている、または結果が出て前提が変わった（例: やめると書いたことを再開した、選んだ道具を乗り換えた）",
};

/** 注釈の要約が付いた公開記事 */
export interface SummarizedPost {
	slug: string;
	title: string;
	published_at: string;
	summary: string;
}

export interface RelationPair {
	newer: SummarizedPost;
	older: SummarizedPost;
}

/**
 * 新しい記事から、それより前に公開された記事への組をすべて作ります。
 * 注釈の関係は後方参照だけなので、公開日の前後は Jev に聞かず（日付の比較は Jev の苦手分野）、ここで決めます。
 * 公開日の比較は src/strata.ts と同じく ISO 8601 文字列の比較です。
 */
export function buildRelationPairs(
	posts: readonly SummarizedPost[],
): RelationPair[] {
	const sorted = [...posts].sort(
		(a, b) =>
			a.published_at.localeCompare(b.published_at) ||
			a.slug.localeCompare(b.slug),
	);
	const pairs: RelationPair[] = [];
	for (const newer of sorted) {
		for (const older of sorted) {
			if (older.published_at < newer.published_at) {
				pairs.push({ newer, older });
			}
		}
	}
	return pairs;
}

/** 1 組ぶんの state を作ります。判定に要らない slug と公開日は渡しません。 */
export function buildRelationState(
	newer: SummarizedPost,
	older: SummarizedPost,
): Record<string, { title: string; summary: string }> {
	return {
		newer_post: { title: newer.title, summary: newer.summary },
		older_post: { title: older.title, summary: older.summary },
	};
}

/** 関係の有無を聞く noul と、種類を選ぶ choice を作ります。2 問は同じリクエストで並列に判定されます。 */
export function buildRelationQuestions(): {
	related: NoulQuestion;
	relation_type: ChoiceQuestion<Record<string, string>>;
} {
	const criteria: Record<string, string> = {};
	for (const type of RELATION_TYPES) {
		criteria[type] = RELATION_DESCRIPTIONS[type];
	}
	criteria[NO_RELATION_LABEL] =
		"関係が無い。題材の分野や書かれた時期が同じだけで、続報・再訪・更新のどれも読み取れない";
	return {
		related: {
			type: "noul",
			instructions:
				"`newer_post` と `older_post` は同じ著者のブログ記事の要約です。`newer_post` は `older_post` の続報・再訪・更新のいずれかですか？",
			criteria: {
				true: "同じ出来事・プロジェクト・人・場所・考えが `older_post` から `newer_post` へ続いている",
				false:
					"題材の分野や書かれた時期が同じだけで、具体的な出来事や考えのつながりは無い",
			},
		},
		relation_type: {
			type: "choice",
			instructions:
				"`newer_post` と `older_post` は同じ著者のブログ記事の要約です。`newer_post` から見た `older_post` との関係はどれですか？",
			criteria,
		},
	};
}

/** Jev が判定した 1 組の「関係がある」確率 */
export interface RelationJudgment {
	newer: string;
	older: string;
	probability: number;
}

/** 注釈にある既知の関係（slug の組） */
export interface KnownRelation {
	newer: string;
	older: string;
}

export interface RelationRankingReport {
	knownTotal: number;
	/** 既知の関係のうち、新しい記事ごとの順位で上位 K 件に入った数 */
	knownInTopK: number;
	/** 上位 K 件に入らなかった既知の関係（順位は 1 始まり） */
	missed: (RelationJudgment & { rank: number })[];
	/** 注釈に無い組。確率の高い順 */
	unlisted: RelationJudgment[];
}

/**
 * 新しい記事ごとに過去記事を確率の高い順に並べ、既知の関係が上位 topK 件に入るかを数えます。
 * topK は strata-annotate スキルの「候補は最大 8 本」に対応します。
 */
export function evaluateRelationRanking(
	judgments: readonly RelationJudgment[],
	known: readonly KnownRelation[],
	topK: number,
): RelationRankingReport {
	const byNewer = new Map<string, RelationJudgment[]>();
	for (const judgment of judgments) {
		const list = byNewer.get(judgment.newer) ?? [];
		list.push(judgment);
		byNewer.set(judgment.newer, list);
	}
	for (const list of byNewer.values()) {
		list.sort((a, b) => b.probability - a.probability);
	}

	const missed: RelationRankingReport["missed"] = [];
	for (const relation of known) {
		const index = (byNewer.get(relation.newer) ?? []).findIndex(
			(judgment) => judgment.older === relation.older,
		);
		if (index === -1) {
			throw new Error(
				`${relation.newer} → ${relation.older}: 既知の関係の判定結果がありません`,
			);
		}
		const rank = index + 1;
		if (rank > topK) {
			const judgment = byNewer.get(relation.newer)?.[index];
			if (judgment) missed.push({ ...judgment, rank });
		}
	}

	const knownKeys = new Set(known.map((relation) => pairKey(relation)));
	const unlisted = judgments
		.filter((judgment) => !knownKeys.has(pairKey(judgment)))
		.sort((a, b) => b.probability - a.probability);

	return {
		knownTotal: known.length,
		knownInTopK: known.length - missed.length,
		missed,
		unlisted,
	};
}

/** 既知の関係 1 本ぶんの、種類の評価の入力 */
export interface RelationTypeCase {
	newer: string;
	older: string;
	/** 正解。注釈の type */
	expected: RelationType;
	/** Jev が選んだ選択肢（RELATION_TYPES のどれか、または NO_RELATION_LABEL） */
	predicted: string;
	confidence: number;
}

export interface RelationTypeReport {
	total: number;
	matched: number;
	mismatches: RelationTypeCase[];
}

/** 既知の関係について、Jev が選んだ種類を注釈の type と突き合わせます。 */
export function evaluateRelationTypes(
	cases: readonly RelationTypeCase[],
): RelationTypeReport {
	const mismatches = cases.filter(
		(testCase) => testCase.predicted !== testCase.expected,
	);
	return {
		total: cases.length,
		matched: cases.length - mismatches.length,
		mismatches,
	};
}

function pairKey(pair: KnownRelation): string {
	return `${pair.newer}\t${pair.older}`;
}
