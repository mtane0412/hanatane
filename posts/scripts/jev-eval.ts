/**
 * Jev（TypeSafe の判定モデル）の日本語精度を、既存のタグと icon を正解にして測るスクリプト
 *
 * 使い方:
 *   pnpm jev-eval run                # 公開記事を Jev に判定させ、結果を .jev-eval/results.json に保存して集計を表示する
 *   pnpm jev-eval report [しきい値]  # 保存済みの結果を集計し直す（API を呼ばない）。しきい値の既定は 0.5
 *   pnpm jev-eval relations-run      # 公開記事の注釈の要約どうしの全組を Jev に判定させ、.jev-eval/relations.json に保存して集計を表示する
 *   pnpm jev-eval relations-report [K]  # 保存済みの結果を集計し直す（API を呼ばない）。K は上位何件を候補とみなすか。既定は 8
 *
 * 注意:
 *   - run と relations-run には TypeSafe の API キーが必要。sops で暗号化した secrets/typesafe.env から読む
 *     （環境変数 TYPESAFE_API_KEY があればそちらを使う。src/typesafe-key.ts 参照）
 *   - 記事の本文と注釈の要約を外部の API（TypeSafe）に送るため、対象は content/ 直下の公開記事だけ。
 *     限定記事（content/private/、strata/private/）は読まないし送らない
 *   - 質問の組み立てと集計のルールは src/jev-eval.ts と src/jev-relation-eval.ts に集約している。ここでは API の呼び出しとファイル入出力だけを扱う
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Question, TypeSafeClient } from "@typesafe-ai/sdk";
import {
	isInternalTag,
	parseTagVocabulary,
	TAG_VOCABULARY_FILE,
	type TagVocabularyEntry,
} from "../src/curate";
import {
	buildIconQuestion,
	buildPostState,
	buildTagQuestions,
	evaluateIcons,
	evaluateTags,
	type IconCase,
	type TagCase,
} from "../src/jev-eval";
import {
	buildRelationPairs,
	buildRelationQuestions,
	buildRelationState,
	evaluateRelationRanking,
	evaluateRelationTypes,
	type KnownRelation,
	type RelationTypeCase,
	type SummarizedPost,
} from "../src/jev-relation-eval";
import { POST_JSON_SUFFIX } from "../src/post-json";
import { isPrivateVisibility } from "../src/private-post";
import {
	lexicalToText,
	PLAIN_STRATA_SUFFIX,
	parseStrataAnnotation,
	readPublishedPost,
	STRATA_DIR,
	STRATA_SUFFIX,
	type StrataAnnotation,
	selectLatestAnnotations,
} from "../src/strata";
import { createTypesafeClient } from "./lib/typesafe-client";

const POSTS_DIR = path.resolve(import.meta.dirname, "..");
const CONTENT_DIR = path.join(POSTS_DIR, "content");
const STRATA_ROOT = path.join(POSTS_DIR, STRATA_DIR);
const RESULTS_DIR = path.join(POSTS_DIR, ".jev-eval");
const RESULTS_PATH = path.join(RESULTS_DIR, "results.json");
const RELATIONS_PATH = path.join(RESULTS_DIR, "relations.json");

/** icon の質問の ID。タグの slug（ハイフン区切り）と衝突しないようにアンダースコアを使う */
const ICON_QUESTION_ID = "topic_icon";
/** 同時に投げるリクエストの数 */
const CONCURRENCY = 8;
/**
 * relations-run で同時に投げるリクエストの数。
 * 約 3,300 組を続けて投げるので、レート制限（1,200 リクエスト/分）に掛からないよう run より絞る
 */
const RELATION_CONCURRENCY = 4;
const DEFAULT_THRESHOLD = 0.5;
/** 関係の候補とみなす上位の件数の既定。strata-annotate スキルの「候補は最大 8 本」に合わせる */
const DEFAULT_TOP_K = 8;
/** 「埋もれた関係の候補」として表示する件数 */
const UNLISTED_DISPLAY_COUNT = 30;
/** relations-run で進捗を表示する間隔（組の数） */
const PROGRESS_INTERVAL = 400;
/** Jev の入力料金（USD / 100 万トークン）。出力は無料。https://docs.typesafe.ai/models */
const INPUT_PRICE_PER_MTOK = 0.042;

/** .jev-eval/results.json の形。確率を保存し、しきい値を変えた再集計に使う */
interface SavedResults {
	model: string;
	inputTokens: number;
	tagCases: TagCase[];
	iconCases: IconCase[];
}

