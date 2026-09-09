/**
 * OGP画像作成アプリケーションの型定義
 *
 * このファイルはOGP画像生成に必要なデータ構造を定義します。
 */

/**
 * OGP画像のサイズプリセット
 *
 * - standard: 標準サイズ（1200x630px）
 * - wide: ワイドサイズ（1200x675px、16:9比率）
 */
export type OgpSizePreset = "standard" | "wide";

/**
 * OGP画像の背景グラデーションプリセット
 */
export type GradientPreset =
	| "purple" // 紫系
	| "blue" // 青系
	| "pink" // ピンク系
	| "orange" // オレンジ系
	| "green" // 緑系
	| "sunset" // サンセット
	| "ocean" // オーシャン
	| "forest"; // フォレスト

/**
 * OGP画像のサイズ定義
 */
export interface OgpSize {
	/** サイズプリセット */
	preset: OgpSizePreset;
	/** 幅（ピクセル） */
	width: number;
	/** 高さ（ピクセル） */
	height: number;
	/** 表示用ラベル */
	label: string;
}

/**
 * グラデーションカラーの定義
 */
export interface GradientColor {
	/** プリセット名 */
	preset: GradientPreset;
	/** 表示用ラベル */
	label: string;
	/** ベースグラデーションクラス */
	baseGradient: string;
	/** 装飾用のラジアルグラデーション配列 */
	decorations: string[];
}

/**
 * OGP画像の設定データ
 */
export interface OgpConfig {
	/** サイト名 */
	siteName: string;
	/** 記事タイトル */
	articleTitle: string;
	/** 著者名 */
	authorName: string;
	/** 著者アイコンのURL（DataURLまたはHTTP URL） */
	authorIconUrl: string;
	/** 選択されたサイズプリセット */
	selectedSize: OgpSizePreset;
	/** 選択されたグラデーションプリセット */
	gradientColor: GradientPreset;
}

/**
 * サイズプリセットの定義リスト
 */
export const OGP_SIZE_PRESETS: Record<OgpSizePreset, OgpSize> = {
	standard: {
		preset: "standard",
		width: 1200,
		height: 630,
		label: "標準サイズ (1200x630)",
	},
	wide: {
		preset: "wide",
		width: 1200,
		height: 675,
		label: "ワイドサイズ (1200x675 / 16:9)",
	},
};

/**
 * グラデーションカラープリセットの定義リスト
 *
 * 美しく調和のとれたグラデーションパターンを定義します。
 */
export const GRADIENT_PRESETS: Record<GradientPreset, GradientColor> = {
	purple: {
		preset: "purple",
		label: "パープル",
		baseGradient:
			"bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(236,72,153,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(168,85,247,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.2),transparent_70%)]",
		],
	},
	blue: {
		preset: "blue",
		label: "ブルー",
		baseGradient: "bg-gradient-to-br from-blue-400 via-cyan-500 to-teal-500",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(59,130,246,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(6,182,212,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(20,184,166,0.2),transparent_70%)]",
		],
	},
	pink: {
		preset: "pink",
		label: "ピンク",
		baseGradient: "bg-gradient-to-br from-pink-400 via-rose-400 to-red-400",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(244,114,182,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(251,113,133,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(248,113,113,0.2),transparent_70%)]",
		],
	},
	orange: {
		preset: "orange",
		label: "オレンジ",
		baseGradient: "bg-gradient-to-br from-amber-400 via-orange-500 to-red-500",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(251,191,36,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(249,115,22,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.2),transparent_70%)]",
		],
	},
	green: {
		preset: "green",
		label: "グリーン",
		baseGradient:
			"bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(52,211,153,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(34,197,94,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(13,148,136,0.2),transparent_70%)]",
		],
	},
	sunset: {
		preset: "sunset",
		label: "サンセット",
		baseGradient:
			"bg-gradient-to-br from-orange-400 via-pink-500 to-purple-600",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(251,146,60,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(236,72,153,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(147,51,234,0.2),transparent_70%)]",
		],
	},
	ocean: {
		preset: "ocean",
		label: "オーシャン",
		baseGradient: "bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(56,189,248,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(79,70,229,0.2),transparent_70%)]",
		],
	},
	forest: {
		preset: "forest",
		label: "フォレスト",
		baseGradient:
			"bg-gradient-to-br from-lime-400 via-green-600 to-emerald-700",
		decorations: [
			"bg-[radial-gradient(circle_at_20%_30%,rgba(163,230,53,0.3),transparent_50%)]",
			"bg-[radial-gradient(circle_at_80%_70%,rgba(22,163,74,0.4),transparent_60%)]",
			"bg-[radial-gradient(circle_at_50%_50%,rgba(4,120,87,0.2),transparent_70%)]",
		],
	},
};

/**
 * OgpConfigから実際の画像サイズを取得する
 *
 * @param config OGP設定データ
 * @returns 画像の幅と高さ
 */
export function getOgpSize(config: OgpConfig): {
	width: number;
	height: number;
} {
	const preset = OGP_SIZE_PRESETS[config.selectedSize];
	return { width: preset.width, height: preset.height };
}
