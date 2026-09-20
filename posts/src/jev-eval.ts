/**
 * Jev（TypeSafe の判定モデル）の日本語精度を、既存の正解ラベルで測る評価
 *
 * Jev は文章を生成せず、yes/no の確率（noul）や選択肢の確率分布（choice）を返す。
 * 学習の主言語は英語なので、hanatane.net の日本語記事で使える精度かを、採用の前に実測する。
 * 正解ラベルは、Claude Code と著者がすでに付けたものを使う:
 *   - タグ: 公開記事のタグ（tags.json の統制語彙）。1 記事に複数付くので、タグごとに noul を 1 問ずつ聞く
 *   - icon: Hyperstrata の注釈の icon（src/strata.ts の TOPIC_ICONS）。1 つだけ選ぶので choice で聞く
 *
 * このモジュールは質問の組み立てと集計だけを担当する。API の呼び出しとファイル入出力は scripts/jev-eval.ts が行う。
 */
import type { ChoiceQuestion, NoulQuestion } from "@typesafe-ai/sdk";
import type { TagVocabularyEntry } from "./curate";
import { TOPIC_ICONS, type TopicIcon } from "./strata";

/**
 * Jev に渡す本文の上限の文字数。
 * Jev は長い入力で精度が落ちる（公式の既知の弱点）うえ、state には 32k トークンの上限があるため、冒頭だけを渡す。
 */
export const BODY_MAX_CHARACTERS = 8000;

/** icon の質問で「どの題材にも当てはまらない」を表す選択肢（注釈の icon: null に対応する） */
export const NO_ICON_LABEL = "none";

/** icon の質問の選択肢に付ける説明文（src/strata.ts の TOPIC_ICONS の定義に合わせる） */
const ICON_DESCRIPTIONS: Record<TopicIcon, string> = {
	cat: "猫が主題の記事",
	house: "古民家・DIY・住まいが主題の記事",
	hunting: "狩猟が主題の記事",
	game: "格闘ゲーム・ゲームが主題の記事",
	tech: "開発・Ghost 運用・ツールが主題の記事",
	travel: "旅行・遠征が主題の記事",
	journal: "週報・振り返り・エッセイ的な考えが主題の記事",
	event: "勉強会・登壇・交流イベントが主題の記事",
};

/**
 * 本文に書かれていない、タグの判定に要る背景。
 * 自宅の修繕の記事は本文に「たねハウス」と書かれないことが多く、背景が無いと「たねハウスの話」を見逃す
 * （2026-09-20 の評価で、付いている 8 記事の確率の中央値が 0.40 だった）。
 * 無関係な情報は Jev の精度を落とすので、判定に要る最小限に留める。
 */
const SITE_CONTEXT =
	"著者の自宅は、岩手県の古民家「たねハウス」です。自宅・家の修繕や設備の話は、たねハウスの話です。";

/** Jev に渡す記事の状態 */
export interface PostState {
	site_context: string;
	title: string;
	body: string;
}

/**
 * 記事のタイトルと本文から、Jev に渡す state を作ります。
 * 本文は BODY_MAX_CHARACTERS 文字（サロゲートペアを 1 文字と数える）で切ります。
 */
export function buildPostState(title: string, text: string): PostState {
	const body = Array.from(text).slice(0, BODY_MAX_CHARACTERS).join("");
	return { site_context: SITE_CONTEXT, title, body };
}

/**
 * 統制語彙のタグごとに「この記事にこのタグが付くか」の noul の質問を作ります。
 * キーはタグの slug です。質問の ID はモデルに送られないため、タグ名は instructions に書きます。
 */
export function buildTagQuestions(
	vocabulary: readonly TagVocabularyEntry[],
): Record<string, NoulQuestion> {
	const questions: Record<string, NoulQuestion> = {};
	for (const entry of vocabulary) {
		questions[entry.slug] = {
			type: "noul",
			instructions: `\`title\` と \`body\` はブログ記事です。この記事の主題は、タグ「${entry.name}」に当てはまりますか？`,
			criteria: {
				true: entry.description,
				false:
					"記事の主題がタグの説明に当てはまらない。または、その題材に触れているだけ（週報や振り返りの中の一項目など）で、記事全体の主題ではない",
			},
		};
	}
	return questions;
}

