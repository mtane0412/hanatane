/**
 * OGP 画像の事前生成: 対象記事の選定と描画パラメータの組み立て（純粋関数）
 *
 * Ghost Admin API から取得した記事のうち、feature_image も og_image も無いものを対象にし、
 * slug から決定的にグラデーションを選んで `OgpRenderParams` を組み立てます。
 */

import type { OgpRenderParams } from "@/og/params";
import { GRADIENT_PRESETS, type GradientPreset } from "@/types/ogp";

/**
 * Ghost Admin API の記事（本処理で参照するフィールドのみ）
 */
export interface GhostPost {
	id: string;
	slug: string;
	title: string;
	/** 更新時の楽観ロックに使う */
	updated_at: string;
	feature_image: string | null;
	og_image: string | null;
	/** `include=authors` で取得したときに入る */
	primary_author?: { name: string } | null;
}

/** グラデーションプリセット名の一覧（定義順で固定） */
const GRADIENT_NAMES = Object.keys(GRADIENT_PRESETS) as GradientPreset[];

/**
 * slug からグラデーションプリセットを決定的に選ぶ
 *
 * 同じ記事は再生成しても同じ配色になり、記事ごとには分散するよう FNV-1a ハッシュを使います。
 */
export function gradientForSlug(slug: string): GradientPreset {
	let hash = 0x811c9dc5;
	for (const char of slug) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return GRADIENT_NAMES[hash % GRADIENT_NAMES.length];
}

/**
 * feature_image と og_image のどちらも設定されていない記事だけを返す
 *
 * API 側のフィルタと二重になりますが、空文字を null と同様に扱うための防御です。
 */
export function selectPostsNeedingOgImage(posts: GhostPost[]): GhostPost[] {
	return posts.filter((post) => !post.feature_image && !post.og_image);
}

/**
 * 記事とサイト名から描画パラメータを組み立てる
 *
 * @throws 著者名が取得できない場合（`include=authors` の指定漏れを隠さないため）
 */
export function buildRenderParams(
	post: GhostPost,
	siteTitle: string,
): OgpRenderParams {
	const authorName = post.primary_author?.name;
	if (!authorName) {
		throw new Error(
			`記事 ${post.slug} の著者名を取得できません（include=authors を確認してください）`,
		);
	}
	return {
		title: post.title,
		siteName: siteTitle,
		authorName,
		gradient: gradientForSlug(post.slug),
	};
}
