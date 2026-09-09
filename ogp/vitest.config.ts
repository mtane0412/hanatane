/**
 * Vitest 設定
 *
 * vite.config.ts は Cloudflare / TanStack Start のプラグインを含み、
 * Node 上の単体テストには不要なため、テスト専用の軽量な設定を分離しています。
 */
import { defineConfig } from "vitest/config";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [viteTsConfigPaths({ projects: ["./tsconfig.json"] })],
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		testTimeout: 30_000,
	},
});
