/**
 * Hyperstrata の注釈ファイル（posts/strata/<slug>.json）のルールのテスト
 *
 * 注釈は Claude Code のセッションが書き、このモジュールは形式と整合（後方参照のみ、公開済み記事のみ）を検査する。
 */
import { describe, expect, it } from "vitest";
import {
	buildCatalog,
	checkStrataAnnotation,
	checkStrataHistory,
	checkStrataPlacement,
	isSopsEncryptedStrata,
	lexicalToText,
	listPendingPosts,
	type PublishedPost,
	parseStrataAnnotation,
	parseStrataFileName,
	readPublishedPost,
	selectLatestAnnotations,
	strataRelativePath,
} from "./strata";

const 猫の記事: PublishedPost = {
	slug: "welcome-cat",
	title: "猫を迎えた",
	status: "published",
	visibility: "public",
	published_at: "2024-01-10T00:00:00.000Z",
};
const 目隠しシートの記事: PublishedPost = {
	slug: "window-film",
	title: "縁側の窓に目隠しシートを貼った",
	status: "published",
	visibility: "public",
	published_at: "2026-04-06T12:54:38.000Z",
};
const 地層の記事: PublishedPost = {
	slug: "hyperstrata",
	title: "immutableなノートを堆積する",
	status: "published",
	visibility: "public",
	published_at: "2026-09-09T11:00:41.000Z",
};
const 限定記事: PublishedPost = {
	slug: "writing-gap",
	title: "書きたいことと書くことのギャップ",
	status: "published",
	visibility: "members",
	published_at: "2023-06-04T22:00:44.000Z",
};
const 下書き: PublishedPost = {
	slug: "draft-post",
	title: "まだ公開していない記事",
	status: "draft",
	visibility: "public",
};
const 全記事 = [猫の記事, 目隠しシートの記事, 地層の記事, 限定記事, 下書き];

const 正しい注釈 = {
	slug: "hyperstrata",
	summary: "Hyperstrata の考えに共感し、Ghost で引用グラフを実装した記録。",
	relations: [
		{
			slug: "window-film",
			type: "continues",
			reason: "猫のストレス対策の次に書かれた記事として位置づけている。",
		},
	],
	annotated_at: "2026-09-10T03:00:00.000Z",
	annotator: "claude-fable-5-1",
};

describe("parseStrataAnnotation", () => {
	it("正しい注釈を読み込める", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify(正しい注釈),
			"hyperstrata.json",
		);
		expect(annotation.slug).toBe("hyperstrata");
		expect(annotation.relations).toHaveLength(1);
		expect(annotation.relations[0].type).toBe("continues");
	});

	it("関係が無い注釈（孤立した記事）も読み込める", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({ ...正しい注釈, relations: [] }),
			"hyperstrata.json",
		);
		expect(annotation.relations).toEqual([]);
	});

	it("ファイル名と slug が一致しないとエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(JSON.stringify(正しい注釈), "other.json"),
		).toThrow("slug");
	});

	it("要約が空だとエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({ ...正しい注釈, summary: "" }),
				"hyperstrata.json",
			),
		).toThrow("summary");
	});

	it("未知の関係の種類はエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({
					...正しい注釈,
					relations: [{ ...正しい注釈.relations[0], type: "related" }],
				}),
				"hyperstrata.json",
			),
		).toThrow("type");
	});

	it("理由が無い関係はエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({
					...正しい注釈,
					relations: [{ slug: "window-film", type: "continues" }],
				}),
				"hyperstrata.json",
			),
		).toThrow("reason");
	});

	it("annotated_at が ISO 8601 でないとエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({ ...正しい注釈, annotated_at: "昨日" }),
				"hyperstrata.json",
			),
		).toThrow("annotated_at");
	});

	it("icon が無い注釈は icon が null になる", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify(正しい注釈),
			"hyperstrata.json",
		);
		expect(annotation.icon).toBeNull();
	});

	it("icon が既知の種別なら読み込める", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({ ...正しい注釈, icon: "tech" }),
			"hyperstrata.json",
		);
		expect(annotation.icon).toBe("tech");
	});

	it("未知の icon はエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({ ...正しい注釈, icon: "dog" }),
				"hyperstrata.json",
			),
		).toThrow("icon");
	});

	it("JSON でない内容はエラーになる", () => {
		expect(() => parseStrataAnnotation("{", "hyperstrata.json")).toThrow(
			"JSON",
		);
	});
});

