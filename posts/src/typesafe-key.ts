/**
 * TypeSafe（Jev）の API キーを決める
 *
 * キーをコマンドラインに書くと、シェルの履歴や Claude Code のセッションの記録に残る。
 * それを避けるため、キーは sops + age で暗号化した secrets/typesafe.env（dotenv 形式）に置き、
 * スクリプトが実行のたびに復号して使う。復号した値はプロセスの中だけで扱い、ファイルには書かない。
 *
 * キーを決める順序（上から順に、最初に見つかったものを使う）:
 *   1. 環境変数 TYPESAFE_API_KEY（age の秘密鍵が無い環境や、一時的に別のキーを使うとき）
 *   2. sops で暗号化した secrets/typesafe.env
 *   3. どちらも無ければエラー
 *
 * 公開リポジトリなので、secrets/ に平文のキーがコミットされないよう、checkTrackedSecretFile で検査する
 * （scripts/check-private.ts が pre-commit hook と CI から呼ぶ）。
 *
 * このモジュールは順序と dotenv の読み取り・検査だけを担当する。sops の実行は scripts/lib/typesafe-client.ts が渡す。
 */

/** API キーを渡す環境変数の名前（TypeSafe の SDK の既定と同じ） */
export const TYPESAFE_API_KEY_ENV = "TYPESAFE_API_KEY";

/** sops で暗号化した API キーのファイル（posts/ からの相対パス。posts/.sops.yaml の creation_rules に対応する） */
export const TYPESAFE_SECRET_FILE = "secrets/typesafe.env";

/**
 * dotenv 形式の内容から、指定した名前の値を取り出します。
 * `NAME=value` の行だけを扱い、値を囲む引用符と前後の空白は取り除きます。
 *
 * @param content - dotenv 形式の内容
 * @param name - 取り出す変数の名前
 * @param fileName - エラーメッセージ用のファイル名
 */
export function parseDotenvValue(
	content: string,
	name: string,
	fileName: string,
): string {
	for (const line of content.split("\n")) {
		const separator = line.indexOf("=");
		if (separator === -1 || line.slice(0, separator).trim() !== name) continue;
		const value = line
			.slice(separator + 1)
			.trim()
			.replace(/^(["'])(.*)\1$/, "$2");
		if (value === "") {
			throw new Error(`${fileName}: ${name} の値が空です`);
		}
		return value;
	}
	throw new Error(`${fileName}: ${name} がありません`);
}

/** resolveTypesafeApiKey が使う外部の状態（テストで差し替える） */
export interface TypesafeKeySources {
	/** 環境変数（process.env） */
	env: Readonly<Record<string, string | undefined>>;
	/** secrets/typesafe.env があるか */
	secretFileExists: boolean;
	/** secrets/typesafe.env を sops で復号し、平文の dotenv を返す */
	decryptSecretFile: () => string;
}

/** API キーを、ファイル冒頭の順序で決めます。 */
export function resolveTypesafeApiKey(sources: TypesafeKeySources): string {
	const fromEnv = sources.env[TYPESAFE_API_KEY_ENV];
	if (fromEnv) return fromEnv;
	if (sources.secretFileExists) {
		return parseDotenvValue(
			sources.decryptSecretFile(),
			TYPESAFE_API_KEY_ENV,
			TYPESAFE_SECRET_FILE,
		);
	}
	throw new Error(
		`TypeSafe の API キーがありません。posts/ で \`sops ${TYPESAFE_SECRET_FILE}\` を実行して ${TYPESAFE_API_KEY_ENV}=<キー> を書くか、環境変数 ${TYPESAFE_API_KEY_ENV} を設定してください`,
	);
}

/** sops が dotenv に書くメタ情報の行の接頭辞（sops_version、sops_mac など） */
const SOPS_METADATA_PREFIX = "sops_";
/** sops が暗号化した値の接頭辞 */
const SOPS_ENCRYPTED_VALUE_PREFIX = "ENC[";

/**
 * secrets/ 配下の dotenv が sops で暗号化されているかを検査します（復号はしない）。
 * 問題が無ければ null、あれば説明文を返します。
 *
 * 暗号化済みとみなす条件:
 *   - sops のメタ情報（sops_mac）がある
 *   - メタ情報とコメントを除くすべての `NAME=value` の値が `ENC[` で始まる
 *
 * @param postsRelativePath - posts/ からの相対パス（エラーメッセージ用）
 * @param content - git の index 上の内容
 */
export function checkTrackedSecretFile(
	postsRelativePath: string,
	content: string,
): string | null {
	let hasMac = false;
	for (const line of content.split("\n")) {
		const separator = line.indexOf("=");
		if (line.trim() === "" || line.startsWith("#") || separator === -1) {
			continue;
		}
		const name = line.slice(0, separator).trim();
		if (name.startsWith(SOPS_METADATA_PREFIX)) {
			if (name === `${SOPS_METADATA_PREFIX}mac`) hasMac = true;
			continue;
		}
		if (!line.slice(separator + 1).startsWith(SOPS_ENCRYPTED_VALUE_PREFIX)) {
			return `${postsRelativePath}: ${name} の値が暗号化されていません。\`sops ${postsRelativePath}\` で編集し、平文のキーは無効にして作り直してください`;
		}
	}
	if (!hasMac) {
		return `${postsRelativePath}: sops のメタ情報（sops_mac）がありません。sops で暗号化したファイルだけをコミットしてください`;
	}
	return null;
}