/** .jev-eval/relations.json の形。種類の判定は既知の関係の評価にだけ使う */
interface SavedRelations {
	model: string;
	inputTokens: number;
	judgments: {
		newer: string;
		older: string;
		probability: number;
		type: string;
		typeConfidence: number;
	}[];
}

function usage(): never {
	console.error(
		"使い方: pnpm jev-eval <run | report [しきい値] | relations-run | relations-report [K]>",
	);
	process.exit(1);
}

function loadVocabulary(): TagVocabularyEntry[] {
	return parseTagVocabulary(
		readFileSync(path.join(POSTS_DIR, TAG_VOCABULARY_FILE), "utf8"),
		TAG_VOCABULARY_FILE,
	);
}

/** strata/ 直下（公開記事）の注釈だけを読み、記事ごとに最新の注釈を返す */
function loadPublicAnnotations(): Map<string, StrataAnnotation> {
	const annotations: StrataAnnotation[] = [];
	for (const fileName of readdirSync(STRATA_ROOT).sort()) {
		if (
			!fileName.endsWith(STRATA_SUFFIX) ||
			fileName.endsWith(PLAIN_STRATA_SUFFIX)
		) {
			continue;
		}
		const content = readFileSync(path.join(STRATA_ROOT, fileName), "utf8");
		annotations.push(parseStrataAnnotation(content, fileName));
	}
	return selectLatestAnnotations(annotations);
}

function readBodyText(content: string, fileName: string): string {
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

/** Jev に 1 記事を判定させ、タグと icon の評価の入力にする */
async function judgePost(
	client: TypeSafeClient,
	fileName: string,
	questions: Record<string, Question>,
	annotations: ReadonlyMap<string, StrataAnnotation>,
): Promise<{
	model: string;
	inputTokens: number;
	tagCase: TagCase;
	iconCase: IconCase | null;
} | null> {
	const content = readFileSync(path.join(CONTENT_DIR, fileName), "utf8");
	const post = readPublishedPost(content, fileName);
	if (post.status !== "published") return null;
	if (isPrivateVisibility(post.visibility)) {
		throw new Error(
			`${fileName}: 限定記事が content/ 直下にあります。外部の API に送らないよう中断します`,
		);
	}

	const result = await client.systemOne({
		state: { ...buildPostState(post.title, readBodyText(content, fileName)) },
		questions,
	});

	const probabilities: Record<string, number> = {};
	let iconCase: IconCase | null = null;
	const annotation = annotations.get(post.slug);
	for (const [id, answer] of Object.entries(result.answers)) {
		if (answer.type === "noul") probabilities[id] = answer.noul;
		// 注釈が無い記事は icon の正解が無いので、icon の評価からは外す
		if (answer.type === "choice" && annotation) {
			iconCase = {
				slug: post.slug,
				expected: annotation.icon,
				predicted: answer.choice,
				confidence: answer.confidence,
			};
		}
	}
	return {
		model: result.model,
		inputTokens: result.usage.input_tokens,
		tagCase: {
			slug: post.slug,
			expected: (post.tags ?? []).filter((tag) => !isInternalTag(tag)),
			probabilities,
		},
		iconCase,
	};
}

async function run(): Promise<void> {
	const client = createTypesafeClient();
	const questions: Record<string, Question> = {
		...buildTagQuestions(loadVocabulary()),
		[ICON_QUESTION_ID]: buildIconQuestion(),
	};
	const annotations = loadPublicAnnotations();
	const fileNames = readdirSync(CONTENT_DIR)
		.filter((fileName) => fileName.endsWith(POST_JSON_SUFFIX))
		.sort();

	const results: SavedResults = {
		model: "",
		inputTokens: 0,
		tagCases: [],
		iconCases: [],
	};
	for (let start = 0; start < fileNames.length; start += CONCURRENCY) {
		const batch = await Promise.all(
			fileNames
				.slice(start, start + CONCURRENCY)
				.map((fileName) => judgePost(client, fileName, questions, annotations)),
		);
		for (const judged of batch) {
			if (!judged) continue;
			results.model = judged.model;
			results.inputTokens += judged.inputTokens;
			results.tagCases.push(judged.tagCase);
			if (judged.iconCase) results.iconCases.push(judged.iconCase);
		}
		console.error(
			`${String(Math.min(start + CONCURRENCY, fileNames.length))} / ${String(fileNames.length)} 件`,
		);
	}

	mkdirSync(RESULTS_DIR, { recursive: true });
	writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, "\t")}\n`);
	printReport(results, DEFAULT_THRESHOLD);
}

function report(thresholdArg: string | undefined): void {
	const threshold =
		thresholdArg === undefined ? DEFAULT_THRESHOLD : Number(thresholdArg);
	if (!(threshold > 0 && threshold < 1)) {
		throw new Error(
			`しきい値は 0 より大きく 1 より小さい数で指定してください: ${String(thresholdArg)}`,
		);
	}
	if (!existsSync(RESULTS_PATH)) {
		throw new Error(
			"保存済みの結果がありません。先に pnpm jev-eval run を実行してください",
		);
	}
	const results = JSON.parse(
		readFileSync(RESULTS_PATH, "utf8"),
	) as SavedResults;
	printReport(results, threshold);
}

function formatRatio(value: number | null): string {
	return value === null ? "-" : value.toFixed(2);
}

function printReport(results: SavedResults, threshold: number): void {
	const cost = (results.inputTokens / 1_000_000) * INPUT_PRICE_PER_MTOK;
	console.log(
		`モデル: ${results.model} / 入力 ${String(results.inputTokens)} トークン（約 $${cost.toFixed(4)}）`,
	);

	const tagReport = evaluateTags(results.tagCases, loadVocabulary(), threshold);
	console.log(
		`\n## タグ（${String(results.tagCases.length)} 記事、しきい値 ${String(threshold)}）`,
	);
	console.log("タグ\t正解一致\t過剰\t見逃し\t適合率\t再現率");
	for (const metrics of tagReport.perTag) {
		console.log(
			[
				metrics.tag,
				metrics.truePositive,
				metrics.falsePositive,
				metrics.falseNegative,
				formatRatio(metrics.precision),
				formatRatio(metrics.recall),
			].join("\t"),
		);
	}
	console.log("\n### 食い違い（正解 → Jev の確率）");
	for (const item of tagReport.disagreements) {
		console.log(
			`${item.slug}\t${item.tag}\t${item.expected ? "付いている" : "付いていない"}\t${item.probability.toFixed(2)}`,
		);
	}

	const iconReport = evaluateIcons(results.iconCases);
	console.log(
		`\n## icon: ${String(iconReport.matched)} / ${String(iconReport.total)} 件が注釈と一致`,
	);
	for (const item of iconReport.mismatches) {
		console.log(
			`${item.slug}\t注釈 ${item.expected ?? "なし"}\tJev ${item.predicted}\t確信度 ${item.confidence.toFixed(2)}`,
		);
	}
}

