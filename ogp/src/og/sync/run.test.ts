/**
 * 事前生成の実行フロー（取得 → 描画 → アップロード → og_image 設定）のテスト
 */
import { describe, expect, it, vi } from "vitest";
import type { GhostAdminClient } from "./ghost-admin";
import type { GhostPost } from "./plan";
import { syncOgImages } from "./run";

const 記事一覧: GhostPost[] = [
	{
		id: "p1",
		slug: "first",
		title: "一つ目",
		updated_at: "2026-09-09T10:00:00.000Z",
		feature_image: null,
		og_image: null,
		twitter_image: null,
		primary_author: { name: "たねのぶ" },
	},
	{
		id: "p2",
		slug: "second",
		title: "二つ目",
		updated_at: "2026-09-09T11:00:00.000Z",
		feature_image: null,
		og_image: null,
		twitter_image: null,
		primary_author: { name: "たねのぶ" },
	},
];

function createFakeClient(posts: GhostPost[]): GhostAdminClient {
	return {
		getSiteTitle: vi.fn(async () => "はなしのタネ"),
		listPostsNeedingOgImage: vi.fn(async () => posts),
		uploadImage: vi.fn(
			async (_png: Uint8Array, filename: string) =>
				`https://hanatane.net/content/images/${filename}`,
		),
		setSocialImages: vi.fn(async () => undefined),
	};
}

const 描画 = vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

describe("syncOgImages", () => {
	it("対象記事ごとに描画・アップロード・og_image 設定を行う", async () => {
		const client = createFakeClient(記事一覧);
		const result = await syncOgImages({
			client,
			render: 描画,
			dryRun: false,
			log: () => {},
		});
		expect(result.updated).toEqual(["first", "second"]);
		expect(client.uploadImage).toHaveBeenCalledTimes(2);
		expect(client.uploadImage).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			"og-first.png",
		);
		expect(client.setSocialImages).toHaveBeenCalledWith(
			記事一覧[0],
			"https://hanatane.net/content/images/og-first.png",
		);
		expect(描画).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "一つ目",
				siteName: "はなしのタネ",
				authorName: "たねのぶ",
			}),
		);
	});

	it("dryRun では描画もアップロードも更新も行わず対象だけ返す", async () => {
		const client = createFakeClient(記事一覧);
		const render = vi.fn(async () => new Uint8Array());
		const result = await syncOgImages({
			client,
			render,
			dryRun: true,
			log: () => {},
		});
		expect(result.updated).toEqual([]);
		expect(result.planned).toEqual(["first", "second"]);
		expect(render).not.toHaveBeenCalled();
		expect(client.uploadImage).not.toHaveBeenCalled();
		expect(client.setSocialImages).not.toHaveBeenCalled();
	});

	it("og_image だけ設定済みの記事は再生成せず、既存 URL を twitter_image にも設定する", async () => {
		const 生成済み = {
			...記事一覧[0],
			og_image: "https://hanatane.net/content/images/og-first.png",
		};
		const client = createFakeClient([生成済み]);
		const render = vi.fn(async () => new Uint8Array());
		const result = await syncOgImages({
			client,
			render,
			dryRun: false,
			log: () => {},
		});
		expect(result.updated).toEqual(["first"]);
		expect(render).not.toHaveBeenCalled();
		expect(client.uploadImage).not.toHaveBeenCalled();
		expect(client.getSiteTitle).not.toHaveBeenCalled();
		expect(client.setSocialImages).toHaveBeenCalledWith(
			生成済み,
			"https://hanatane.net/content/images/og-first.png",
		);
	});

	it("対象が無ければ何もしない", async () => {
		const client = createFakeClient([]);
		const result = await syncOgImages({
			client,
			render: 描画,
			dryRun: false,
			log: () => {},
		});
		expect(result.updated).toEqual([]);
		expect(client.getSiteTitle).not.toHaveBeenCalled();
	});
});