/** 記事の題材を表す icon を 1 つ選ぶ choice の質問を作ります。 */
export function buildIconQuestion(): ChoiceQuestion<Record<string, string>> {
	const criteria: Record<string, string> = {};
	for (const icon of TOPIC_ICONS) {
		criteria[icon] = ICON_DESCRIPTIONS[icon];
	}
	criteria[NO_ICON_LABEL] = "上のどの題材にも当てはまらない記事";
	return {
		type: "choice",
		instructions:
			"`title` と `body` はブログ記事です。この記事の主題として最も強い題材はどれですか？",
		criteria,
	};
}

/** タグの評価の 1 記事ぶんの入力 */
export interface TagCase {
	slug: string;
	/** 正解。記事に付いている統制語彙のタグ名 */
	expected: readonly string[];
	/** Jev の判定。タグの slug をキーにした yes の確率 */
	probabilities: Readonly<Record<string, number>>;
}

/** タグごとの集計。分母が 0 の指標は null */
export interface TagMetrics {
	tag: string;
	truePositive: number;
	falsePositive: number;
	falseNegative: number;
	precision: number | null;
	recall: number | null;
}

/** 正解と食い違った 1 件の判定 */
export interface TagDisagreement {
	slug: string;
	tag: string;
	/** 正解ではこのタグが付いているか */
	expected: boolean;
	probability: number;
}

export interface TagReport {
	perTag: TagMetrics[];
	disagreements: TagDisagreement[];
}

/**
 * タグの判定を正解と突き合わせて、タグごとの適合率・再現率と、食い違いの一覧を出します。
 * 確率が threshold 以上なら「付く」とみなします。
 * 確率を保存しておけば、API を呼び直さずに threshold だけを変えて集計し直せます。
 */
export function evaluateTags(
	cases: readonly TagCase[],
	vocabulary: readonly TagVocabularyEntry[],
	threshold: number,
): TagReport {
	const disagreements: TagDisagreement[] = [];
	const perTag = vocabulary.map((entry): TagMetrics => {
		let truePositive = 0;
		let falsePositive = 0;
		let falseNegative = 0;
		for (const testCase of cases) {
			const probability = testCase.probabilities[entry.slug];
			if (probability === undefined) {
				throw new Error(
					`${testCase.slug}: タグ「${entry.name}」（${entry.slug}）の判定結果がありません`,
				);
			}
			const expected = testCase.expected.includes(entry.name);
			const predicted = probability >= threshold;
			if (expected && predicted) truePositive++;
			if (!expected && predicted) falsePositive++;
			if (expected && !predicted) falseNegative++;
			if (expected !== predicted) {
				disagreements.push({
					slug: testCase.slug,
					tag: entry.name,
					expected,
					probability,
				});
			}
		}
		return {
			tag: entry.name,
			truePositive,
			falsePositive,
			falseNegative,
			precision: ratio(truePositive, truePositive + falsePositive),
			recall: ratio(truePositive, truePositive + falseNegative),
		};
	});
	return { perTag, disagreements };
}

/** icon の評価の 1 記事ぶんの入力 */
export interface IconCase {
	slug: string;
	/** 正解。注釈の icon（無ければ null） */
	expected: TopicIcon | null;
	/** Jev が選んだ選択肢（TOPIC_ICONS のどれか、または NO_ICON_LABEL） */
	predicted: string;
	confidence: number;
}

export interface IconReport {
	total: number;
	matched: number;
	/** 確信度がしきい値未満で「該当なし」に置き換えた判定の数 */
	omitted: number;
	/** 食い違った判定。predicted はしきい値を適用した後の値 */
	mismatches: IconCase[];
}

/**
 * icon の判定を注釈の icon と突き合わせます。注釈に icon が無い記事は NO_ICON_LABEL を正解にします。
 * 確信度が threshold 未満の判定は、strata-annotate スキルの「拮抗したら省略」にならって NO_ICON_LABEL として扱います。
 * threshold を 0 にすると、Jev の選択をそのまま使います。
 */
export function evaluateIcons(
	cases: readonly IconCase[],
	threshold: number,
): IconReport {
	let omitted = 0;
	const mismatches: IconCase[] = [];
	for (const testCase of cases) {
		const isOmitted = testCase.confidence < threshold;
		if (isOmitted) omitted++;
		const applied: IconCase = isOmitted
			? { ...testCase, predicted: NO_ICON_LABEL }
			: testCase;
		if (applied.predicted !== (applied.expected ?? NO_ICON_LABEL)) {
			mismatches.push(applied);
		}
	}
	return {
		total: cases.length,
		matched: cases.length - mismatches.length,
		omitted,
		mismatches,
	};
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}
