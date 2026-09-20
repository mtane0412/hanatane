/**
 * TypeSafe（Jev）のクライアントを作る（scripts/jev-eval.ts と scripts/strata.ts で共有）
 *
 * API キーは「環境変数 TYPESAFE_API_KEY → sops で暗号化した secrets/typesafe.env → エラー」の順で決める。
 * 順序のルールは src/typesafe-key.ts に集約している。ここではファイルの有無の確認と sops の実行だけを扱う。
 *
 * 注意:
 *   - secrets/typesafe.env の復号には age の秘密鍵（~/.config/sops/age/keys.txt）が必要
 *   - 復号したキーは SDK に直接渡し、環境変数にもファイルにも書かない
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { decryptDotenv } from "../../src/sops";
import {
	resolveTypesafeApiKey,
	TYPESAFE_SECRET_FILE,
} from "../../src/typesafe-key";

const POSTS_DIR = path.resolve(import.meta.dirname, "../..");

export function createTypesafeClient(): TypeSafeClient {
	const secretPath = path.join(POSTS_DIR, TYPESAFE_SECRET_FILE);
	const apiKey = resolveTypesafeApiKey({
		env: process.env,
		secretFileExists: existsSync(secretPath),
		decryptSecretFile: () => decryptDotenv(secretPath),
	});
	return new TypeSafeClient({ apiKey });
}
