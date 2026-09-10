/**
 * 記事 Markdown ファイル（frontmatter 付き）の解析と、ghst に渡す引数の組み立てのテスト
 */
import { describe, expect, it } from "vitest";
import { buildGhstArgs, parsePostFile } from "./post-file";

const MARKDOWN = { kind: "markdown-stdin" } as const;
const SLUG_JSON = "/tmp/slug.json";

const 記事本文 = `---
title: 花の種をまく
tags:
  - 日記
  - 園芸
status: draft
excerpt: 春先に種をまいた記録
---

## はじめに

今日は種をまきました。
`;

describe("parsePostFile", () => {
	it("frontmatter を meta として取り出し、本文からは frontmatter を除く", () => {
		const result = parsePostFile(記事本文, "hana-no-tane.md");
		expect(result.meta).toEqual({
			title: "花の種をまく",
			slug: "hana-no-tane",
			tags: ["日記", "園芸"],
			status: "draft",
			excerpt: "春先に種をまいた記録",
		});
		expect(result.body).toBe("## はじめに\n\n今日は種をまきました。\n");
	});

	it("slug を frontmatter で明示した場合はファイル名より優先する", () => {
		const content = "---\ntitle: 題名\nslug: custom-slug\n---\n本文\n";
		expect(parsePostFile(content, "file-name.md").meta.slug).toBe(
			"custom-slug",
		);
	});

	it("status を省略した場合は draft になる", () => {
		const content = "---\ntitle: 題名\n---\n本文\n";
		expect(parsePostFile(content, "a.md").meta.status).toBe("draft");
	});

	it("frontmatter が無い場合はエラーになる", () => {
		expect(() => parsePostFile("本文だけ\n", "a.md")).toThrow(/frontmatter/);
	});

	it("title が無い場合はエラーになる", () => {
		expect(() => parsePostFile("---\ntags: [x]\n---\n本文\n", "a.md")).toThrow(
			/title/,
		);
	});

	it("status が draft / published 以外の場合はエラーになる", () => {
		expect(() =>
			parsePostFile("---\ntitle: t\nstatus: scheduled\n---\n本文\n", "a.md"),
		).toThrow(/status/);
	});
});

describe("buildGhstArgs", () => {
	const meta = {
		title: "花の種をまく",
		slug: "hana-no-tane",
		tags: ["日記", "園芸"],
		status: "draft" as const,
		excerpt: "春先に種をまいた記録",
	};

	it("create では slug を --from-json のファイルで渡し（0.17.1 の create に --slug は無い）、本文は stdin から渡す", () => {
		expect(buildGhstArgs("create", meta, MARKDOWN, SLUG_JSON)).toEqual([
			"post",
			"create",
			"--markdown-stdin",
			"--from-json",
			"/tmp/slug.json",
			"--title",
			"花の種をまく",
			"--status",
			"draft",
			"--tags",
			"日記,園芸",
			"--excerpt",
			"春先に種をまいた記録",
		]);
	});

	it("update では --slug を既存記事の検索キーとして先頭に置く", () => {
		const args = buildGhstArgs("update", meta, MARKDOWN);
		expect(args.slice(0, 5)).toEqual([
			"post",
			"update",
			"--slug",
			"hana-no-tane",
			"--markdown-stdin",
		]);
		expect(args.filter((arg) => arg === "--slug")).toHaveLength(1);
	});

	it("feature_image と featured を指定した場合は対応する引数を付ける", () => {
		const args = buildGhstArgs(
			"create",
			{
				...meta,
				feature_image: "https://hanatane.net/content/images/a.png",
				featured: true,
			},
			MARKDOWN,
			SLUG_JSON,
		);
		expect(args).toContain("--feature-image");
		expect(args).toContain("https://hanatane.net/content/images/a.png");
		expect(args).toContain("--featured");
	});

	it("lexical-file を指定した場合は --markdown-stdin の代わりに --lexical-file <path> を付ける", () => {
		const args = buildGhstArgs("update", meta, {
			kind: "lexical-file",
			path: "/tmp/why-ghost.lexical.json",
		});
		expect(args).not.toContain("--markdown-stdin");
		expect(args.slice(0, 6)).toEqual([
			"post",
			"update",
			"--slug",
			"hana-no-tane",
			"--lexical-file",
			"/tmp/why-ghost.lexical.json",
		]);
	});

	it("update で featured を指定した場合は true / false の値付きで渡す", () => {
		const args = buildGhstArgs(
			"update",
			{ ...meta, featured: false },
			MARKDOWN,
		);
		const index = args.indexOf("--featured");
		expect(args[index + 1]).toBe("false");
	});

	it("省略した項目の引数は付けない", () => {
		const args = buildGhstArgs(
			"create",
			{
				title: "t",
				slug: "s",
				status: "draft",
			},
			MARKDOWN,
			SLUG_JSON,
		);
		expect(args).toEqual([
			"post",
			"create",
			"--markdown-stdin",
			"--from-json",
			"/tmp/slug.json",
			"--title",
			"t",
			"--status",
			"draft",
		]);
	});
});
