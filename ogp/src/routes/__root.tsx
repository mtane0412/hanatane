import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "OGP画像作成 - はなしのタネ",
			},
			{
				name: "description",
				content:
					"ブログ用のOGP画像を簡単に作成・ダウンロードできるツールです。記事タイトルや著者情報を入力して、カスタムOGP画像を生成できます。",
			},
			// Open Graph Protocol
			{
				property: "og:title",
				content: "OGP画像作成 - はなしのタネ",
			},
			{
				property: "og:description",
				content:
					"ブログ用のOGP画像を簡単に作成・ダウンロードできるツールです。記事タイトルや著者情報を入力して、カスタムOGP画像を生成できます。",
			},
			{
				property: "og:image",
				content: "/ogp.png",
			},
			{
				property: "og:type",
				content: "website",
			},
			{
				property: "og:site_name",
				content: "はなしのタネ",
			},
			// Twitter Card
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
			{
				name: "twitter:title",
				content: "OGP画像作成 - はなしのタネ",
			},
			{
				name: "twitter:description",
				content:
					"ブログ用のOGP画像を簡単に作成・ダウンロードできるツールです。記事タイトルや著者情報を入力して、カスタムOGP画像を生成できます。",
			},
			{
				name: "twitter:image",
				content: "/ogp.png",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),

	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ja">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
