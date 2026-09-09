/**
 * OGP 画像のレンダリング（JSX → SVG → PNG）
 *
 * Satori でレイアウトを SVG に描画し、resvg で PNG に変換します。
 * wasm の初期化は重いため、モジュール単位で 1 回だけ行います。
 */

import { initWasm as initResvg, Resvg } from "@resvg/resvg-wasm";
import satori, { init as initSatori } from "satori/standalone";
import { buildOgpElement, FONT_FAMILY, OGP_HEIGHT, OGP_WIDTH } from "./layout";
import type { OgpRenderParams } from "./params";
import type { OgpRenderResources } from "./resources";

export { OGP_HEIGHT, OGP_WIDTH };

/** wasm 初期化の完了を表す Promise（二重初期化を防ぐ） */
let initialization: Promise<void> | undefined;

/**
 * Satori と resvg の wasm を初期化する（初回のみ実行される）
 */
function ensureInitialized(resources: OgpRenderResources): Promise<void> {
	if (!initialization) {
		initialization = Promise.all([
			initSatori(resources.yogaWasm),
			initResvg(resources.resvgWasm),
		]).then(() => undefined);
	}
	return initialization;
}

/**
 * バイト列を base64 の data URL に変換する
 *
 * Workers / Node の両方で動くよう Buffer に依存せず btoa を使います。
 */
function toPngDataUrl(bytes: ArrayBuffer): string {
	const view = new Uint8Array(bytes);
	let binary = "";
	// 巨大な配列を一度に String.fromCharCode に渡すと引数上限に達するため分割する
	const chunkSize = 0x8000;
	for (let offset = 0; offset < view.length; offset += chunkSize) {
		binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
	}
	return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * OGP 画像を PNG として生成する
 *
 * @param params - 表示するテキストと配色
 * @param resources - フォント・wasm・アイコン
 * @returns PNG のバイト列
 */
export async function renderOgpPng(
	params: OgpRenderParams,
	resources: OgpRenderResources,
): Promise<Uint8Array<ArrayBuffer>> {
	await ensureInitialized(resources);

	const element = buildOgpElement(params, toPngDataUrl(resources.authorIcon));
	const svg = await satori(element, {
		width: OGP_WIDTH,
		height: OGP_HEIGHT,
		fonts: [
			{
				name: FONT_FAMILY,
				data: resources.fontBold,
				weight: 700,
				style: "normal",
			},
		],
	});

	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: OGP_WIDTH },
	});
	// resvg が返す Uint8Array は ArrayBufferLike 型のため、Response の body に渡せる
	// ArrayBuffer 裏付けの Uint8Array へコピーして返す
	const rendered = resvg.render().asPng();
	const png = new Uint8Array(rendered.byteLength);
	png.set(rendered);
	return png;
}
