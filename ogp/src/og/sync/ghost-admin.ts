/**
 * Ghost Admin API クライアント（OGP 事前生成に必要な操作のみ）
 *
 * 認証は Admin API キー（`<id>:<secret>`）から生成する短命の JWT で行います。
 * 画像は images/upload に multipart で送り、返された URL を記事の og_image と twitter_image に設定します。
 * Ghost は twitter_image を og_image にフォールバックしないため、両方を設定する必要があります。
 */

import { createHmac } from "node:crypto";
import type { GhostPost } from "./plan";

/** JWT の有効期間（秒）。Ghost の上限は 5 分 */
const TOKEN_TTL_SECONDS = 5 * 60;

/**
 * Admin API キーから認証用 JWT を生成する
 *
 * @param apiKey - `<id>:<secret>` 形式の Admin API キー
 * @param nowSeconds - 発行時刻（テスト用に差し替え可能）
 */
export function createAdminToken(
	apiKey: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const [id, secret] = apiKey.split(":");
	if (!id || !secret) {
		throw new Error(
			'GHOST_ADMIN_API_KEY は "<id>:<secret>" 形式である必要があります',
		);
	}
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const header = encode({ alg: "HS256", typ: "JWT", kid: id });
	const payload = encode({
		iat: nowSeconds,
		exp: nowSeconds + TOKEN_TTL_SECONDS,
		aud: "/admin/",
	});
	const signature = createHmac("sha256", Buffer.from(secret, "hex"))
		.update(`${header}.${payload}`)
		.digest("base64url");
	return `${header}.${payload}.${signature}`;
}

/**
 * OGP 事前生成が利用する Admin API 操作
 */
export interface GhostAdminClient {
	/** サイト名（OGP 画像に描くサイト名として使う） */
	getSiteTitle(): Promise<string>;
	/** 公開済みで feature_image が無く、og_image か twitter_image が未設定の記事を著者込みで取得する */
	listPostsNeedingOgImage(): Promise<GhostPost[]>;
	/** PNG をアップロードし、公開 URL を返す */
	uploadImage(png: Uint8Array<ArrayBuffer>, filename: string): Promise<string>;
	/** 記事の og_image と twitter_image に同じ画像を設定する（updated_at による楽観ロック付き） */
	setSocialImages(
		post: Pick<GhostPost, "id" | "updated_at">,
		imageUrl: string,
	): Promise<void>;
}

export interface GhostAdminClientOptions {
	/** サイトの URL（例: https://hanatane.net） */
	adminUrl: string;
	/** Admin API キー（`<id>:<secret>`） */
	apiKey: string;
	/** テスト用に差し替え可能な fetch */
	fetchImpl?: typeof fetch;
}

/**
 * Admin API クライアントを生成する
 */
export function createGhostAdminClient({
	adminUrl,
	apiKey,
	fetchImpl = fetch,
}: GhostAdminClientOptions): GhostAdminClient {
	const baseUrl = `${adminUrl.replace(/\/+$/, "")}/ghost/api/admin`;

	/**
	 * 認証ヘッダ付きでリクエストし、JSON を返す。エラー応答は例外にする
	 */
	async function request<T>(
		method: string,
		path: string,
		body?: BodyInit,
		contentType?: string,
	): Promise<T> {
		const headers: Record<string, string> = {
			Authorization: `Ghost ${createAdminToken(apiKey)}`,
			"Accept-Version": "v6.0",
		};
		if (contentType) {
			headers["Content-Type"] = contentType;
		}
		const response = await fetchImpl(`${baseUrl}${path}`, {
			method,
			headers,
			body,
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`Ghost Admin API ${method} ${path} が失敗しました (${response.status}): ${text}`,
			);
		}
		return (await response.json()) as T;
	}

	return {
		async getSiteTitle() {
			const { site } = await request<{ site: { title: string } }>(
				"GET",
				"/site/",
			);
			return site.title;
		},

		async listPostsNeedingOgImage() {
			const filter = encodeURIComponent(
				// NQL: 括弧内のカンマは OR
				"status:published+feature_image:null+(og_image:null,twitter_image:null)",
			);
			const { posts } = await request<{ posts: GhostPost[] }>(
				"GET",
				`/posts/?limit=all&filter=${filter}&include=authors`,
			);
			return posts;
		},

		async uploadImage(png, filename) {
			const form = new FormData();
			form.set("file", new File([png], filename, { type: "image/png" }));
			form.set("purpose", "image");
			form.set("ref", filename);
			// Content-Type は fetch が boundary 付きで自動設定するため指定しない
			const { images } = await request<{ images: { url: string }[] }>(
				"POST",
				"/images/upload/",
				form,
			);
			return images[0].url;
		},

		async setSocialImages(post, imageUrl) {
			await request(
				"PUT",
				`/posts/${post.id}/`,
				JSON.stringify({
					posts: [
						{
							og_image: imageUrl,
							twitter_image: imageUrl,
							updated_at: post.updated_at,
						},
					],
				}),
				"application/json",
			);
		},
	};
}