describe("checkStrataAnnotation", () => {
	it("公開済みの過去記事だけを参照していれば問題なし", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify(正しい注釈),
			"hyperstrata.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([]);
	});

	it("公開済み記事に無い slug の注釈は問題になる", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({ ...正しい注釈, slug: "unknown" }),
			"unknown.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([
			expect.stringContaining("unknown"),
		]);
	});

	it("下書きの記事に注釈を付けると問題になる（公開後に付ける）", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({ ...正しい注釈, slug: "draft-post" }),
			"draft-post.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([
			expect.stringContaining("公開"),
		]);
	});

	it("自分自身への関係は問題になる", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({
				...正しい注釈,
				relations: [{ ...正しい注釈.relations[0], slug: "hyperstrata" }],
			}),
			"hyperstrata.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([
			expect.stringContaining("自分自身"),
		]);
	});

	it("存在しない記事への関係は問題になる", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({
				...正しい注釈,
				relations: [{ ...正しい注釈.relations[0], slug: "nonexistent" }],
			}),
			"hyperstrata.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([
			expect.stringContaining("nonexistent"),
		]);
	});

	it("自分より後に公開された記事への関係は問題になる（後方参照のみ）", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({
				...正しい注釈,
				slug: "window-film",
				relations: [{ ...正しい注釈.relations[0], slug: "hyperstrata" }],
			}),
			"window-film.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([
			expect.stringContaining("後に公開"),
		]);
	});

	it("同じ記事への関係が重複していると問題になる", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({
				...正しい注釈,
				relations: [正しい注釈.relations[0], 正しい注釈.relations[0]],
			}),
			"hyperstrata.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([
			expect.stringContaining("重複"),
		]);
	});

	it("限定記事への関係は許可する（関係の存在自体は公開情報）", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify({
				...正しい注釈,
				relations: [{ ...正しい注釈.relations[0], slug: "writing-gap" }],
			}),
			"hyperstrata.json",
		);
		expect(checkStrataAnnotation(annotation, 全記事)).toEqual([]);
	});
});

describe("strataRelativePath / checkStrataPlacement", () => {
	it("公開記事の注釈は strata 直下、限定記事は strata/private に置く", () => {
		expect(strataRelativePath("hyperstrata", "public")).toBe(
			"hyperstrata.json",
		);
		expect(strataRelativePath("writing-gap", "members")).toBe(
			"private/writing-gap.json",
		);
		expect(strataRelativePath("paid-post", "paid")).toBe(
			"private/paid-post.json",
		);
	});

	it("限定記事の注釈が strata 直下にあると問題になる", () => {
		expect(checkStrataPlacement("writing-gap.json", "members")).toEqual(
			expect.stringContaining("private"),
		);
	});

	it("公開記事の注釈が strata/private にあると問題になる", () => {
		expect(checkStrataPlacement("private/hyperstrata.json", "public")).toEqual(
			expect.stringContaining("public"),
		);
	});

	it("置き場所が正しければ問題なし", () => {
		expect(checkStrataPlacement("hyperstrata.json", "public")).toBeNull();
		expect(checkStrataPlacement("private/writing-gap.json", "paid")).toBeNull();
	});
});

describe("isSopsEncryptedStrata", () => {
	const 暗号化済み = JSON.stringify({
		slug: "writing-gap",
		summary: "ENC[AES256_GCM,data:aaa,iv:bbb,tag:ccc,type:str]",
		relations: [
			{
				slug: "welcome-cat",
				type: "revisits",
				reason: "ENC[AES256_GCM,data:ddd,iv:eee,tag:fff,type:str]",
			},
		],
		annotated_at: "2026-09-10T03:00:00.000Z",
		annotator: "claude-fable-5-1",
		sops: { version: "3.13.1" },
	});

	it("要約と理由が ENC[...] で sops メタ情報があれば暗号化済み", () => {
		expect(isSopsEncryptedStrata(暗号化済み)).toBe(true);
	});

	it("平文の注釈は暗号化済みでない", () => {
		expect(isSopsEncryptedStrata(JSON.stringify(正しい注釈))).toBe(false);
	});

	it("理由が平文のまま残っていれば暗号化済みでない", () => {
		const 理由だけ平文 = JSON.parse(暗号化済み) as {
			relations: { reason: string }[];
		};
		理由だけ平文.relations[0].reason = "平文の理由";
		expect(isSopsEncryptedStrata(JSON.stringify(理由だけ平文))).toBe(false);
	});

	it("JSON でない内容は暗号化済みでない", () => {
		expect(isSopsEncryptedStrata("{")).toBe(false);
	});
});

