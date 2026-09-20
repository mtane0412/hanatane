/**
 * 限定記事と API キーが平文でコミットされていないかを検査するスクリプト（CI と pre-commit hook から実行する）
 *
 * 使い方:
 *   pnpm check-private            # git の index にある content 配下と secrets 配下の全ファイルを検査する
 *   pnpm check-private --staged   # ステージされた（コミットされようとしている）ファイルだけを検査する
 *
 * 処理内容:
 *   1. `git ls-files`（--staged のときは `git diff --cached --name-only`）で content 配下の対象を列挙する
 *   2. `git show :<path>` で index 上の内容を読む（作業ツリーではなく、実際にコミットされる内容を見る）
 *   3. content 配下は src/private-post.ts の checkTrackedContentFile、secrets 配下（sops で暗号化した dotenv）は
 *      src/typesafe-key.ts の checkTrackedSecretFile で 1 件ずつ検査し、問題があれば一覧を出して終了コード 1 で終わる
 *
 * 注意:
 *   - 復号は行わないため age の秘密鍵は不要で、CI でもそのまま動く
 *   - 判定ルールは src/private-post.ts に集約している。ここでは git の入出力だけを扱う
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { checkTrackedContentFile } from "../src/private-post";
import { checkTrackedSecretFile } from "../src/typesafe-key";

const POSTS_DIR = path.resolve(import.meta.dirname, "..");
const CONTENT_PREFIX = "content/";
const SECRETS_PREFIX = "secrets/";

function git(args: string[]): string {
	const result = spawnSync("git", args, {
		cwd: POSTS_DIR,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} が終了コード ${String(result.status)} で失敗しました`,
		);
	}
	return result.stdout;
}

/** 検査対象の、prefix からの相対パス一覧を返す */
function listTargets(stagedOnly: boolean, prefix: string): string[] {
	const output = stagedOnly
		? git([
				"diff",
				"--cached",
				"--name-only",
				"--diff-filter=ACMR",
				"--relative",
				"--",
				prefix,
			])
		: git(["ls-files", "--", prefix]);
	return output
		.split("\n")
		.filter((line) => line.startsWith(prefix))
		.map((line) => line.slice(prefix.length));
}

function main(): void {
	const stagedOnly = process.argv.includes("--staged");
	const targets = listTargets(stagedOnly, CONTENT_PREFIX);
	const secrets = listTargets(stagedOnly, SECRETS_PREFIX);
	const problems: string[] = [];
	for (const relativePath of targets) {
		// `:./path` で posts ディレクトリ基準の index 上の内容を読む（`:path` はリポジトリルート基準になる）
		const content = git(["show", `:./${CONTENT_PREFIX}${relativePath}`]);
		const problem = checkTrackedContentFile(relativePath, content);
		if (problem) {
			problems.push(problem);
		}
	}
	for (const relativePath of secrets) {
		const postsRelativePath = `${SECRETS_PREFIX}${relativePath}`;
		const problem = checkTrackedSecretFile(
			postsRelativePath,
			git(["show", `:./${postsRelativePath}`]),
		);
		if (problem) {
			problems.push(problem);
		}
	}
	if (problems.length > 0) {
		console.error(
			"限定記事の配置または API キーの暗号化に問題があります。コミットを中止してください:",
		);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}
	console.log(
		`check-private: ${targets.length + secrets.length} 件を検査し、問題はありませんでした`,
	);
}

main();
