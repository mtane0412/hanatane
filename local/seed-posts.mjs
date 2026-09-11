/**
 * ローカル確認環境(local/docker-compose.yml の Ghost)へ、posts/content/*.post.json の公開記事を投入するスクリプト。
 *
 * posts の push スクリプトは published_at を送らない(本番では Ghost 側の日付を正とするため)が、
 * 地層グラフやタイムラインは公開日で並ぶので、ローカルでは本番と同じ公開日を再現する必要がある。
 * そのため ghst の汎用コマンド `ghst api posts/` で Admin API を直接呼び、published_at を含めて作成・更新する。
 *
 * 使い方(リポジトリルートで):
 *   node local/seed-posts.mjs            # すべての公開記事を投入する(slug が同じ記事は更新)
 *   node local/seed-posts.mjs <slug>...  # 指定した slug だけ
 *
 * 前提:
 *   - `pnpm ghst auth login --site local --url http://localhost:2368 --staff-token <id>:<secret>` 済みであること
 *     (alias を別名にした場合は環境変数 LOCAL_GHOST_SITE で指定する)
 *   - 接続先は常にその alias を使い、URL が localhost / 127.0.0.1 でなければ何もせずに止まる(本番への誤投入を防ぐ)
 *
 * 注意:
 *   - posts/content/private/(メンバー限定記事、sops 暗号化)は扱わない。ローカルには公開記事だけを入れる
 *   - feature_image などの画像 URL は本番(hanatane.net)を指したままにする
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** ghst の alias。既定は local。別名で登録した場合は環境変数 LOCAL_GHOST_SITE で指定する */
const SITE_ALIAS = process.env.LOCAL_GHOST_SITE || 'local';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(REPO_ROOT, 'posts/content');
/** ghst の実体。node から起動すると PATH に無いので、ルートの node_modules/.bin を直接使う */
const GHST_BIN = path.join(REPO_ROOT, 'node_modules/.bin/ghst');
const POST_JSON_SUFFIX = '.post.json';
/** ghst の終了コード: 記事が見つからない(README の Exit code mapping) */
const GHST_EXIT_NOT_FOUND = 5;

/**
 * 記事ファイル(pull が書き出す .post.json)を Admin API の posts 1 件のペイロードに変換する。
 * 無い項目は含めず、lexical は Admin API が要求する文字列にする。
 * 限定記事(visibility が public 以外)はローカルに入れない方針なので例外にする。
 */
export function buildPostPayload(post) {
    if (post.visibility !== 'public') {
        throw new Error(`${post.slug}: visibility が public の記事だけを投入できます(${post.visibility})`);
    }
    const payload = {
        title: post.title,
        slug: post.slug,
        status: post.status,
        visibility: post.visibility
    };
    if (post.published_at) {
        payload.published_at = post.published_at;
    }
    if (post.excerpt) {
        payload.custom_excerpt = post.excerpt;
    }
    if (post.feature_image) {
        payload.feature_image = post.feature_image;
    }
    payload.featured = Boolean(post.featured);
    payload.tags = (post.tags || []).map(function (name) {
        return {name: name};
    });
    payload.lexical = JSON.stringify(post.lexical);
    return payload;
}

/** 接続先がローカルの Ghost であることを確かめる。本番などへの誤投入を防ぐための Fail-Fast */
export function assertLocalUrl(url) {
    const host = new URL(url).hostname;
    if (!['localhost', '127.0.0.1'].includes(host)) {
        throw new Error(`接続先がローカルの Ghost ではありません: ${url}(alias "${SITE_ALIAS}" は http://localhost:2368 を指すようにしてください)`);
    }
}

/**
 * ghst を実行して stdout を返す。posts/scripts/push.ts と同じく、stdout はパイプだと途切れることがあるため一時ファイル経由で読む。
 */
function runGhst(args) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'seed-posts-'));
    const outPath = path.join(dir, 'stdout.json');
    try {
        const result = spawnSync('sh', ['-c', 'out="$1"; shift; exec "$0" "$@" > "$out"', GHST_BIN, outPath, ...args, '--site', SITE_ALIAS, '--json'], {
            stdio: ['ignore', 'ignore', 'inherit'],
            env: process.env
        });
        return {status: result.status, stdout: readFileSync(outPath, 'utf8')};
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
}

function assertOk(result, what) {
    if (result.status !== 0) {
        throw new Error(`${what} が終了コード ${String(result.status)} で失敗しました`);
    }
}

/** ghst api に渡す JSON ボディを一時ファイルに書いてから実行する */
function runGhstApi(endpoint, method, body) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'seed-posts-body-'));
    const bodyPath = path.join(dir, 'body.json');
    try {
        writeFileSync(bodyPath, JSON.stringify(body));
        return runGhst(['api', endpoint, '-X', method, '--input', bodyPath]);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
}

/** slug の記事がローカルにあれば {id, updated_at} を、無ければ null を返す */
function findExisting(slug) {
    const result = runGhst(['post', 'get', '--slug', slug]);
    if (result.status === GHST_EXIT_NOT_FOUND) {
        return null;
    }
    assertOk(result, `ghst post get --slug ${slug}`);
    const parsed = JSON.parse(result.stdout);
    const post = Array.isArray(parsed.posts) ? parsed.posts[0] : parsed;
    if (!post || !post.id || !post.updated_at) {
        throw new Error(`ghst post get の応答に id / updated_at がありません: ${slug}`);
    }
    return {id: post.id, updated_at: post.updated_at};
}

function seed(slug, payload) {
    const existing = findExisting(slug);
    if (existing) {
        // Admin API の更新は競合検出のため updated_at が必須
        const result = runGhstApi(`posts/${existing.id}/`, 'PUT', {posts: [Object.assign({}, payload, {updated_at: existing.updated_at})]});
        assertOk(result, `posts/${existing.id}/ の更新`);
        console.log(`更新しました: ${slug}`);
        return;
    }
    const result = runGhstApi('posts/', 'POST', {posts: [payload]});
    assertOk(result, `${slug} の作成`);
    console.log(`作成しました: ${slug}`);
}

function main() {
    if (!existsSync(GHST_BIN)) {
        throw new Error(`ghst が見つかりません: ${GHST_BIN}(リポジトリルートで pnpm install を実行してください)`);
    }
    // 接続先の Ghost が自分の URL として返す値で、ローカルであることを確かめる
    const info = runGhst(['site', 'info']);
    assertOk(info, `ghst site info --site ${SITE_ALIAS}`);
    const url = JSON.parse(info.stdout).site && JSON.parse(info.stdout).site.url;
    if (typeof url !== 'string') {
        throw new Error('ghst site info の応答に site.url がありません');
    }
    assertLocalUrl(url);

    const wanted = new Set(process.argv.slice(2));
    const files = readdirSync(CONTENT_DIR)
        .filter(function (name) {
            return name.endsWith(POST_JSON_SUFFIX) && (wanted.size === 0 || wanted.has(name.slice(0, -POST_JSON_SUFFIX.length)));
        })
        .sort();
    if (files.length === 0) {
        throw new Error('投入する記事がありません');
    }
    files.forEach(function (name) {
        const post = JSON.parse(readFileSync(path.join(CONTENT_DIR, name), 'utf8'));
        seed(post.slug, buildPostPayload(post));
    });
    console.log(`${files.length} 件を ${url} に投入しました`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
