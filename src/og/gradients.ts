/**
 * OGP 背景グラデーションの CSS 定義（Satori 用）
 *
 * `src/types/ogp.ts` の `GRADIENT_PRESETS` は Tailwind クラス名で定義されており、
 * Satori はクラス名を解釈しないため、同じ配色をインライン CSS 値として再定義しています。
 * 色コードは Tailwind CSS v4 の既定パレットに対応します。
 */

import type { GradientPreset } from "@/types/ogp";

/**
 * Satori に渡すグラデーション定義
 */
export interface GradientCss {
	/** ベースとなる linear-gradient */
	base: string;
	/** 上に重ねる radial-gradient の装飾層（順に重ねる） */
	decorations: string[];
}

/**
 * radial-gradient の装飾層を生成する
 *
 * 3 層の位置・透明度は `GRADIENT_PRESETS` の decorations と同じ配置です。
 */
function decorations(rgb1: string, rgb2: string, rgb3: string): string[] {
	return [
		`radial-gradient(circle at 20% 30%, rgba(${rgb1}, 0.3), transparent 50%)`,
		`radial-gradient(circle at 80% 70%, rgba(${rgb2}, 0.4), transparent 60%)`,
		`radial-gradient(circle at 50% 50%, rgba(${rgb3}, 0.2), transparent 70%)`,
	];
}

/**
 * `to bottom right` の 3 色 linear-gradient を生成する
 */
function base(from: string, via: string, to: string): string {
	return `linear-gradient(to bottom right, ${from}, ${via}, ${to})`;
}

/**
 * プリセット名ごとの CSS グラデーション定義
 */
export const GRADIENT_CSS: Record<GradientPreset, GradientCss> = {
	purple: {
		base: base("#8b5cf6", "#a855f7", "#d946ef"),
		decorations: decorations("236,72,153", "168,85,247", "59,130,246"),
	},
	blue: {
		base: base("#60a5fa", "#06b6d4", "#14b8a6"),
		decorations: decorations("59,130,246", "6,182,212", "20,184,166"),
	},
	pink: {
		base: base("#f472b6", "#fb7185", "#f87171"),
		decorations: decorations("244,114,182", "251,113,133", "248,113,113"),
	},
	orange: {
		base: base("#fbbf24", "#f97316", "#ef4444"),
		decorations: decorations("251,191,36", "249,115,22", "239,68,68"),
	},
	green: {
		base: base("#34d399", "#22c55e", "#0d9488"),
		decorations: decorations("52,211,153", "34,197,94", "13,148,136"),
	},
	sunset: {
		base: base("#fb923c", "#ec4899", "#9333ea"),
		decorations: decorations("251,146,60", "236,72,153", "147,51,234"),
	},
	ocean: {
		base: base("#38bdf8", "#3b82f6", "#4f46e5"),
		decorations: decorations("56,189,248", "59,130,246", "79,70,229"),
	},
	forest: {
		base: base("#a3e635", "#16a34a", "#047857"),
		decorations: decorations("163,230,53", "22,163,74", "4,120,87"),
	},
};