describe("listPendingPosts", () => {
	it("公開済みで注釈が無い記事を公開日の古い順に返す", () => {
		const pending = listPendingPosts(全記事, new Set(["window-film"]));
		expect(pending.map((post) => post.slug)).toEqual([
			"writing-gap",
			"welcome-cat",
			"hyperstrata",
		]);
	});

	it("すべて注釈済みなら空", () => {
		const pending = listPendingPosts(
			全記事,
			new Set(["writing-gap", "welcome-cat", "window-film", "hyperstrata"]),
		);
		expect(pending).toEqual([]);
	});
});

describe("buildCatalog", () => {
	it("対象より前に公開された記事を古い順に、要約付きで返す", () => {
		const annotations = new Map([
			[
				"welcome-cat",
				parseStrataAnnotation(
					JSON.stringify({
						...正しい注釈,
						slug: "welcome-cat",
						summary: "保護猫を迎えた経緯。",
						relations: [],
					}),
					"welcome-cat.json",
				),
			],
		]);
		const catalog = buildCatalog("hyperstrata", 全記事, annotations);
		expect(catalog).toEqual([
			{
				slug: "writing-gap",
				title: "書きたいことと書くことのギャップ",
				published_at: "2023-06-04T22:00:44.000Z",
				visibility: "members",
				summary: null,
			},
			{
				slug: "welcome-cat",
				title: "猫を迎えた",
				published_at: "2024-01-10T00:00:00.000Z",
				visibility: "public",
				summary: "保護猫を迎えた経緯。",
			},
			{
				slug: "window-film",
				title: "縁側の窓に目隠しシートを貼った",
				published_at: "2026-04-06T12:54:38.000Z",
				visibility: "public",
				summary: null,
			},
		]);
	});

	it("対象が公開済み記事に無いとエラーになる", () => {
		expect(() => buildCatalog("unknown", 全記事, new Map())).toThrow("unknown");
	});
});

describe("readPublishedPost", () => {
	it(".post.json の平文メタ情報から記事情報を取り出す（lexical は読まない）", () => {
		const post = readPublishedPost(
			JSON.stringify({
				title: "猫を迎えた",
				slug: "welcome-cat",
				status: "published",
				visibility: "public",
				published_at: "2024-01-10T00:00:00.000Z",
				lexical: { root: {} },
			}),
			"welcome-cat.post.json",
		);
		expect(post).toEqual(猫の記事);
	});

	it("visibility が無ければ public、published_at が無ければ省略する", () => {
		const post = readPublishedPost(
			JSON.stringify({ title: "下書き", slug: "draft-post", status: "draft" }),
			"draft-post.post.json",
		);
		expect(post).toEqual({
			slug: "draft-post",
			title: "下書き",
			status: "draft",
			visibility: "public",
		});
	});

	it("未対応の status はエラーになる", () => {
		expect(() =>
			readPublishedPost(
				JSON.stringify({ title: "x", slug: "x", status: "scheduled" }),
				"x.post.json",
			),
		).toThrow("status");
	});
});

describe("lexicalToText", () => {
	it("段落・見出し・リンクの文字を改行区切りのプレーンテキストにする", () => {
		const lexical = {
			root: {
				type: "root",
				children: [
					{
						type: "heading",
						tag: "h2",
						children: [{ type: "text", text: "猫を迎えた" }],
					},
					{
						type: "paragraph",
						children: [
							{ type: "text", text: "保護猫の" },
							{
								type: "link",
								url: "https://hanatane.net/welcome-cat/",
								children: [{ type: "text", text: "ぽん" }],
							},
							{ type: "text", text: "を迎えた。" },
						],
					},
					{ type: "image", src: "https://example.com/cat.jpg" },
					{
						type: "paragraph",
						children: [{ type: "text", text: "とても元気。" }],
					},
				],
			},
		};
		expect(lexicalToText(lexical)).toBe(
			"猫を迎えた\n保護猫のぽんを迎えた。\nとても元気。",
		);
	});

	it("root が無ければエラーになる", () => {
		expect(() => lexicalToText({})).toThrow("root");
	});
});

