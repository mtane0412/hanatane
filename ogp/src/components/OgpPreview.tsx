/**
 * OGPプレビューコンポーネント
 *
 * OGP画像のリアルタイムプレビューを表示し、ダウンロード機能を提供します。
 * html-to-imageライブラリを使用してHTML要素を画像に変換します。
 * BudouXを使用して日本語テキストの自然な改行を実現します。
 */

import { Download } from "lucide-react";
import { useRef, useState, useMemo } from "react";
import { toPng } from "html-to-image";
import { loadDefaultJapaneseParser } from "budoux";
import type { OgpConfig } from "@/types/ogp";
import { getOgpSize, GRADIENT_PRESETS } from "@/types/ogp";

interface OgpPreviewProps {
	/** OGP設定 */
	config: OgpConfig;
}

/**
 * OGPプレビューコンポーネント
 *
 * @param props - コンポーネントのプロパティ
 */
export default function OgpPreview({ config }: OgpPreviewProps) {
	// プレビュー要素へのref（画像変換に使用）
	const previewRef = useRef<HTMLDivElement>(null);

	// ダウンロード中の状態管理
	const [isDownloading, setIsDownloading] = useState(false);

	// 設定から画像サイズを取得
	const { width, height } = getOgpSize(config);

	/**
	 * BudouXを使用して日本語テキストを自然な改行位置で分割
	 * ユーザーが入力した改行（\n）を<br>タグに変換し、
	 * 改行位置にwbrタグを挿入することで、ブラウザが適切に改行できるようにする
	 */
	const formattedTitle = useMemo(() => {
		const title = config.articleTitle || "記事タイトル";
		const parser = loadDefaultJapaneseParser();

		// 改行文字で分割し、各行をBudouXで処理してから<br>で結合
		const lines = title.split("\n");
		return lines
			.map((line) => {
				// 各行をBudouXで分割し、各フレーズをspanで囲み、間にwbrを挿入
				const chunks = parser.parse(line);
				return chunks
					.map((chunk) => `<span style="display:inline-block">${chunk}</span>`)
					.join("<wbr>");
			})
			.join("<br>");
	}, [config.articleTitle]);

	/**
	 * OGP画像をPNGとしてダウンロード
	 */
	const handleDownload = async () => {
		if (!previewRef.current) return;

		setIsDownloading(true);
		try {
			// HTML要素をPNG画像に変換
			const dataUrl = await toPng(previewRef.current, {
				width,
				height,
				pixelRatio: 1, // 設定されたサイズで出力
			});

			// ダウンロードリンクを作成してクリック
			const link = document.createElement("a");
			link.download = `ogp-${Date.now()}.png`;
			link.href = dataUrl;
			link.click();
		} catch (error) {
			console.error("画像のダウンロードに失敗しました:", error);
			alert("画像のダウンロードに失敗しました。もう一度お試しください。");
		} finally {
			setIsDownloading(false);
		}
	};

	// プレビューの最大幅を設定（画面に収まるように）
	const maxPreviewWidth = 600;
	const scale = Math.min(maxPreviewWidth / width, 1);
	const previewWidth = width * scale;
	const previewHeight = height * scale;

	// 選択されたグラデーションカラー設定を取得
	const gradientConfig = GRADIENT_PRESETS[config.gradientColor];

	// OGP画像のコンテンツをレンダリングする関数
	const renderOgpContent = () => (
		<div
			className={`relative overflow-hidden h-full ${gradientConfig.baseGradient}`}
		>
			{/* 背景装飾 - 動的なグラデーション効果 */}
			{gradientConfig.decorations.map((decoration) => (
				<div
					key={`${config.gradientColor}-${decoration}`}
					className={`absolute inset-0 ${decoration}`}
				/>
			))}

			{/* 白い角丸コンテンツボックス */}
			<div className="relative flex h-full items-center justify-center p-16">
				<div
					className="flex h-full w-full flex-col justify-between rounded-3xl bg-white p-12 shadow-2xl"
					style={{ fontFamily: '"LINE Seed JP", sans-serif' }}
				>
					{/* 記事タイトル */}
					<div className="flex-1">
						<h1
							className="text-6xl font-bold leading-tight text-gray-900"
							style={{
								wordBreak: "break-word",
								overflowWrap: "break-word",
							}}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: BudouXで生成された安全なHTMLを使用
							dangerouslySetInnerHTML={{ __html: formattedTitle }}
						/>
					</div>

					{/* 下部エリア: 著者情報とサイト名 */}
					<div className="flex items-end justify-between">
						{/* 著者情報 */}
						<div className="flex items-center gap-6">
							{/* 著者アイコン */}
							<img
								src={config.authorIconUrl || "/default_icon512.png"}
								alt={config.authorName}
								className="size-24 rounded-full border-4 border-gray-100 object-cover shadow-md"
							/>

							{/* 著者名 */}
							<span className="text-3xl font-semibold text-gray-700">
								{config.authorName || "著者名"}
							</span>
						</div>

						{/* サイト名 */}
						<div className="text-right">
							<div className="text-4xl font-bold text-gray-700">
								{config.siteName || "サイト名"}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	return (
		<div className="space-y-4">
			<h2 className="text-lg font-bold text-gray-900">プレビュー</h2>

			{/* プレビュー表示エリア */}
			<div className="overflow-hidden rounded-lg bg-gray-50 p-4">
				<div className="flex justify-center">
					{/* 縮小表示用ラッパー */}
					<div
						style={{
							width: `${previewWidth}px`,
							height: `${previewHeight}px`,
						}}
					>
						{/* プレビュー用のOGP画像（縮小表示） */}
						<div
							style={{
								width: `${width}px`,
								height: `${height}px`,
								transform: `scale(${scale})`,
								transformOrigin: "top left",
							}}
						>
							{renderOgpContent()}
						</div>
					</div>
				</div>
			</div>

			{/* 画像化用の非表示要素（transform無し） */}
			<div
				style={{
					position: "fixed",
					left: 0,
					top: 0,
					width: `${width}px`,
					height: `${height}px`,
					opacity: 0,
					pointerEvents: "none",
					zIndex: -1,
				}}
			>
				<div
					ref={previewRef}
					style={{ width: `${width}px`, height: `${height}px` }}
				>
					{renderOgpContent()}
				</div>
			</div>

			{/* サイズ情報とダウンロードボタン */}
			<div className="space-y-3">
				<div className="text-center text-sm text-gray-500">
					画像サイズ: {width} x {height}px
				</div>
				<button
					type="button"
					onClick={handleDownload}
					disabled={isDownloading}
					className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download className="size-5" />
					{isDownloading ? "ダウンロード中..." : "画像をダウンロード"}
				</button>
			</div>
		</div>
	);
}
