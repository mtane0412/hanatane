/**
 * Vitest 設定（posts パッケージ）
 *
 * frontmatter の解析と ghst 引数の組み立てを Node 上で単体テストします。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
