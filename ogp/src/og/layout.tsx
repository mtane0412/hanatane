/**
 * OGP 画像のレイアウト（Satori 用 JSX）
 *
 * `src/components/OgpPreview.tsx` のブラウザ向けデザインを、
 * Satori が解釈できるインラインスタイルのみで再現しています。
 * Satori の制約: 複数の子を持つ div は display:flex が必須、Tailwind クラスは使えない。
 */

import type { ReactElement } from "react";
import { GRADIENT_CSS } from "./gradients";
import type { OgpRenderParams } from "./params";
import { splitTitleIntoLines } from "./title";

/** 出力画像の幅（px） */
export const OGP_WIDTH = 1200;

/** 出力画像の高さ（px） */
export const OGP_HEIGHT = 630;

/** 画像化に使うフォントファミリー名（Satori の fonts 設定と一致させる） */
export const FONT_FAMILY = "LINE Seed JP";

/**
 * OGP 画像の React 要素ツリーを構築する
 *
 * @param params - 表示するテキストと配色
 * @param authorIconDataUrl - 著者アイコンの data URL
 */
export function buildOgpElement(
	params: OgpRenderParams,
	authorIconDataUrl: string,
): ReactElement {
	const gradient = GRADIENT_CSS[params.gradient];
	const lines = splitTitleIntoLines(params.title);

	return (
		<div
			style={{
				width: OGP_WIDTH,
				height: OGP_HEIGHT,
				display: "flex",
				position: "relative",
				backgroundImage: gradient.base,
				fontFamily: FONT_FAMILY,
			}}
		>
			{gradient.decorations.map((decoration) => (
				<div
					key={decoration}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: OGP_WIDTH,
						height: OGP_HEIGHT,
						backgroundImage: decoration,
					}}
				/>
			))}

			{/* 白い角丸コンテンツボックス（p-16 相当の余白の内側） */}
			<div
				style={{
					display: "flex",
					width: "100%",
					height: "100%",
					padding: 64,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						justifyContent: "space-between",
						width: "100%",
						height: "100%",
						padding: 48,
						borderRadius: 24,
						backgroundColor: "#ffffff",
						boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
					}}
				>
					{/* 記事タイトル: 行ごとに文節チャンクを flex-wrap で並べる */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							fontSize: 60,
							fontWeight: 700,
							lineHeight: 1.25,
							color: "#111827",
						}}
					>
						{lines.map((chunks, lineIndex) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: 行は静的で並び替えが起きない
								key={lineIndex}
								style={{ display: "flex", flexWrap: "wrap" }}
							>
								{chunks.map((chunk, chunkIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: 同一文字列のチャンクが並びうるため位置で識別する
									<span key={chunkIndex}>{chunk}</span>
								))}
							</div>
						))}
					</div>

					{/* 下部: 著者情報とサイト名 */}
					<div
						style={{
							display: "flex",
							alignItems: "flex-end",
							justifyContent: "space-between",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 24 }}>
							<img
								src={authorIconDataUrl}
								alt={params.authorName}
								width={96}
								height={96}
								style={{
									width: 96,
									height: 96,
									borderRadius: 9999,
									border: "4px solid #f3f4f6",
									objectFit: "cover",
								}}
							/>
							<span style={{ fontSize: 30, fontWeight: 700, color: "#374151" }}>
								{params.authorName}
							</span>
						</div>
						<div style={{ fontSize: 36, fontWeight: 700, color: "#374151" }}>
							{params.siteName}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
