/**
 * content/ と content/private/ の `.post.json` から記事一覧を作る（scripts/strata.ts と scripts/curate.ts で共有）
 *
 * 平文のメタ情報だけを読み、lexical は読まない。限定記事の暗号化済みファイルもメタ情報は平文なので復号しない。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { POST_JSON_SUFFIX } from "../../src/post-json";
import { PRIVATE_DIR } from "../../src/private-post";
import { type PublishedPost, readPublishedPost } from "../../src/strata";

/**
 * @param contentDir - posts/content の絶対パス
 */
export function loadPosts(contentDir: string): PublishedPost[] {
	const posts: PublishedPost[] = [];
	for (const dir of [contentDir, path.join(contentDir, PRIVATE_DIR)]) {
		if (!existsSync(dir)) continue;
		for (const fileName of readdirSync(dir)) {
			if (!fileName.endsWith(POST_JSON_SUFFIX)) continue;
			const content = readFileSync(path.join(dir, fileName), "utf8");
			posts.push(readPublishedPost(content, fileName));
		}
	}
	return posts;
}
