/**
 * OGP 画像生成エンドポイント（サーバールート）
 *
 * `GET /og?title=...&site=...&author=...&gradient=...` で PNG を返します。
 * Ghost テーマ側はこの URL を `og:image` に指定して利用します。
 * フォントと著者アイコンは静的アセット（ASSETS バインディング）から読み込み、
 * モジュール単位でキャッシュします。
 */

import { env } from "cloudflare:workers";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { createFileRoute } from "@tanstack/react-router";
import yogaWasm from "satori/yoga.wasm";
import { OgpParamError, parseOgpParams } from "@/og/params";
import { renderOgpPng } from "@/og/render";
import type { OgpRenderResources } from "@/og/resources";

/** 静的アセット内のフォントファイルパス */
const FONT_PATH = "/fonts/LINESeedJP_OTF_Bd.otf";

/** 静的アセット内の著者アイコンパス */
const AUTHOR_ICON_PATH = "/default_icon512.png";

/** 生成画像のキャッシュ指示（ブラウザ 1 日、エッジ 1 年） */
const CACHE_CONTROL = "public, max-age=86400, s-maxage=31536000";

/** 資源読み込みの Promise（初回リクエストで作成し、以後は再利用する） */
let resourcesPromise: Promise<OgpRenderResources> | undefined;

/**
 * 静的アセットから 1 ファイルを ArrayBuffer として取得する
 *
 * @throws 取得に失敗した場合（設定ミスを隠さないため例外にする）
 */
async function fetchAsset(path: string, origin: string): Promise<ArrayBuffer> {
	const response = await env.ASSETS.fetch(new URL(path, origin));
	if (!response.ok) {
		throw new Error(
			`静的アセットの取得に失敗しました: ${path} (${response.status})`,
		);
	}
	return response.arrayBuffer();
}

/**
 * レンダリング資源をまとめて読み込む（モジュール単位でキャッシュ）
 */
function loadResources(origin: string): Promise<OgpRenderResources> {
	if (!resourcesPromise) {
		resourcesPromise = Promise.all([
			fetchAsset(FONT_PATH, origin),
			fetchAsset(AUTHOR_ICON_PATH, origin),
		]).then(([fontBold, authorIcon]) => ({
			fontBold,
			authorIcon,
			yogaWasm,
			resvgWasm,
		}));
		// 失敗した場合は次のリクエストで再試行できるようキャッシュを破棄する
		resourcesPromise.catch(() => {
			resourcesPromise = undefined;
		});
	}
	return resourcesPromise;
}

export const Route = createFileRoute("/og")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				let params: ReturnType<typeof parseOgpParams>;
				try {
					params = parseOgpParams(url.searchParams);
				} catch (error) {
					if (error instanceof OgpParamError) {
						return new Response(error.message, {
							status: 400,
							headers: { "Content-Type": "text/plain; charset=utf-8" },
						});
					}
					throw error;
				}

				const resources = await loadResources(url.origin);
				const png = await renderOgpPng(params, resources);
				return new Response(png, {
					headers: {
						"Content-Type": "image/png",
						"Cache-Control": CACHE_CONTROL,
					},
				});
			},
		},
	},
});