describe("readPublishedPost のタグと excerpt", () => {
	it("平文メタ情報の tags と excerpt を読み取る", () => {
		const content = JSON.stringify({
			title: "猫を迎えた",
			slug: "welcome-cat",
			status: "draft",
			visibility: "public",
			tags: ["猫の話", "#ref-window-film"],
			excerpt: "猫を迎えた 2 週間について話しました。",
			lexical: {},
		});
		const post = readPublishedPost(content, "welcome-cat.post.json");
		expect(post.tags).toEqual(["猫の話", "#ref-window-film"]);
		expect(post.excerpt).toBe("猫を迎えた 2 週間について話しました。");
	});

	it("tags と excerpt が無ければ省略される", () => {
		const content = JSON.stringify({
			title: "猫を迎えた",
			slug: "welcome-cat",
			status: "draft",
			visibility: "public",
			lexical: {},
		});
		const post = readPublishedPost(content, "welcome-cat.post.json");
		expect(post.tags).toBeUndefined();
		expect(post.excerpt).toBeUndefined();
	});
});

/**
 * 注釈の再検討（1 記事複数注釈、#32）
 * 初回の注釈は <slug>.json、再検討は <slug>.<YYYYMMDDTHHMMSSZ>.json に積む。
 */
const 再検討の注釈 = {
	...正しい注釈,
	summary:
		"後の記事を踏まえて読み直した要約。Ghost での引用グラフの実装が、後に地層の可視化へ発展する出発点だったと位置づける。",
	relations: [
		{
			slug: "window-film",
			type: "revisits",
			reason:
				"再検討により、続報ではなく同じ家の環境整備というテーマへの再訪と判断した。",
		},
	],
	annotated_at: "2026-09-11T03:15:00Z",
};

describe("parseStrataFileName", () => {
	it("初回の注釈ファイル名は slug だけを持つ", () => {
		expect(parseStrataFileName("hyperstrata.json")).toEqual({
			slug: "hyperstrata",
			stamp: null,
		});
	});

	it("再検討の注釈ファイル名は slug と注釈日時のスタンプを持つ", () => {
		expect(parseStrataFileName("hyperstrata.20260911T031500Z.json")).toEqual({
			slug: "hyperstrata",
			stamp: "20260911T031500Z",
		});
	});

	it("スタンプの形式が違うファイル名はエラーになる", () => {
		expect(() => parseStrataFileName("hyperstrata.v2.json")).toThrow(
			"YYYYMMDDTHHMMSSZ",
		);
		expect(() =>
			parseStrataFileName("hyperstrata.2026-09-11T03:15:00Z.json"),
		).toThrow("YYYYMMDDTHHMMSSZ");
	});

	it(".json 以外のファイル名はエラーになる", () => {
		expect(() => parseStrataFileName("hyperstrata.txt")).toThrow(".json");
	});
});

describe("parseStrataAnnotation（再検討の注釈）", () => {
	it("ファイル名のスタンプと annotated_at が一致すれば読み込める", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify(再検討の注釈),
			"hyperstrata.20260911T031500Z.json",
		);
		expect(annotation.slug).toBe("hyperstrata");
		expect(annotation.annotated_at).toBe("2026-09-11T03:15:00Z");
	});

	it("ファイル名のスタンプと annotated_at が一致しないとエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify(再検討の注釈),
				"hyperstrata.20260911T031501Z.json",
			),
		).toThrow("annotated_at");
	});

	it("再検討の annotated_at は UTC の秒精度（YYYY-MM-DDTHH:MM:SSZ）でないとエラーになる", () => {
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({
					...再検討の注釈,
					annotated_at: "2026-09-11T03:15:00.000Z",
				}),
				"hyperstrata.20260911T031500Z.json",
			),
		).toThrow("YYYY-MM-DDTHH:MM:SSZ");
		expect(() =>
			parseStrataAnnotation(
				JSON.stringify({
					...再検討の注釈,
					annotated_at: "2026-09-11T12:15:00+09:00",
				}),
				"hyperstrata.20260911T031500Z.json",
			),
		).toThrow("YYYY-MM-DDTHH:MM:SSZ");
	});

	it("初回の注釈ファイルでは annotated_at のミリ秒付きも従来どおり読み込める", () => {
		const annotation = parseStrataAnnotation(
			JSON.stringify(正しい注釈),
			"hyperstrata.json",
		);
		expect(annotation.annotated_at).toBe("2026-09-10T03:00:00.000Z");
	});
});

