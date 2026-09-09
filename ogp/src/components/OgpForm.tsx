/**
 * OGP設定入力フォームコンポーネント
 *
 * ユーザーがサイト名、記事タイトル、著者名、著者アイコン、背景カラーを入力するためのフォーム。
 */

import { Upload } from "lucide-react";
import { useId, useRef } from "react";
import type { OgpConfig, GradientPreset } from "@/types/ogp";
import { GRADIENT_PRESETS } from "@/types/ogp";

interface OgpFormProps {
	/** 現在のOGP設定 */
	config: OgpConfig;
	/** 設定変更時のコールバック */
	onChange: (config: OgpConfig) => void;
}

/**
 * OGP設定入力フォームコンポーネント
 *
 * @param props - コンポーネントのプロパティ
 */
export default function OgpForm({ config, onChange }: OgpFormProps) {
	// ユニークなIDを生成（複数のフォームが存在する場合のID衝突を防ぐ）
	const siteNameId = useId();
	const articleTitleId = useId();
	const authorNameId = useId();
	const authorIconId = useId();

	// ファイル入力のref（プログラムから開くため）
	const fileInputRef = useRef<HTMLInputElement>(null);

	/**
	 * テキスト入力フィールドの変更ハンドラ
	 */
	const handleTextChange =
		(field: keyof OgpConfig) =>
		(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			onChange({ ...config, [field]: e.target.value });
		};

	/**
	 * グラデーションカラー選択の変更ハンドラ
	 */
	const handleGradientChange = (preset: GradientPreset) => {
		onChange({ ...config, gradientColor: preset });
	};

	/**
	 * ファイル選択ボタンのクリックハンドラ
	 */
	const handleFileButtonClick = () => {
		fileInputRef.current?.click();
	};

	/**
	 * 著者アイコンファイルの選択ハンドラ
	 */
	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// ファイルをDataURLとして読み込む
		const reader = new FileReader();
		reader.onload = (event) => {
			const dataUrl = event.target?.result as string;
			onChange({ ...config, authorIconUrl: dataUrl });
		};
		reader.readAsDataURL(file);
	};

	return (
		<div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
			<h2 className="text-lg font-bold text-gray-900">OGP設定</h2>

			{/* サイト名 */}
			<div>
				<label
					htmlFor={siteNameId}
					className="mb-1 block text-sm font-medium text-gray-700"
				>
					サイト名
				</label>
				<input
					id={siteNameId}
					type="text"
					value={config.siteName}
					onChange={handleTextChange("siteName")}
					className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="サイト名"
				/>
			</div>

			{/* 記事タイトル */}
			<div>
				<label
					htmlFor={articleTitleId}
					className="mb-1 block text-sm font-medium text-gray-700"
				>
					記事タイトル
				</label>
				<textarea
					id={articleTitleId}
					value={config.articleTitle}
					onChange={handleTextChange("articleTitle")}
					rows={2}
					className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="例: 記事タイトル"
				/>
			</div>

			{/* 著者名 */}
			<div>
				<label
					htmlFor={authorNameId}
					className="mb-1 block text-sm font-medium text-gray-700"
				>
					著者名
				</label>
				<input
					id={authorNameId}
					type="text"
					value={config.authorName}
					onChange={handleTextChange("authorName")}
					className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="例: saya"
				/>
			</div>

			{/* 著者アイコン */}
			<div>
				<label
					htmlFor={authorIconId}
					className="mb-1 block text-sm font-medium text-gray-700"
				>
					著者アイコン
				</label>
				<div className="flex items-center gap-3">
					{/* アイコンプレビュー */}
					<img
						src={config.authorIconUrl || "/default_icon512.png"}
						alt="著者アイコン"
						className="size-12 rounded-full border-2 border-gray-200 object-cover"
					/>

					{/* ファイル選択ボタン */}
					<button
						type="button"
						onClick={handleFileButtonClick}
						className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						<Upload className="size-4" />
						ファイルを選択
					</button>

					{/* 非表示のファイル入力 */}
					<input
						id={authorIconId}
						ref={fileInputRef}
						type="file"
						accept="image/*"
						onChange={handleFileChange}
						className="hidden"
					/>
				</div>
			</div>

			{/* 背景カラー選択 */}
			<div>
				<div className="mb-2 block text-sm font-medium text-gray-700">
					背景カラー
				</div>
				<div className="flex flex-wrap gap-2">
					{Object.values(GRADIENT_PRESETS).map((gradient) => (
						<button
							key={gradient.preset}
							type="button"
							onClick={() => handleGradientChange(gradient.preset)}
							className={`relative size-10 overflow-hidden rounded-full transition-all ${
								config.gradientColor === gradient.preset
									? "ring-2 ring-blue-500 ring-offset-2"
									: "ring-1 ring-gray-200 hover:ring-gray-300"
							}`}
							aria-label={`${gradient.label}カラーを選択`}
						>
							{/* グラデーション背景 */}
							<div className={`absolute inset-0 ${gradient.baseGradient}`}>
								{/* 装飾用のラジアルグラデーション */}
								{gradient.decorations.map((decoration, decorationIndex) => (
									<div
										key={`${gradient.preset}-decoration-${decorationIndex}`}
										className={`absolute inset-0 ${decoration}`}
									/>
								))}
							</div>

							{/* 選択状態のチェックマーク */}
							{config.gradientColor === gradient.preset && (
								<div className="absolute inset-0 flex items-center justify-center">
									<div className="rounded-full bg-white/90 p-0.5">
										<svg
											className="size-3 text-blue-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-hidden="true"
										>
											<title>選択中</title>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={3}
												d="M5 13l4 4L19 7"
											/>
										</svg>
									</div>
								</div>
							)}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
