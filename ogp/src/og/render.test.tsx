/**
 * OGP 画像レンダリングの結合テスト
 *
 * 実フォント・実 wasm をディスクから読み込み、PNG が生成されることを検証します。
 */
import { describe, expect, it } from "vitest";
import { OGP_HEIGHT, OGP_WIDTH, renderOgpPng } from "./render";
import { loadResourcesFromDisk } from "./resources-node";

/**
 * PNG の IHDR チャンクから幅・高さを読み取る
 */
function readPngSize(png: Uint8Array): { width: number; height: number } {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("renderOgpPng", () => {
	it("日本語タイトルから 1200x630 の PNG を生成する", async () => {
		const resources = await loadResourcesFromDisk();
		const png = await renderOgpPng(
			{
				title: "Cloudflare Workers で OGP 画像を自動生成する",
				siteName: "はなしのタネ",
				authorName: "たねのぶ",
				gradient: "purple",
			},
			resources,
		);
		// PNG シグネチャ
		expect(Array.from(png.slice(0, 8))).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		expect(readPngSize(png)).toEqual({ width: OGP_WIDTH, height: OGP_HEIGHT });
	});
});
