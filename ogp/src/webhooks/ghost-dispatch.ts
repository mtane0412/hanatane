/**
 * Ghost Webhook を GitHub Actions の repository_dispatch に中継する
 *
 * Ghost の Webhook は任意ヘッダーを付けられず GitHub API を直接叩けないため、
 * この Worker が `post.published` イベントを受け取り、GitHub に `ghost-post-published` を送ります。
 * これにより OGP 画像の事前生成（.github/workflows/sync-og-images.yml）が cron を待たずに走ります。
 *
 * 認証: Ghost の管理画面では Webhook の署名 secret を指定できないため、
 * 送信先 URL のクエリ `token` を Worker の secret と定数時間で比較して検証します。
 *
 * 注意: 失敗は例外や 4xx/5xx で明示し、暗黙に成功扱いにしません（Ghost 側の配信ログに残す）。
 */

import { timingSafeEqual } from "node:crypto";

/** GitHub に送る repository_dispatch の event_type（workflow 側の types と一致させる） */
export const DISPATCH_EVENT_TYPE = "ghost-post-published";

/** GitHub API が要求する User-Agent */
const USER_AGENT = "hanatane-ogp-webhook";

export interface GhostWebhookConfig {
	/** Ghost の送信先 URL に付与した token（Worker の secret） */
	webhookToken: string;
	/** repository_dispatch を送るための GitHub トークン（contents: write が必要） */
	githubToken: string;
	/** `owner/repo` 形式のリポジトリ名 */
	githubRepository: string;
	/** テスト用に差し替え可能な fetch */
	fetchImpl?: typeof fetch;
}

/** Ghost の post 系 Webhook ペイロードのうち、この中継で使う項目 */
interface GhostPostPayload {
	id: string;
	slug: string;
	status: string;
	feature_image: string | null;
}

/**
 * 2 つの文字列を定数時間で比較する（長さが違えば false）
 */
function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Webhook ペイロードから `post.current` を取り出す
 *
 * @returns 必要な項目が揃っていなければ null
 */
function extractPost(payload: unknown): GhostPostPayload | null {
	if (typeof payload !== "object" || payload === null) return null;
	const post = (payload as { post?: { current?: unknown } }).post?.current;
	if (typeof post !== "object" || post === null) return null;
	const { id, slug, status, feature_image } = post as Partial<GhostPostPayload>;
	if (typeof id !== "string" || typeof slug !== "string") return null;
	if (typeof status !== "string") return null;
	return { id, slug, status, feature_image: feature_image ?? null };
}

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function textResponse(message: string, status: number): Response {
	return new Response(message, {
		status,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

/**
 * Ghost からの Webhook リクエストを処理し、必要なら GitHub に repository_dispatch を送る
 *
 * - token 不一致: 401
 * - 本文が不正: 400
 * - feature_image あり / 未公開: 200（dispatch しない）
 * - dispatch 成功: 202、GitHub 側の失敗: 502
 */
export async function handleGhostWebhook(
	request: Request,
	config: GhostWebhookConfig,
): Promise<Response> {
	const token = new URL(request.url).searchParams.get("token") ?? "";
	if (!safeEqual(token, config.webhookToken)) {
		return textResponse("token が一致しません", 401);
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return textResponse("本文を JSON として読めません", 400);
	}

	const post = extractPost(payload);
	if (!post) {
		return textResponse("post.current を含むペイロードが必要です", 400);
	}

	if (post.status !== "published") {
		return jsonResponse(
			{ dispatched: false, slug: post.slug, reason: "status" },
			200,
		);
	}
	if (post.feature_image) {
		return jsonResponse(
			{ dispatched: false, slug: post.slug, reason: "feature_image" },
			200,
		);
	}

	const fetchImpl = config.fetchImpl ?? fetch;
	const response = await fetchImpl(
		`https://api.github.com/repos/${config.githubRepository}/dispatches`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.githubToken}`,
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
				"User-Agent": USER_AGENT,
			},
			body: JSON.stringify({
				event_type: DISPATCH_EVENT_TYPE,
				client_payload: { id: post.id, slug: post.slug },
			}),
		},
	);
	if (response.status !== 204) {
		const detail = await response.text();
		return textResponse(
			`GitHub repository_dispatch が失敗しました (${response.status}): ${detail}`,
			502,
		);
	}

	return jsonResponse({ dispatched: true, slug: post.slug }, 202);
}
