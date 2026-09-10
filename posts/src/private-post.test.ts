/**
 * メンバー限定記事（visibility が members / paid）を平文で公開リポジトリに置かないためのルールのテスト
 */
import { describe, expect, it } from "vitest";
import {
	checkTrackedContentFile,
	checkVisibilityTransition,
	contentRelativePath,
	isPrivateVisibility,
	isSopsEncryptedPostJson,
	staleContentPaths,
} from "./private-post";

const 平文の限定記事 = JSON.stringify({
	title: "限定記事",
	slug: "secret",
	status: "published",
	visibility: "members",
	lexical: {
		root: {
			children: [{ type: "text", text: "会員だけに見せる本文", version: 1 }],
		},
	},
});

/** sops が `encrypted_regex: ^lexical$` で暗号化したファイルを模したもの（lexical の葉がすべて ENC[...]） */
const 暗号化済みの限定記事 = JSON.stringify({
	title: "限定記事",
	slug: "secret",
	status: "published",
	visibility: "members",
	lexical: {
		root: {
			children: [
				{
					type: "ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:str]",
					text: "ENC[AES256_GCM,data:ddd,iv:eee,tag:fff,type:str]",
					version: "ENC[AES256_GCM,data:ggg,iv:hhh,tag:iii,type:int]",
				},
			],
		},
	},
	sops: { age: [{ recipient: "age1xxx", enc: "..." }], mac: "ENC[...]" },
});

describe("isPrivateVisibility", () => {
	it("members と paid を限定記事とみなし、public は限定記事とみなさない", () => {
		expect(isPrivateVisibility("members")).toBe(true);
		expect(isPrivateVisibility("paid")).toBe(true);
		expect(isPrivateVisibility("public")).toBe(false);
	});
});

describe("contentRelativePath", () => {
	it("公開記事は content 直下、限定記事は content/private に置く", () => {
		expect(contentRelativePath("hana", "public")).toBe("hana.post.json");
		expect(contentRelativePath("secret", "members")).toBe(
			"private/secret.post.json",
		);
		expect(contentRelativePath("secret", "paid")).toBe(
			"private/secret.post.json",
		);
	});
});

describe("isSopsEncryptedPostJson", () => {
	it("sops メタ情報があり、lexical の葉がすべて ENC[...] なら暗号化済みと判定する", () => {
		expect(isSopsEncryptedPostJson(暗号化済みの限定記事)).toBe(true);
	});

	it("sops が暗号化せずに残す空文字列と null の葉は暗号化済みの一部として許容する", () => {
		const 空文字列とnullを含む = JSON.parse(暗号化済みの限定記事) as Record<
			string,
			unknown
		>;
		(
			空文字列とnullを含む.lexical as {
				root: { children: Record<string, unknown>[] };
			}
		).root.children.push({
			type: "ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:str]",
			format: "",
			height: null,
		});
		expect(isSopsEncryptedPostJson(JSON.stringify(空文字列とnullを含む))).toBe(
			true,
		);
	});

	it("平文の記事は暗号化済みと判定しない", () => {
		expect(isSopsEncryptedPostJson(平文の限定記事)).toBe(false);
	});

	it("sops メタ情報があっても lexical に平文の葉が残っていれば暗号化済みと判定しない", () => {
		const 一部だけ平文 = JSON.parse(暗号化済みの限定記事) as Record<
			string,
			unknown
		>;
		(
			(
				一部だけ平文.lexical as {
					root: { children: Record<string, unknown>[] };
				}
			).root.children[0] as Record<string, unknown>
		).text = "漏れた本文";
		expect(isSopsEncryptedPostJson(JSON.stringify(一部だけ平文))).toBe(false);
	});

	it("JSON でないものは暗号化済みと判定しない", () => {
		expect(isSopsEncryptedPostJson("---\ntitle: t\n---\n本文")).toBe(false);
	});
});

describe("checkTrackedContentFile（コミット対象ファイルの検査）", () => {
	it("content/private の暗号化済み .post.json は問題なし", () => {
		expect(
			checkTrackedContentFile("private/secret.post.json", 暗号化済みの限定記事),
		).toBeNull();
	});

	it("content/private に平文の .post.json があればエラー", () => {
		expect(
			checkTrackedContentFile("private/secret.post.json", 平文の限定記事),
		).toMatch(/暗号化/);
	});

	it("content/private の Markdown（平文の下書き）がコミット対象ならエラー", () => {
		expect(
			checkTrackedContentFile(
				"private/draft.md",
				"---\ntitle: t\nvisibility: members\n---\n本文\n",
			),
		).toMatch(/private/);
	});

	it("content 直下の .post.json に visibility が members / paid ならエラー", () => {
		expect(checkTrackedContentFile("secret.post.json", 平文の限定記事)).toMatch(
			/members/,
		);
	});

	it("content 直下の Markdown に visibility が members / paid ならエラー", () => {
		expect(
			checkTrackedContentFile(
				"secret.md",
				"---\ntitle: t\nvisibility: paid\n---\n本文\n",
			),
		).toMatch(/paid/);
	});

	it("content 直下の公開記事（visibility 省略を含む）は問題なし", () => {
		expect(
			checkTrackedContentFile(
				"hana.post.json",
				JSON.stringify({ title: "t", lexical: { root: {} } }),
			),
		).toBeNull();
		expect(
			checkTrackedContentFile("hana.md", "---\ntitle: t\n---\n本文\n"),
		).toBeNull();
	});

	it("content 直下や private 以外の場所に sops 暗号化ファイルがあれば置き場所の誤りとしてエラー", () => {
		expect(
			checkTrackedContentFile("secret.post.json", 暗号化済みの限定記事),
		).toMatch(/private/);
	});

	it("解析できないファイルはエラー（黙って通さない）", () => {
		expect(checkTrackedContentFile("broken.post.json", "{")).toMatch(/解析/);
	});
});

describe("checkVisibilityTransition（Ghost 側の visibility との突き合わせ）", () => {
	it("Ghost 側が限定記事で、ファイルが public なら、--allow-public が無い限りエラー", () => {
		expect(
			checkVisibilityTransition({
				ghost: "members",
				file: "public",
				allowPublic: false,
			}),
		).toMatch(/--allow-public/);
	});

	it("--allow-public を付ければ限定記事を公開に変更できる", () => {
		expect(
			checkVisibilityTransition({
				ghost: "paid",
				file: "public",
				allowPublic: true,
			}),
		).toBeNull();
	});

	it("Ghost 側と同じ visibility、または公開から限定への変更は問題なし", () => {
		expect(
			checkVisibilityTransition({
				ghost: "members",
				file: "members",
				allowPublic: false,
			}),
		).toBeNull();
		expect(
			checkVisibilityTransition({
				ghost: "public",
				file: "members",
				allowPublic: false,
			}),
		).toBeNull();
	});

	it("Ghost に記事が無い（新規作成）場合は問題なし", () => {
		expect(
			checkVisibilityTransition({
				ghost: undefined,
				file: "public",
				allowPublic: false,
			}),
		).toBeNull();
	});
});

describe("staleContentPaths（visibility が変わった記事の古いファイル）", () => {
	it("公開記事なら content/private 側、限定記事なら content 直下側の .post.json を古いファイルとして返す", () => {
		expect(staleContentPaths("hana", "public")).toEqual([
			"private/hana.post.json",
		]);
		expect(staleContentPaths("secret", "members")).toEqual([
			"secret.post.json",
		]);
	});
});
