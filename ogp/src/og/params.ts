/**
 * OGP 画像生成エンドポイントのクエリパラメータ解析
 *
 * `/og?title=...&site=...&author=...&gradient=...` の各値を検証し、
 * レンダリングに必要な `OgpRenderParams` へ変換します。
 * 不正な入力は暗黙に補正せず `OgpParamError` として早期に失敗させます。
 */

import { GRADIENT_PRESETS, type GradientPreset } from "@/types/ogp";

/** タイトルの最大文字数（これを超える入力は拒否する） */
export const MAX_TITLE_LENGTH = 200;

/** サイト名・著者名の最大文字数 */
export const MAX_NAME_LENGTH = 50;

/** サイト名の既定値 */
export const DEFAULT_SITE_NAME = "はなしのタネ";

/** 著者名の既定値 */
export const DEFAULT_AUTHOR_NAME = "たねのぶ";

/** グラデーションの既定値 */
export const DEFAULT_GRADIENT: GradientPreset = "purple";

/**
 * レンダリングに必要なパラメータ
 */
export interface OgpRenderParams {
	/** 記事タイトル（`\n` による手動改行を含む場合がある） */
	title: string;
	/** サイト名 */
	siteName: string;
	/** 著者名 */
	authorName: string;
	/** 背景グラデーションのプリセット名 */
	gradient: GradientPreset;
}

/**
 * クエリパラメータが不正なときに投げるエラー
 *
 * ルートハンドラはこのエラーを HTTP 400 に変換します。
 */
export class OgpParamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OgpParamError";
	}
}

/**
 * 文字列パラメータを取り出し、長さの上限を検証する
 *
 * @param searchParams - リクエストのクエリ
 * @param key - パラメータ名
 * @param fallback - 未指定時の既定値
 */
function readName(
	searchParams: URLSearchParams,
	key: string,
	fallback: string,
): string {
	const value = searchParams.get(key)?.trim();
	if (!value) {
		return fallback;
	}
	if (value.length > MAX_NAME_LENGTH) {
		throw new OgpParamError(
			`${key} は ${MAX_NAME_LENGTH} 文字以内で指定してください`,
		);
	}
	return value;
}

/**
 * 文字列が既知のグラデーションプリセット名か判定する
 */
function isGradientPreset(value: string): value is GradientPreset {
	return Object.hasOwn(GRADIENT_PRESETS, value);
}

/**
 * クエリパラメータを解析して `OgpRenderParams` を返す
 *
 * @param searchParams - リクエスト URL のクエリ
 * @throws {OgpParamError} title が無い・長すぎる、または gradient が未知の場合
 */
export function parseOgpParams(searchParams: URLSearchParams): OgpRenderParams {
	const title = searchParams.get("title")?.trim();
	if (!title) {
		throw new OgpParamError("title は必須です");
	}
	if (title.length > MAX_TITLE_LENGTH) {
		throw new OgpParamError(
			`title は ${MAX_TITLE_LENGTH} 文字以内で指定してください`,
		);
	}

	const gradientInput = searchParams.get("gradient") ?? DEFAULT_GRADIENT;
	if (!isGradientPreset(gradientInput)) {
		throw new OgpParamError(
			`gradient は ${Object.keys(GRADIENT_PRESETS).join(", ")} のいずれかを指定してください`,
		);
	}

	return {
		title,
		siteName: readName(searchParams, "site", DEFAULT_SITE_NAME),
		authorName: readName(searchParams, "author", DEFAULT_AUTHOR_NAME),
		gradient: gradientInput,
	};
}
