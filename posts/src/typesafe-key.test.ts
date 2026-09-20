/**
 * TypeSafe（Jev）の API キーを決める順序のテスト
 *
 * 順序は「環境変数 TYPESAFE_API_KEY → sops で暗号化した secrets/typesafe.env → エラー」。
 * コマンドラインにキーを書かずに済むよう、ふだんは sops の暗号化ファイルから読む。
 */
import { describe, expect, it } from "vitest";
import {
	checkTrackedSecretFile,
	parseDotenvValue,
	resolveTypesafeApiKey,
	TYPESAFE_API_KEY_ENV,
	TYPESAFE_SECRET_FILE,
} from "./typesafe-key";

describe("parseDotenvValue", () => {
	it("dotenv 形式の内容から、指定した名前の値を取り出す", () => {
		const content = "# TypeSafe の API キー\nTYPESAFE_API_KEY=apikey_example\n";
		expect(parseDotenvValue(content, "TYPESAFE_API_KEY", "typesafe.env")).toBe(
			"apikey_example",
		);
	});

	it("値を囲む引用符と前後の空白を取り除く", () => {
		const content = 'TYPESAFE_API_KEY = "apikey_example" \n';
		expect(parseDotenvValue(content, "TYPESAFE_API_KEY", "typesafe.env")).toBe(
			"apikey_example",
		);
	});

	it("指定した名前が無ければ、ファイル名を含むエラーにする", () => {
		expect(() =>
			parseDotenvValue("OTHER_KEY=value\n", "TYPESAFE_API_KEY", "typesafe.env"),
		).toThrow("typesafe.env");
	});

	it("値が空ならエラーにする", () => {
		expect(() =>
			parseDotenvValue(
				"TYPESAFE_API_KEY=\n",
				"TYPESAFE_API_KEY",
				"typesafe.env",
			),
		).toThrow("TYPESAFE_API_KEY");
	});
});

describe("resolveTypesafeApiKey", () => {
	it("環境変数があれば、それを使い、sops は呼ばない", () => {
		let sops呼び出し回数 = 0;
		const key = resolveTypesafeApiKey({
			env: { [TYPESAFE_API_KEY_ENV]: "apikey_from_env" },
			secretFileExists: true,
			decryptSecretFile: () => {
				sops呼び出し回数++;
				return "TYPESAFE_API_KEY=apikey_from_sops\n";
			},
		});
		expect(key).toBe("apikey_from_env");
		expect(sops呼び出し回数).toBe(0);
	});

	it("環境変数が無ければ、sops の暗号化ファイルを復号して使う", () => {
		const key = resolveTypesafeApiKey({
			env: {},
			secretFileExists: true,
			decryptSecretFile: () => "TYPESAFE_API_KEY=apikey_from_sops\n",
		});
		expect(key).toBe("apikey_from_sops");
	});

	it("環境変数が空文字のときも、sops の暗号化ファイルを使う", () => {
		const key = resolveTypesafeApiKey({
			env: { [TYPESAFE_API_KEY_ENV]: "" },
			secretFileExists: true,
			decryptSecretFile: () => "TYPESAFE_API_KEY=apikey_from_sops\n",
		});
		expect(key).toBe("apikey_from_sops");
	});

	it("環境変数も暗号化ファイルも無ければ、用意のしかたを含むエラーにする", () => {
		expect(() =>
			resolveTypesafeApiKey({
				env: {},
				secretFileExists: false,
				decryptSecretFile: () => {
					throw new Error("呼ばれないはず");
				},
			}),
		).toThrow(TYPESAFE_SECRET_FILE);
	});
});

describe("checkTrackedSecretFile", () => {
	const 暗号化済み = [
		"TYPESAFE_API_KEY=ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]",
		"sops_age__list_0__map_recipient=age1example",
		"sops_lastmodified=2026-09-20T05:00:00Z",
		"sops_mac=ENC[AES256_GCM,data:xyz,iv:def,tag:ghi,type:str]",
		"sops_version=3.9.0",
		"",
	].join("\n");

	it("sops で暗号化した dotenv は問題なしとする", () => {
		expect(
			checkTrackedSecretFile("secrets/typesafe.env", 暗号化済み),
		).toBeNull();
	});

	it("平文の値が残っている dotenv は、キーの漏えいとして問題にする", () => {
		const 平文 = "TYPESAFE_API_KEY=apikey_example\n";
		expect(checkTrackedSecretFile("secrets/typesafe.env", 平文)).toContain(
			"secrets/typesafe.env",
		);
	});

	it("sops のメタ情報が無いファイルは、値が ENC[ で始まっていても問題にする", () => {
		const メタ情報なし = "TYPESAFE_API_KEY=ENC[AES256_GCM,data:abc]\n";
		expect(
			checkTrackedSecretFile("secrets/typesafe.env", メタ情報なし),
		).not.toBeNull();
	});

	it("一部の値だけ平文のファイルも問題にする", () => {
		const 一部だけ平文 = `OTHER_KEY=plain_value\n${暗号化済み}`;
		expect(
			checkTrackedSecretFile("secrets/typesafe.env", 一部だけ平文),
		).not.toBeNull();
	});
});
