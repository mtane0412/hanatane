/**
 * Ghost Admin API クライアントのテスト（fetch を差し替えて送信内容を検証する）
 */
import { describe, expect, it } from "vitest";
import { createAdminToken, createGhostAdminClient } from "./ghost-admin";

/** 記録用の fetch 差し替え */
function createFakeFetch(
	responder: (url: string, init: RequestInit) => unknown,
) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = String(input);
		calls.push({ url, init: init ?? {} });
		return new Response(JSON.stringify(responder(url, init ?? {})), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};
	return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const APIキー = `${"a".repeat(24)}:${"0f".repeat(32)}`;

describe("createAdminToken", () => {
	it("kid に id を持つ HS256 の JWT を生成する", () => {
		const token = createAdminToken(APIキー, 1_700_000_000);
		const [header, payload, signature] = token.split(".");
		expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
			alg: "HS256",
			typ: "JWT",
			kid: "a".repeat(24),
		});
		expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
			iat: 1_700_000_000,
			exp: 1_700_000_300,
			aud: "/admin/",
		});
		expect(signature.length).toBeGreaterThan(10);
	});

	it("id:secret 形式でなければエラーにする", () => {
		expect(() => createAdminToken("不正なキー")).toThrow(/id>:<secret>/);
	});
});

describe("createGhostAdminClient", () => {
	it("公開済みかつ画像未設定の記事を著者込みで取得する", async () => {
		const { calls, fetchImpl } = createFakeFetch(() => ({
			posts: [{ id: "p1" }],
		}));
		const client = createGhostAdminClient({
			adminUrl: "https://hanatane.net/",
			apiKey: APIキー,
			fetchImpl,
		});
		const posts = await client.listPostsNeedingOgImage();
		expect(posts).toEqual([{ id: "p1" }]);
		const url = new URL(calls[0].url);
		expect(url.origin + url.pathname).toBe(
			"https://hanatane.net/ghost/api/admin/posts/",
		);
		expect(url.searchParams.get("filter")).toBe(
			"status:published+feature_image:null+(og_image:null,twitter_image:null)",
		);
		expect(url.searchParams.get("include")).toBe("authors");
		expect(url.searchParams.get("limit")).toBe("all");
		expect(
			(calls[0].init.headers as Record<string, string>).Authorization,
		).toMatch(/^Ghost [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
	});

	it("サイト名を取得する", async () => {
		const { fetchImpl } = createFakeFetch(() => ({
			site: { title: "はなしのタネ" },
		}));
		const client = createGhostAdminClient({
			adminUrl: "https://hanatane.net",
			apiKey: APIキー,
			fetchImpl,
		});
		expect(await client.getSiteTitle()).toBe("はなしのタネ");
	});

	it("PNG を multipart で images/upload に送り、URL を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch(() => ({
			images: [
				{ url: "https://hanatane.net/content/images/og.png", ref: "og-p1.png" },
			],
		}));
		const client = createGhostAdminClient({
			adminUrl: "https://hanatane.net",
			apiKey: APIキー,
			fetchImpl,
		});
		const url = await client.uploadImage(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			"og-p1.png",
		);
		expect(url).toBe("https://hanatane.net/content/images/og.png");
		expect(calls[0].url).toBe(
			"https://hanatane.net/ghost/api/admin/images/upload/",
		);
		expect(calls[0].init.method).toBe("POST");
		const form = calls[0].init.body as FormData;
		expect(form).toBeInstanceOf(FormData);
		expect(form.get("purpose")).toBe("image");
		expect(form.get("ref")).toBe("og-p1.png");
		const file = form.get("file") as File;
		expect(file.name).toBe("og-p1.png");
		expect(file.type).toBe("image/png");
	});

	it("og_image を updated_at 付きで PUT する", async () => {
		const { calls, fetchImpl } = createFakeFetch(() => ({
			posts: [{ id: "p1" }],
		}));
		const client = createGhostAdminClient({
			adminUrl: "https://hanatane.net",
			apiKey: APIキー,
			fetchImpl,
		});
		await client.setSocialImages(
			{ id: "p1", updated_at: "2026-09-09T10:00:00.000Z" },
			"https://hanatane.net/content/images/og.png",
		);
		expect(calls[0].url).toBe("https://hanatane.net/ghost/api/admin/posts/p1/");
		expect(calls[0].init.method).toBe("PUT");
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			posts: [
				{
					og_image: "https://hanatane.net/content/images/og.png",
					twitter_image: "https://hanatane.net/content/images/og.png",
					updated_at: "2026-09-09T10:00:00.000Z",
				},
			],
		});
	});

	it("エラー応答は例外にする", async () => {
		const fetchImpl = (async () =>
			new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
		const client = createGhostAdminClient({
			adminUrl: "https://hanatane.net",
			apiKey: APIキー,
			fetchImpl,
		});
		await expect(client.getSiteTitle()).rejects.toThrow(/401/);
	});
});
