/**
 * Node 環境向けのレンダリング資源ローダー
 *
 * Workers ではアセットバインディングと wasm の素インポートで賄う資源を、
 * Node（テスト・事前生成スクリプト）ではディスクから読み込みます。
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { OgpRenderResources } from "./resources";

/** リポジトリルート（このファイルは src/og/ 配下にある） */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Buffer を、その範囲だけを持つ ArrayBuffer にコピーする
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
	return buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength,
	) as ArrayBuffer;
}

/**
 * フォント・wasm・著者アイコンをディスクから読み込む
 */
export async function loadResourcesFromDisk(): Promise<OgpRenderResources> {
	const read = (path: string) => readFile(new URL(path, `file://${REPO_ROOT}`));
	const [font, yoga, resvg, icon] = await Promise.all([
		read("public/fonts/LINESeedJP_OTF_Bd.otf"),
		read("node_modules/satori/yoga.wasm"),
		read("node_modules/@resvg/resvg-wasm/index_bg.wasm"),
		read("public/default_icon512.png"),
	]);
	return {
		fontBold: toArrayBuffer(font),
		yogaWasm: await WebAssembly.compile(yoga),
		resvgWasm: await WebAssembly.compile(resvg),
		authorIcon: toArrayBuffer(icon),
	};
}
