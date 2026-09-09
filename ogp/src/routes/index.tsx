/**
 * OGP画像作成アプリケーション - トップページ
 *
 * ユーザーがOGP画像を作成・プレビュー・ダウンロードするためのシンプルなシングルページアプリケーション。
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import OgpForm from "@/components/OgpForm";
import OgpPreview from "@/components/OgpPreview";
import type { OgpConfig } from "@/types/ogp";

export const Route = createFileRoute("/")({ component: App });

/**
 * OGP画像作成アプリケーション - メインコンポーネント
 */
function App() {
	// OGP設定の状態管理（初期値を設定）
	const [config, setConfig] = useState<OgpConfig>({
		siteName: "はなしのタネ",
		articleTitle: "記事タイトル",
		authorName: "たねのぶ",
		authorIconUrl: "/default_icon512.png",
		selectedSize: "standard",
		gradientColor: "purple",
	});

	return (
		<div className="min-h-screen bg-gray-50 py-8">
			<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
				{/* ページタイトル */}
				<div className="mb-8 text-center">
					<h1 className="text-4xl font-bold text-gray-900">
						はなしのタネOGP作る君
					</h1>
					<p className="mt-2 text-gray-600">
						ブログ用のOGP画像を簡単に作成・ダウンロードできます。主に自分用ですがご自由にお使いください。
					</p>
				</div>

				{/* メインコンテンツ: 2カラムレイアウト */}
				<div className="grid gap-8 lg:grid-cols-2">
					{/* 左カラム: 入力フォーム */}
					<div>
						<OgpForm config={config} onChange={setConfig} />
					</div>

					{/* 右カラム: プレビュー */}
					<div>
						<OgpPreview config={config} />
					</div>
				</div>

				{/* フッター */}
				<div className="mt-12 text-center text-sm text-gray-500">
					<p>
						<a
							href="https://hanatane.net"
							target="_blank"
							rel="noopener noreferrer"
							className="text-blue-600 hover:text-blue-800 underline"
						>
							はなしのタネ
						</a>
					</p>
				</div>
			</div>
		</div>
	);
}
