/**
 * OGP 画像の事前生成フロー
 *
 * 対象記事を取得 → 描画 → Ghost にアップロード → og_image を設定、を記事ごとに行います。
 * 途中で失敗した場合は例外をそのまま投げて停止します（暗黙のスキップはしない）。
 */

import type { OgpRenderParams } from "@/og/params";
import type { GhostAdminClient } from "./ghost-admin";
import {
	buildRenderParams,
	existingSocialImage,
	selectPostsNeedingOgImage,
} from "./plan";

export interface SyncOgImagesOptions {
	client: GhostAdminClient;
	/** 描画関数（実行環境ごとの資源読み込みを外側で済ませて渡す） */
	render: (params: OgpRenderParams) => Promise<Uint8Array<ArrayBuffer>>;
	/** true なら対象を表示するだけで何も書き換えない */
	dryRun: boolean;
	log: (message: string) => void;
}

export interface SyncOgImagesResult {
	/** 対象となった記事の slug */
	planned: string[];
	/** og_image を設定した記事の slug */
	updated: string[];
}

/**
 * アップロードするファイル名（Ghost 側で重複時は自動で連番が付く）
 */
function ogImageFilename(slug: string): string {
	return `og-${slug}.png`;
}

export async function syncOgImages({
	client,
	render,
	dryRun,
	log,
}: SyncOgImagesOptions): Promise<SyncOgImagesResult> {
	const posts = selectPostsNeedingOgImage(
		await client.listPostsNeedingOgImage(),
	);
	const planned = posts.map((post) => post.slug);
	if (posts.length === 0) {
		log("OGP 画像が必要な記事はありません");
		return { planned, updated: [] };
	}
	log(`対象記事: ${planned.join(", ")}`);
	if (dryRun) {
		log("dry-run のため生成・更新は行いません");
		return { planned, updated: [] };
	}

	// 全記事が生成済み画像の再利用で済む場合はサイト名の取得も不要
	const needsRender = posts.some((post) => !existingSocialImage(post));
	const siteTitle = needsRender ? await client.getSiteTitle() : "";
	const updated: string[] = [];
	for (const post of posts) {
		let imageUrl = existingSocialImage(post);
		if (imageUrl) {
			log(`${post.slug}: 生成済みの画像を再利用します → ${imageUrl}`);
		} else {
			const png = await render(buildRenderParams(post, siteTitle));
			imageUrl = await client.uploadImage(png, ogImageFilename(post.slug));
		}
		await client.setSocialImages(post, imageUrl);
		log(`${post.slug}: og_image と twitter_image を設定しました → ${imageUrl}`);
		updated.push(post.slug);
	}
	return { planned, updated };
}
