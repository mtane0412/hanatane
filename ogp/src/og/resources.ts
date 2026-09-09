/**
 * OGP レンダリングに必要な外部資源の型定義
 *
 * Cloudflare Workers では wasm を実行時バイト列からコンパイルできないため、
 * `WebAssembly.Module` として事前にインポートしたものを受け取ります。
 * フォントとアイコンは Workers では静的アセット、テストではディスクから読み込みます。
 */

export interface OgpRenderResources {
	/** LINE Seed JP Bold の OTF バイト列（Satori は woff2 を読めないため OTF を使う） */
	fontBold: ArrayBuffer;
	/** Satori のレイアウトエンジン yoga の wasm モジュール */
	yogaWasm: WebAssembly.Module;
	/** resvg（SVG → PNG）の wasm モジュール */
	resvgWasm: WebAssembly.Module;
	/** 著者アイコン PNG のバイト列 */
	authorIcon: ArrayBuffer;
}
