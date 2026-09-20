/**
 * `strata catalog` の一覧に、Jev（TypeSafe の判定モデル）が判定した「関係がある確率」を付ける
 *
 * strata-annotate スキルでは、Claude Code が過去記事の一覧から関係の候補を目で選ぶ。
 * 記事が増えるほど見落としやすいので、要約どうしを Jev に判定させた確率の順に並べて、候補選びを補助する。
 * 評価（src/jev-relation-eval.ts、2026-09-20）では、既知の関係 81 本のうち 86% が上位 8 件、96% が上位 16 件に入った。
 *
 * 確率は候補選びの補助にすぎない。関係を採用するか、種類は何かは、これまでどおり Claude Code が本文を読んで決める。
 * このモジュールは対象の絞り込みと並べ替えだけを担当する。API の呼び出しは scripts/strata.ts が行う。
 */
import path from "node:path";
import { isPrivateVisibility, PRIVATE_DIR } from "./private-post";
import { type CatalogEntry, type PublishedPost, STRATA_DIR } from "./strata";

/** 記事の本文を置くディレクトリ（posts/ からの相対） */
const CONTENT_DIR = "content";

/** Jev が判定した確率つきの一覧の 1 件。判定していない記事（限定記事・未注釈）は null */
export type RankedCatalogEntry = CatalogEntry & {
	jev_probability: number | null;
};

/** 要約がある公開記事（Jev に判定させる過去記事） */
export type JevCandidate = CatalogEntry & { summary: string };

/**
 * 一覧から、Jev に判定させる過去記事を選びます。
 * 限定記事の要約は外部の API に送らないので対象から外し、対象記事そのものが限定記事ならエラーにします。
 * 要約が無い記事（未注釈）も、判定の材料が無いので外します。
 */
export function selectJevCandidates(
	target: PublishedPost,
	catalog: readonly CatalogEntry[],
): JevCandidate[] {
	if (isPrivateVisibility(target.visibility)) {
		throw new Error(
			`${target.slug}: 限定記事の要約は外部の API に送れません。--jev-summary を付けずに実行してください`,
		);
	}
	return catalog.filter(
		(entry): entry is JevCandidate =>
			!isPrivateVisibility(entry.visibility) && entry.summary !== null,
	);
}

/**
 * 一覧に確率を付け、確率の高い順に並べます。
 * 判定していない記事は jev_probability を null にして、元の順（公開日の古い順）のまま末尾に置きます。
 *
 * @param probabilities - 過去記事の slug をキーにした「関係がある」確率
 */
export function rankCatalog(
	catalog: readonly CatalogEntry[],
	probabilities: ReadonlyMap<string, number>,
): RankedCatalogEntry[] {
	const entries = catalog.map(
		(entry): RankedCatalogEntry => ({
			...entry,
			jev_probability: probabilities.get(entry.slug) ?? null,
		}),
	);
	const judged = entries
		.filter((entry) => entry.jev_probability !== null)
		.sort((a, b) => (b.jev_probability ?? 0) - (a.jev_probability ?? 0));
	const notJudged = entries.filter((entry) => entry.jev_probability === null);
	return [...judged, ...notJudged];
}

/**
 * 要約ファイルが、限定記事の置き場所（content/private/、strata/private/）の下に無いことを確かめます。
 * 要約はプレーンテキストで、どの記事のものかを中身からは確かめられないため、
 * 限定記事の平文作業ファイル（`<slug>.plain.json` など）を誤って渡して外部の API に送る事故を、置き場所で防ぎます。
 *
 * @param summaryFile - 要約ファイルのパス（相対パスは実行時のカレントディレクトリから解決する）
 * @param postsDir - posts/ の絶対パス
 */
export function checkJevSummaryPath(
	summaryFile: string,
	postsDir: string,
): void {
	const resolved = path.resolve(summaryFile);
	for (const parent of [CONTENT_DIR, STRATA_DIR]) {
		const privateDir = path.join(postsDir, parent, PRIVATE_DIR);
		const relative = path.relative(privateDir, resolved);
		// privateDir の下にあるパスは、相対パスが ".." で始まらず、絶対パスにもならない
		if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
			throw new Error(
				`${summaryFile}: ${parent}/${PRIVATE_DIR}/ の下のファイルは要約ファイルにできません（限定記事の内容を外部の API に送らないため）`,
			);
		}
	}
}
