/**
 * `.wasm` の素インポートに対する型宣言
 *
 * Cloudflare Vite プラグインは `.wasm` を CompiledWasm モジュールとして扱い、
 * `WebAssembly.Module` をデフォルトエクスポートします。
 */
declare module "*.wasm" {
	const module: WebAssembly.Module;
	export default module;
}
