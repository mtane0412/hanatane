/**
 * Ghost Webhook 受け口のテスト（GitHub API への fetch を差し替えて送信内容を検証する）
 *
 * Ghost の署名形式: `X-Ghost-Signature: sha256=<HMAC-SHA256(secret, 本文 + タイムスタンプ) の hex>, t=<タイムスタンプ(ms)>`
 */
import { createHmac } from "node:crypto";
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

/** テストの「現在時刻」（ミリ秒） */
const 現在時刻 = 1_700_000_000_000;

const 設定 = {
	webhookSecret: "ghost-webhook-secret",
	githubToken: "ghp_dummy",
	githubRepository: "mtane0412/hanatane",
	now: () => 現在時刻,
};

/** Ghost と同じ方法で署名ヘッダーを作る */
function sign(body: string, timestamp: number, secret = 設定.webhookSecret) {
	const hex = createHmac("sha256", secret)
		.update(`${body}${timestamp}`)
		.digest("hex");
	return `sha256=${hex}, t=${timestamp}`;
}

/** Ghost の post.published イベント風のペイロードで POST リクエストを作る */
function createRequest(
	body: unknown,
	options: { signature?: string; rawBody?: string } = {},
) {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (options.signature !== undefined) {
		headers["X-Ghost-Signature"] = options.signature;
	}
	return new Request("https://ogp.example.com/webhooks/ghost", {
		method: "POST",
		headers,
		body: options.rawBody ?? JSON.stringify(body),
	});
}

/** 正しく署名した POST リクエストを作る */
function createSignedRequest(body: unknown, timestamp = 現在時刻) {
	const rawBody = JSON.stringify(body);
	return createRequest(body, { rawBody, signature: sign(rawBody, timestamp) });
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
	it("署名が正しければ repository_dispatch を送り 202 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createSignedRequest(公開記事ペイロード),
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

	it("署名ヘッダーが無ければ 401 を返し、GitHub を呼ばない", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(公開記事ペイロード),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("別の secret で署名されていれば 401 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const rawBody = JSON.stringify(公開記事ペイロード);
		const response = await handleGhostWebhook(
			createRequest(null, {
				rawBody,
				signature: sign(rawBody, 現在時刻, "wrong-secret"),
			}),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("署名後に本文が改ざんされていれば 401 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(null, {
				rawBody: JSON.stringify({ ...公開記事ペイロード, 改ざん: true }),
				signature: sign(JSON.stringify(公開記事ペイロード), 現在時刻),
			}),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("形式が崩れた署名ヘッダーは 401 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createRequest(公開記事ペイロード, { signature: "sha256=abc" }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("タイムスタンプが許容範囲（5 分）より古ければ 401 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const 六分前 = 現在時刻 - 6 * 60 * 1000;
		const response = await handleGhostWebhook(
			createSignedRequest(公開記事ペイロード, 六分前),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("タイムスタンプが許容範囲内なら受け付ける", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const 四分前 = 現在時刻 - 4 * 60 * 1000;
		const response = await handleGhostWebhook(
			createSignedRequest(公開記事ペイロード, 四分前),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(202);
		expect(calls).toHaveLength(1);
	});

	it("JSON として読めない本文は 400 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const rawBody = "{壊れた";
		const response = await handleGhostWebhook(
			createRequest(null, { rawBody, signature: sign(rawBody, 現在時刻) }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	it("post.current を含まないペイロードは 400 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createSignedRequest({ member: { current: {} } }),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	it("feature_image がある記事は dispatch せず 200 を返す", async () => {
		const { calls, fetchImpl } = createFakeFetch();
		const response = await handleGhostWebhook(
			createSignedRequest({
				post: {
					current: {
						...公開記事ペイロード.post.current,
						feature_image: "https://hanatane.net/content/images/cover.png",
					},
				},
			}),
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
			createSignedRequest({
				post: {
					current: { ...公開記事ペイロード.post.current, status: "draft" },
				},
			}),
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
			createSignedRequest(公開記事ペイロード),
			{ ...設定, fetchImpl },
		);
		expect(response.status).toBe(502);
		await expect(response.text()).resolves.toContain("401");
	});
});