describe("checkStrataHistory", () => {
	const 初回 = parseStrataAnnotation(
		JSON.stringify(正しい注釈),
		"hyperstrata.json",
	);
	const 再検討 = parseStrataAnnotation(
		JSON.stringify(再検討の注釈),
		"hyperstrata.20260911T031500Z.json",
	);

	it("初回の注釈より後の annotated_at を持つ再検討なら問題なし", () => {
		expect(
			checkStrataHistory([
				{ fileName: "hyperstrata.json", annotation: 初回 },
				{ fileName: "hyperstrata.20260911T031500Z.json", annotation: 再検討 },
			]),
		).toEqual([]);
	});

	it("初回の注釈が無いのに再検討だけがあると問題になる", () => {
		expect(
			checkStrataHistory([
				{ fileName: "hyperstrata.20260911T031500Z.json", annotation: 再検討 },
			]),
		).toEqual([
			"hyperstrata.20260911T031500Z.json: 初回の注釈（hyperstrata.json）がありません",
		]);
	});

	it("再検討の annotated_at が初回より前だと問題になる", () => {
		const 古い再検討 = parseStrataAnnotation(
			JSON.stringify({ ...再検討の注釈, annotated_at: "2026-09-01T00:00:00Z" }),
			"hyperstrata.20260901T000000Z.json",
		);
		expect(
			checkStrataHistory([
				{ fileName: "hyperstrata.json", annotation: 初回 },
				{
					fileName: "hyperstrata.20260901T000000Z.json",
					annotation: 古い再検討,
				},
			]),
		).toEqual([
			"hyperstrata.20260901T000000Z.json: annotated_at（2026-09-01T00:00:00Z）が初回の注釈（2026-09-10T03:00:00.000Z）より前です（再検討は後から積みます）",
		]);
	});

	it("再検討の annotated_at が初回と同時刻でも問題になる（必ず後）", () => {
		const 同時刻の初回 = parseStrataAnnotation(
			JSON.stringify({ ...正しい注釈, annotated_at: "2026-09-11T03:15:00Z" }),
			"hyperstrata.json",
		);
		expect(
			checkStrataHistory([
				{ fileName: "hyperstrata.json", annotation: 同時刻の初回 },
				{ fileName: "hyperstrata.20260911T031500Z.json", annotation: 再検討 },
			]),
		).toHaveLength(1);
	});

	it("再検討が無い記事だけなら問題なし", () => {
		expect(
			checkStrataHistory([{ fileName: "hyperstrata.json", annotation: 初回 }]),
		).toEqual([]);
	});
});

describe("selectLatestAnnotations", () => {
	it("記事ごとに annotated_at が最新の注釈を採用する", () => {
		const 初回 = parseStrataAnnotation(
			JSON.stringify(正しい注釈),
			"hyperstrata.json",
		);
		const 再検討 = parseStrataAnnotation(
			JSON.stringify(再検討の注釈),
			"hyperstrata.20260911T031500Z.json",
		);
		const 猫の注釈 = parseStrataAnnotation(
			JSON.stringify({
				...正しい注釈,
				slug: "welcome-cat",
				relations: [],
				annotated_at: "2026-09-10T04:00:00Z",
			}),
			"welcome-cat.json",
		);
		// ファイルの並び順に依存しないことを確かめるため、再検討を先に渡す
		const latest = selectLatestAnnotations([再検討, 猫の注釈, 初回]);
		expect(latest.size).toBe(2);
		expect(latest.get("hyperstrata")?.summary).toBe(再検討の注釈.summary);
		expect(latest.get("hyperstrata")?.relations[0].type).toBe("revisits");
		expect(latest.get("welcome-cat")?.relations).toEqual([]);
	});
});
