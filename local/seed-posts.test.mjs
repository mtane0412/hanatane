/**
 * local/seed-posts.mjs の純粋関数(記事ファイル → Admin API の posts ペイロード、接続先の検査)のテスト。
 * Ghost や ghst には触れない。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPostPayload, assertLocalUrl} from './seed-posts.mjs';

const 記事 = {
    title: '2025年の振り返り',
    slug: '2025-reflection',
    status: 'published',
    visibility: 'public',
    tags: ['たねのぶの話', '#ref-welcome-cat'],
    excerpt: '年の瀬に2025年を月ごとに振り返ります',
    feature_image: 'https://hanatane.net/content/images/2025/12/photo.jpeg',
    featured: false,
    published_at: '2025-12-31T13:23:09.000Z',
    updated_at: '2026-01-13T08:35:33.000Z',
    lexical: {root: {children: [], type: 'root', version: 1}}
};

test('buildPostPayload: メタ情報と published_at を Admin API の posts の形に写し、lexical は文字列にする', () => {
    const payload = buildPostPayload(記事);
    assert.deepEqual(payload, {
        title: '2025年の振り返り',
        slug: '2025-reflection',
        status: 'published',
        visibility: 'public',
        published_at: '2025-12-31T13:23:09.000Z',
        custom_excerpt: '年の瀬に2025年を月ごとに振り返ります',
        feature_image: 'https://hanatane.net/content/images/2025/12/photo.jpeg',
        featured: false,
        tags: [{name: 'たねのぶの話'}, {name: '#ref-welcome-cat'}],
        lexical: JSON.stringify(記事.lexical)
    });
});

test('buildPostPayload: 無い項目(excerpt / feature_image / published_at)はペイロードに含めない', () => {
    const payload = buildPostPayload({title: '下書き', slug: 'draft', status: 'draft', visibility: 'public', tags: [], featured: false, lexical: {root: {}}});
    assert.deepEqual(Object.keys(payload).sort(), ['featured', 'lexical', 'slug', 'status', 'tags', 'title', 'visibility']);
});

test('buildPostPayload: 限定記事(visibility が public 以外)は Fail-Fast で例外にする', () => {
    assert.throws(() => buildPostPayload(Object.assign({}, 記事, {visibility: 'members'})), /public/);
});

test('assertLocalUrl: http://localhost または http://127.0.0.1 の URL だけを通す', () => {
    assert.doesNotThrow(() => assertLocalUrl('http://localhost:2368'));
    assert.doesNotThrow(() => assertLocalUrl('http://127.0.0.1:2368/'));
    assert.throws(() => assertLocalUrl('https://hanatane.net'), /ローカル/);
    assert.throws(() => assertLocalUrl('http://hanatane.net'), /ローカル/);
});
