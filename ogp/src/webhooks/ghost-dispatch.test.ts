/**
 * Ghost Webhook 受け口のテスト（GitHub API への fetch を差し替えて送信内容を検証する）
 */
import { describe, expect, it } from "vitest";
import { handleGhostWebhook } from "./ghost-dispatch";

/** 記録用の fetch 差し替え（GitHub の repository_dispatch は 204 を返す） */
function createFakeFetch(status = 204) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.push({ url: String(input), init: init ?? {} });
		return new Response(status === 204 ? null : "GitHub 側のエラー", {
			status,
		});
	};
	return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const 設定 = {
	webhookToken: "webhook-secret-token",
	githubToken: "ghp_dummy",
	githubRepository: "mtane0412/hanatane",
};

/** Ghost の post.published イベント風のペイロードで POST リクエストを作る */
function createRequest(
	body: unknown,
	options: { token?: string; rawBody?: string } = {},
) {
	const url = new URL("https://ogp.example.com/webhooks/ghost");
	if (options.token !== undefined) {
		url.searchParams.set("token", options.token);
	}
	return new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: options.rawBody ?? JSON.stringify(body),
	});
}

const 公開記事ペイロード = {
	post: {
		current: {
			id: "post-1",
			slug: "hello-world",
			status: "published",
			feature_image: null,
		},
		previous: { status: "draft" },
	},
};

describe("handleGhostWebhook", () => {
	it("token が一致すれば repository_dispatch を送り 202 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(公開記事ペイロード, { token: 設定.webhookToken }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(202);
		await expect(response.json()).resolves.toEqual({
			dispatched: true,
			slug: "hello-world",
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"https://api.github.com/repos/mtane0412/hanatane/dispatches",
		);
		expect(calls[0].init.method).toBe("POST");
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer ghp_dummy");
		expect(headers.Accept).toBe("application/vnd.github+json");
		expect(headers["User-Agent"]).toBeTruthy();
		expect(JSON.parse(String(calls[0].init.body))).toEqual({
			event_type: "ghost-post-published",
			client_payload: { id: "post-1", slug: "hello-world" },
		});
	});

	it("token が無いか一致しなければ 401 を返し、GitHub を呼ばない", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const 無し = await handleGhostWebhook(createRequest(公開記事ペイロード), {
			...設定,
			fetchImpl,
		});
		const 不一致 = await handleGhostWebhook(
			createRequest(公開記事ペイロード, { token: "wrong" }),
			{ ...設定, fetchImpl },
		);
		expect(無し.status).toBe(401);
		expect(不一致.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("JSON として読めない本文は 400 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(null, { token: 設定.webhookToken, rawBody: "{壊れた" }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	it("post.current を含まないペイロードは 400 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest({ member: { current: {} } }, { token: 設定.webhookToken }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	it("feature_image がある記事は dispatch せず 200 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(
				{
					post: {
						current: {
							...公開記事ペイロード.post.current,
							feature_image: "https://hanatane.net/content/images/cover.png",
						},
					},
				},
				{ token: 設定.webhookToken },
			),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			dispatched: false,
			slug: "hello-world",
			reason: "feature_image",
		});
		expect(calls).toHaveLength(0);
	});

	it("公開済みでない記事は dispatch せず 200 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(
				{
					post: {
						current: { ...公開記事ペイロード.post.current, status: "draft" },
					},
				},
				{ token: 設定.webhookToken },
			),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			dispatched: false,
			slug: "hello-world",
			reason: "status",
		});
		expect(calls).toHaveLength(0);
	});

	it("GitHub が 204 以外を返したら 502 を返す", async () => {
		const { fetchImpl } = createFakeFetch(401);
		const response = await handleGhostWebhook(
			createRequest(公開記事ペイロード, { token: 設定.webhookToken }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(502);
		await expect(response.text()).resolves.toContain("401");
	});
});