/** 注釈の要約が付いた公開記事を集める。限定記事は content/ 直下にも strata/ 直下にも無いので含まれない */
function loadSummarizedPosts(
	annotations: ReadonlyMap<string, StrataAnnotation>,
): SummarizedPost[] {
	const posts: SummarizedPost[] = [];
	for (const fileName of readdirSync(CONTENT_DIR).sort()) {
		if (!fileName.endsWith(POST_JSON_SUFFIX)) continue;
		const post = readPublishedPost(
			readFileSync(path.join(CONTENT_DIR, fileName), "utf8"),
			fileName,
		);
		if (isPrivateVisibility(post.visibility)) {
			throw new Error(
				`${fileName}: 限定記事が content/ 直下にあります。外部の API に送らないよう中断します`,
			);
		}
		const annotation = annotations.get(post.slug);
		if (post.status !== "published" || !post.published_at || !annotation) {
			continue;
		}
		posts.push({
			slug: post.slug,
			title: post.title,
			published_at: post.published_at,
			summary: annotation.summary,
		});
	}
	return posts;
}

async function relationsRun(): Promise<void> {
	const client = createTypesafeClient();
	const annotations = loadPublicAnnotations();
	const pairs = buildRelationPairs(loadSummarizedPosts(annotations));
	const questions = buildRelationQuestions();

	const results: SavedRelations = { model: "", inputTokens: 0, judgments: [] };
	for (let start = 0; start < pairs.length; start += RELATION_CONCURRENCY) {
		const batch = await Promise.all(
			pairs.slice(start, start + RELATION_CONCURRENCY).map(async (pair) => {
				const result = await client.systemOne({
					state: buildRelationState(pair.newer, pair.older),
					questions,
				});
				return { pair, result };
			}),
		);
		for (const { pair, result } of batch) {
			results.model = result.model;
			results.inputTokens += result.usage.input_tokens;
			results.judgments.push({
				newer: pair.newer.slug,
				older: pair.older.slug,
				probability: result.answers.related.noul,
				type: result.answers.relation_type.choice,
				typeConfidence: result.answers.relation_type.confidence,
			});
		}
		if (start % PROGRESS_INTERVAL === 0) {
			console.error(`${String(start)} / ${String(pairs.length)} 組`);
		}
	}

	mkdirSync(RESULTS_DIR, { recursive: true });
	writeFileSync(RELATIONS_PATH, `${JSON.stringify(results, null, "\t")}\n`);
	printRelationsReport(results, annotations, DEFAULT_TOP_K);
}

