/**
 * OGP 画像の事前生成: 対象記事の選定と描画パラメータの組み立て（純粋関数）
 *
 * Ghost Admin API から取得した記事のうち、feature_image が無く og_image か twitter_image が未設定のものを対象にし、
 * 記事のタグ（`posts/tags.json` の統制語彙）からグラデーションを選んで `OgpRenderParams` を組み立てます。
 * 対応するタグが無い記事は slug から決定的に選びます。
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
	twitter_image: string | null;
	/** `include=authors` で取得したときに入る */
	primary_author?: { name: string } | null;
	/** `include=tags` で取得したときに入る（Ghost 上の並び順） */
	tags?: { slug: string }[];
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
 * 統制語彙（`posts/tags.json`）のタグ slug とグラデーションプリセットの対応表
 *
 * 配色は著者の好みで決めています。`ghost-tag` と `street-fighter-6` は
 * `tech` / `game` と併用するタグなので対応表に入れません。
 * キーが統制語彙に存在することは `plan.test.ts` で検査しています。
 */
export const TAG_GRADIENTS: Record<string, GradientPreset> = {
	tech: "ocean",
	diary: "sunset",
	tanehouse: "orange",
	cat: "pink",
	hunting: "forest",
	game: "purple",
	reading: "green",
};

/**
 * グラデーションの選択結果（何を根拠に選んだかをログに残すために返す）
 */
export type GradientChoice =
	| { gradient: GradientPreset; source: "tag"; tag: string }
	| { gradient: GradientPreset; source: "hash" };

/**
 * 記事のタグからグラデーションプリセットを選ぶ
 *
 * タグを先頭から見て、最初に `TAG_GRADIENTS` に対応が見つかったものを採用します。
 * 対応するタグが無い記事（Ghost の管理画面から直接公開した記事など）は `gradientForSlug` で選び、
 * 呼び出し側がログに残せるよう `source: "hash"` を返します。
 *
 * @throws tags が取得できていない場合（`include=tags` の指定漏れを隠さないため）
 */
export function selectGradient(post: GhostPost): GradientChoice {
	if (!post.tags) {
		throw new Error(
			`記事 ${post.slug} のタグを取得できません（include=authors,tags を確認してください）`,
		);
	}
	const tag = post.tags.find(({ slug }) => Object.hasOwn(TAG_GRADIENTS, slug));
	if (!tag) {
		return { gradient: gradientForSlug(post.slug), source: "hash" };
	}
	return { gradient: TAG_GRADIENTS[tag.slug], source: "tag", tag: tag.slug };
}

/**
 * feature_image が無く、og_image か twitter_image のどちらかが未設定の記事だけを返す
 *
 * API 側のフィルタと二重になりますが、空文字を null と同様に扱うための防御です。
 */
export function selectPostsNeedingOgImage(posts: GhostPost[]): GhostPost[] {
	return posts.filter(
		(post) => !post.feature_image && (!post.og_image || !post.twitter_image),
	);
}

/**
 * 既に生成済みの画像 URL があれば返す（再生成と二重アップロードを避けるため）
 */
export function existingSocialImage(post: GhostPost): string | null {
	return post.og_image || post.twitter_image || null;
}

/**
 * 記事・サイト名・選択済みのグラデーションから描画パラメータを組み立てる
 *
 * グラデーションは呼び出し側が `selectGradient` で選んで渡します（選択の根拠をログに残すため）。
 *
 * @throws 著者名が取得できない場合（`include=authors` の指定漏れを隠さないため）
 */
export function buildRenderParams(
	post: GhostPost,
	siteTitle: string,
	gradient: GradientPreset,
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
		gradient,
	};
}
