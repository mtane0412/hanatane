/**
 * Jev（TypeSafe の判定モデル）の日本語精度を、既存のタグと icon を正解にして測るスクリプト
 *
 * 使い方:
 *   pnpm jev-eval run                # 公開記事を Jev に判定させ、結果を .jev-eval/results.json に保存して集計を表示する
 *   pnpm jev-eval report [しきい値]  # 保存済みの結果を集計し直す（API を呼ばない）。しきい値の既定は 0.5
 *   pnpm jev-eval relations-run      # 公開記事の注釈の要約どうしの全組を Jev に判定させ、.jev-eval/relations.json に保存して集計を表示する
 *   pnpm jev-eval relations-report [K]  # 保存済みの結果を集計し直す（API を呼ばない）。K は上位何件を候補とみなすか。既定は 8
 *   pnpm jev-eval strength-run       # 既知の関係（注釈の relations）だけに強さの score を聞き、.jev-eval/strength.json に保存して集計を表示する
 *   pnpm jev-eval strength-report    # 保存済みの結果を集計し直す（API を呼ばない）
 *
 * 注意:
 *   - run、relations-run、strength-run には TypeSafe の API キーが必要。sops で暗号化した secrets/typesafe.env から読む
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
	buildStrengthQuestion,
	evaluateRelationRanking,
	evaluateRelationTypes,
	evaluateStrength,
	type KnownRelation,
	normalizeStrength,
	type RelationTypeCase,
	type StrengthCase,
	type SummarizedPost,
} from "../src/jev-relation-eval";
import { POST_JSON_SUFFIX } from "../src/post-json";
import { isPrivateVisibility } from "../src/private-post";
import {
	PLAIN_STRATA_SUFFIX,
	parseStrataAnnotation,
	readPublishedPost,
	STRATA_DIR,
	STRATA_SUFFIX,
	type StrataAnnotation,
	selectLatestAnnotations,
} from "../src/strata";
import { readBodyText } from "./lib/read-body";
import { createTypesafeClient } from "./lib/typesafe-client";

const POSTS_DIR = path.resolve(import.meta.dirname, "..");
const CONTENT_DIR = path.join(POSTS_DIR, "content");
const STRATA_ROOT = path.join(POSTS_DIR, STRATA_DIR);
const RESULTS_DIR = path.join(POSTS_DIR, ".jev-eval");
const RESULTS_PATH = path.join(RESULTS_DIR, "results.json");
const RELATIONS_PATH = path.join(RESULTS_DIR, "relations.json");
const STRENGTH_PATH = path.join(RESULTS_DIR, "strength.json");

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
/** icon の一致率を測る確信度のしきい値。0 は Jev の選択をそのまま使う */
const ICON_THRESHOLDS = [0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
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

/** .jev-eval/strength.json の形。probability は relations.json の「関係がある確率」の写し（無ければ null） */
interface SavedStrength {
	model: string;
	inputTokens: number;
	cases: StrengthCase[];
}

function usage(): never {
	console.error(
		"使い方: pnpm jev-eval <run | report [しきい値] | relations-run | relations-report [K] | strength-run | strength-report>",
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

	// icon は「確信度がしきい値未満なら省略」としたときの一致率を、しきい値を振って並べる
	console.log(
		`\n## icon（${String(results.iconCases.length)} 記事）: 確信度がしきい値未満の判定を「該当なし」にしたときの一致`,
	);
	console.log("しきい値\t一致\t省略\t食い違い");
	for (const iconThreshold of ICON_THRESHOLDS) {
		const swept = evaluateIcons(results.iconCases, iconThreshold);
		console.log(
			[
				iconThreshold.toFixed(1),
				swept.matched,
				swept.omitted,
				swept.mismatches.length,
			].join("\t"),
		);
	}
	const iconReport = evaluateIcons(results.iconCases, 0);
	console.log("\n### 食い違い（しきい値なし）");
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

/** relations.json があれば「関係がある確率」を組ごとに引けるようにする。無ければ空（確率との比較を省く） */
function loadRelationProbabilities(): Map<string, number> {
	if (!existsSync(RELATIONS_PATH)) return new Map();
	const relations = JSON.parse(
		readFileSync(RELATIONS_PATH, "utf8"),
	) as SavedRelations;
	return new Map(
		relations.judgments.map((judgment) => [
			`${judgment.newer}\t${judgment.older}`,
			judgment.probability,
		]),
	);
}

async function strengthRun(): Promise<void> {
	const client = createTypesafeClient();
	const annotations = loadPublicAnnotations();
	const postBySlug = new Map(
		loadSummarizedPosts(annotations).map((post) => [post.slug, post]),
	);
	const probabilities = loadRelationProbabilities();
	const questions = { strength: buildStrengthQuestion() };

	// 対象は公開記事どうしの既知の関係だけ。相手が限定記事や未注釈の関係は要約を送れないので飛ばす
	const targets = [];
	for (const annotation of annotations.values()) {
		const newer = postBySlug.get(annotation.slug);
		if (!newer) continue;
		for (const relation of annotation.relations) {
			const older = postBySlug.get(relation.slug);
			if (older) targets.push({ newer, older, type: relation.type });
		}
	}

	const results: SavedStrength = { model: "", inputTokens: 0, cases: [] };
	for (let start = 0; start < targets.length; start += RELATION_CONCURRENCY) {
		const batch = await Promise.all(
			targets.slice(start, start + RELATION_CONCURRENCY).map(async (target) => {
				const result = await client.systemOne({
					state: buildRelationState(target.newer, target.older),
					questions,
				});
				return { target, result };
			}),
		);
		for (const { target, result } of batch) {
			results.model = result.model;
			results.inputTokens += result.usage.input_tokens;
			results.cases.push({
				newer: target.newer.slug,
				older: target.older.slug,
				type: target.type,
				strength: normalizeStrength(result.answers.strength.score),
				probability:
					probabilities.get(`${target.newer.slug}\t${target.older.slug}`) ??
					null,
			});
		}
	}

	mkdirSync(RESULTS_DIR, { recursive: true });
	writeFileSync(STRENGTH_PATH, `${JSON.stringify(results, null, "\t")}\n`);
	printStrengthReport(results);
}

function strengthReport(): void {
	if (!existsSync(STRENGTH_PATH)) {
		throw new Error(
			"保存済みの結果がありません。先に pnpm jev-eval strength-run を実行してください",
		);
	}
	printStrengthReport(
		JSON.parse(readFileSync(STRENGTH_PATH, "utf8")) as SavedStrength,
	);
}

function printStrengthReport(results: SavedStrength): void {
	const cost = (results.inputTokens / 1_000_000) * INPUT_PRICE_PER_MTOK;
	console.log(
		`モデル: ${results.model} / 既知の関係 ${String(results.cases.length)} 本 / 入力 ${String(results.inputTokens)} トークン（約 $${cost.toFixed(4)}）`,
	);
	const report = evaluateStrength(results.cases);
	console.log("\n## 関係の種類ごとの分布（中央値 / 最小 / 最大）");
	for (const item of report.byType) {
		const format = (d: { median: number; min: number; max: number } | null) =>
			d === null
				? "なし"
				: `${d.median.toFixed(2)} / ${d.min.toFixed(2)} / ${d.max.toFixed(2)}`;
		console.log(
			`${item.type}\t${String(item.count)} 本\t強さ ${format(item.strength)}\t確率 ${format(item.probability)}`,
		);
	}
	console.log(`\n## 強さの度数分布（0.1 刻み）: ${report.histogram.join(" ")}`);

	console.log("\n## 関係ごとの強さ（新しい記事ごとに強い順）");
	const sorted = [...results.cases].sort(
		(a, b) => a.newer.localeCompare(b.newer) || b.strength - a.strength,
	);
	for (const item of sorted) {
		console.log(
			`${item.newer} → ${item.older}\t${item.type}\t強さ ${item.strength.toFixed(2)}\t確率 ${item.probability === null ? "なし" : item.probability.toFixed(2)}`,
		);
	}
}

async function main(): Promise<void> {
	const [command, arg] = process.argv.slice(2);
	if (command === "run") return run();
	if (command === "report") return report(arg);
	if (command === "relations-run") return relationsRun();
	if (command === "relations-report") return relationsReport(arg);
	if (command === "strength-run") return strengthRun();
	if (command === "strength-report") return strengthReport();
	usage();
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