function relationsReport(topKArg: string | undefined): void {
	const topK = topKArg === undefined ? DEFAULT_TOP_K : Number(topKArg);
	if (!Number.isInteger(topK) || topK < 1) {
		throw new Error(`K は 1 以上の整数で指定してください: ${String(topKArg)}`);
	}
	if (!existsSync(RELATIONS_PATH)) {
		throw new Error(
			"保存済みの結果がありません。先に pnpm jev-eval relations-run を実行してください",
		);
	}
	const results = JSON.parse(
		readFileSync(RELATIONS_PATH, "utf8"),
	) as SavedRelations;
	printRelationsReport(results, loadPublicAnnotations(), topK);
}

function printRelationsReport(
	results: SavedRelations,
	annotations: ReadonlyMap<string, StrataAnnotation>,
	topK: number,
): void {
	const cost = (results.inputTokens / 1_000_000) * INPUT_PRICE_PER_MTOK;
	console.log(
		`モデル: ${results.model} / ${String(results.judgments.length)} 組 / 入力 ${String(results.inputTokens)} トークン（約 $${cost.toFixed(4)}）`,
	);

	// 正解は注釈の relations。判定した組に無い相手（限定記事など）は評価の対象外
	const judged = new Map(
		results.judgments.map((judgment) => [
			`${judgment.newer}\t${judgment.older}`,
			judgment,
		]),
	);
	const known: KnownRelation[] = [];
	const typeCases: RelationTypeCase[] = [];
	for (const annotation of annotations.values()) {
		for (const relation of annotation.relations) {
			const judgment = judged.get(`${annotation.slug}\t${relation.slug}`);
			if (!judgment) continue;
			known.push({ newer: annotation.slug, older: relation.slug });
			typeCases.push({
				newer: annotation.slug,
				older: relation.slug,
				expected: relation.type,
				predicted: judgment.type,
				confidence: judgment.typeConfidence,
			});
		}
	}

	const ranking = evaluateRelationRanking(results.judgments, known, topK);
	console.log(
		`\n## 候補の絞り込み: 既知の関係 ${String(ranking.knownTotal)} 本のうち ${String(ranking.knownInTopK)} 本が上位 ${String(topK)} 件に入った`,
	);
	console.log("### 上位に入らなかった既知の関係（順位、確率）");
	for (const item of ranking.missed) {
		console.log(
			`${item.newer} → ${item.older}\t${String(item.rank)} 位\t${item.probability.toFixed(2)}`,
		);
	}

	console.log(
		`\n## 埋もれた関係の候補（注釈に無い組、確率の高い順に ${String(UNLISTED_DISPLAY_COUNT)} 件）`,
	);
	for (const item of ranking.unlisted.slice(0, UNLISTED_DISPLAY_COUNT)) {
		console.log(
			`${item.newer} → ${item.older}\t${item.probability.toFixed(2)}`,
		);
	}

	const types = evaluateRelationTypes(typeCases);
	console.log(
		`\n## 関係の種類: 既知の関係 ${String(types.total)} 本のうち ${String(types.matched)} 本が注釈と一致`,
	);
	for (const item of types.mismatches) {
		console.log(
			`${item.newer} → ${item.older}\t注釈 ${item.expected}\tJev ${item.predicted}\t確信度 ${item.confidence.toFixed(2)}`,
		);
	}
}

async function main(): Promise<void> {
	const [command, arg] = process.argv.slice(2);
	if (command === "run") return run();
	if (command === "report") return report(arg);
	if (command === "relations-run") return relationsRun();
	if (command === "relations-report") return relationsReport(arg);
	usage();
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
