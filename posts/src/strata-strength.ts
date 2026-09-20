/**
 * Hyperstrata の関係の強さ（strata-strength.json）の読み書きと、計算が要る関係の洗い出し
 *
 * 関係の強さは Jev の score（src/jev-relation-eval.ts の buildStrengthQuestion）を 0〜1 に正規化した値で、
 * theme/scripts/hyperstrata-sync.mjs が graph.json の inferredRefs[].strength に載せる（#56）。
 *
 * 置き場所を注釈（strata/<slug>.json）と分けている理由:
 *   - 注釈は研究者（Claude Code）の判断の記録で、書き換えない方針。強さは Jev の版が変われば計算し直す派生データ
 *   - CI は Jev を呼ばない。手元で `pnpm strata strength` を実行して事前計算し、sync は読むだけにする
 *
 * 注意:
 *   - 要約を外部の API に送るので、対象は公開記事どうしの関係だけ。限定記事が絡む関係は強さを持たない
 *   - このモジュールは形式の検査と差分の計算だけを担当する。API の呼び出しとファイル入出力は scripts/strata.ts が行う
 */

import type { RelationPair, SummarizedPost } from "./jev-relation-eval";
import { isPrivateVisibility } from "./private-post";
import type { PublishedPost, StrataAnnotation } from "./strata";

/** posts/ から見た強さのファイルのパス */
export const STRENGTH_FILE = "strata-strength.json";

/** 強さを保存するときの小数の桁数。Jev の score の揺れより細かい桁を残さず、差分を小さくする */
const STRENGTH_DECIMALS = 2;

/** 関係の向き。from が新しい記事（注釈を持つ側）、to が過去記事 */
export interface RelationKey {
	from: string;
	to: string;
}

export interface RelationStrength extends RelationKey {
	/** 0（分野が同じだけ）〜 1（過去記事を直接受けている） */
	strength: number;
	/** 強さを判定した Jev の版。版が変わったときに計算し直す対象を見分けるために残す */
	model: string;
}

function keyOf(relation: RelationKey): string {
	return `${relation.from}\t${relation.to}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 強さを計算できる関係（公開記事どうし）を、Jev に渡すタイトルと要約つきで選びます。
 *
 * @param posts content/ の記事一覧
 * @param publicAnnotations strata/ 直下（公開記事）の注釈だけ。限定記事の注釈（strata/private/）は渡さないこと
 * @throws 公開記事の注釈に限定記事のものが混ざっている場合（要約を外部の API に送らないための歯止め）
 */
export function selectStrengthTargets(
	posts: readonly PublishedPost[],
	publicAnnotations: ReadonlyMap<string, StrataAnnotation>,
): RelationPair[] {
	const postBySlug = new Map(posts.map((post) => [post.slug, post]));
	const summarized = new Map<string, SummarizedPost>();
	for (const annotation of publicAnnotations.values()) {
		const post = postBySlug.get(annotation.slug);
		if (post?.status !== "published" || !post.published_at) continue;
		if (isPrivateVisibility(post.visibility)) {
			throw new Error(
				`${post.slug}: 限定記事の注釈が公開記事の注釈に混ざっています。外部の API に送らないよう中断します`,
			);
		}
		summarized.set(post.slug, {
			slug: post.slug,
			title: post.title,
			published_at: post.published_at,
			summary: annotation.summary,
		});
	}

	const targets: RelationPair[] = [];
	for (const annotation of publicAnnotations.values()) {
		const newer = summarized.get(annotation.slug);
		if (!newer) continue;
		for (const relation of annotation.relations) {
			const older = summarized.get(relation.slug);
			if (older) targets.push({ newer, older });
		}
	}
	return targets;
}

/** strata-strength.json を検査して読みます。形式が崩れていれば、どこが悪いかを示してエラーにします。 */
export function parseStrengthFile(
	content: string,
	fileName: string,
): RelationStrength[] {
	const data: unknown = JSON.parse(content);
	if (!isRecord(data) || !Array.isArray(data.strengths)) {
		throw new Error(`${fileName}: strengths は配列にしてください`);
	}
	const seen = new Set<string>();
	return data.strengths.map((item: unknown, index): RelationStrength => {
		const context = `${fileName}: strengths[${String(index)}]`;
		if (!isRecord(item)) {
			throw new Error(`${context} はオブジェクトにしてください`);
		}
		const { from, to, strength, model } = item;
		if (typeof from !== "string" || from === "") {
			throw new Error(`${context}.from は空でない文字列にしてください`);
		}
		if (typeof to !== "string" || to === "") {
			throw new Error(`${context}.to は空でない文字列にしてください`);
		}
		if (typeof strength !== "number" || !(strength >= 0 && strength <= 1)) {
			throw new Error(`${context}.strength は 0〜1 の数値にしてください`);
		}
		if (typeof model !== "string" || model === "") {
			throw new Error(`${context}.model は空でない文字列にしてください`);
		}
		const key = keyOf({ from, to });
		if (seen.has(key)) {
			throw new Error(`${fileName}: ${from} → ${to} が重複しています`);
		}
		seen.add(key);
		return { from, to, strength, model };
	});
}

export interface StrengthUpdatePlan {
	/** いまの注釈にも残っている、計算済みの強さ */
	kept: RelationStrength[];
	/** 強さがまだ無く、Jev に聞く関係 */
	missing: RelationKey[];
}

/**
 * いまの注釈の関係（公開記事どうし）と計算済みの強さを突き合わせます。
 * 計算済みの値は聞き直さず、注釈から消えた関係の強さは捨てます。
 */
export function planStrengthUpdate(
	relations: readonly RelationKey[],
	existing: readonly RelationStrength[],
): StrengthUpdatePlan {
	const existingByKey = new Map(existing.map((item) => [keyOf(item), item]));
	const kept: RelationStrength[] = [];
	const missing: RelationKey[] = [];
	for (const relation of relations) {
		const found = existingByKey.get(keyOf(relation));
		if (found) {
			kept.push(found);
		} else {
			missing.push({ from: relation.from, to: relation.to });
		}
	}
	return { kept, missing };
}

/** 強さを from → to の順に並べ、丸めて JSON にします（実行のたびに順序や桁で差分が出ないようにする）。 */
export function serializeStrengthFile(
	strengths: readonly RelationStrength[],
): string {
	const scale = 10 ** STRENGTH_DECIMALS;
	const sorted = [...strengths]
		.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
		.map((item) => ({
			from: item.from,
			to: item.to,
			strength: Math.round(item.strength * scale) / scale,
			model: item.model,
		}));
	return `${JSON.stringify({ strengths: sorted }, null, "\t")}\n`;
}
