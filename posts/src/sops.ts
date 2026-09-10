/**
 * 限定記事の `.post.json` を sops + age で暗号化・復号する薄いラッパー
 *
 * 設定は posts/.sops.yaml にあり、`content/private/*.post.json` に対して
 * `encrypted_regex: ^lexical$` で本文（lexical）だけを暗号化します。
 * メタ情報（title、slug、status、visibility、tags など）は平文のまま残るため、
 * git の diff で何が変わったかは追えます。
 *
 * 注意:
 *   - 復号には ~/.config/sops/age/keys.txt の age 秘密鍵が必要です（infra/ と同じ鍵）
 *   - sops は MAC をファイル全体にかけるため、暗号化済みファイルの平文部分を直接編集すると復号に失敗します。
 *     編集は `pnpm --filter ./posts private decrypt` → 編集 → `private encrypt` の順で行ってください
 *   - このモジュールは外部コマンドを呼ぶため単体テストの対象外です。純粋なルールは src/private-post.ts にあります
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** posts/.sops.yaml の絶対パス */
export const SOPS_CONFIG_PATH = path.resolve(
	import.meta.dirname,
	"../.sops.yaml",
);

function runSops(args: string[]): string {
	const result = spawnSync("sops", ["--config", SOPS_CONFIG_PATH, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
	if (result.error) {
		throw new Error(
			`sops を実行できません（インストールされていますか）: ${result.error.message}`,
		);
	}
	if (result.status !== 0) {
		throw new Error(
			`sops が終了コード ${String(result.status)} で失敗しました`,
		);
	}
	return result.stdout;
}

/**
 * 平文の `.post.json` の内容を暗号化した JSON 文字列にして返します。
 *
 * @param plainJson - 平文の JSON 文字列
 * @param contentRelativePath - content ディレクトリからの相対パス（.sops.yaml の creation_rules に突き合わせる）
 */
export function encryptPostJson(
	plainJson: string,
	contentRelativePath: string,
): string {
	// 一時ファイルは所有者のみ読める権限で作り、暗号化後に必ず消す
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "hanatane-posts-sops-"));
	try {
		const plainPath = path.join(tempDir, "plain.json");
		writeFileSync(plainPath, plainJson, { encoding: "utf8", mode: 0o600 });
		return runSops([
			"--encrypt",
			"--filename-override",
			path.join("content", contentRelativePath),
			plainPath,
		]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * 暗号化済みの `.post.json` を復号し、平文の JSON 文字列を返します。
 *
 * @param encryptedPath - 暗号化済みファイルの絶対パス
 */
export function decryptPostJson(encryptedPath: string): string {
	return runSops(["--decrypt", encryptedPath]);
}
