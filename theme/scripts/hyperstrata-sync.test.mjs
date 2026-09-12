/**
 * hyperstrata-sync.mjs の純粋関数に対するテスト。
 *
 * Ghost Admin API との通信を伴う処理はテスト対象外とし、
 * 本文HTMLからの引用先slug抽出、タグ差分の計算、
 * Admin API 用トークン生成、不要になった引用タグの判定、graph.json の組み立てを検証する。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';

import {
    extractReferencedSlugs,
    planTagUpdate,
    createAdminToken,
    buildRefTagsQuery,
    selectOrphanRefTags,
    buildGraph,
    serializeGraph,
    parseAnnotation,
    selectLatestAnnotations,
    GRAPH_JSON_PATH,
    REF_TAG_PREFIX,
    attachPaneLayout,
    PANE_MAX_COLUMNS
} from './hyperstrata-sync.mjs';

const サイトURL = 'https://example.com';

/** テスト用の記事URL→slug対応表（Ghost Admin API が返す url を想定） */
const 記事URL対応表 = new Map([
    ['https://example.com/hyperstrata-introduction/', 'hyperstrata-introduction'],
    ['https://example.com/digital-garden-limits/', 'digital-garden-limits'],
    ['https://example.com/correction-of-first-note/', 'correction-of-first-note']
]);

test('extractReferencedSlugs: 絶対URLの内部リンクから引用先slugを抽出する', () => {
    const html = '<p>前回の<a href="https://example.com/hyperstrata-introduction/">紹介記事</a>を参照。</p>';
    const result = extractReferencedSlugs({
        html,
        siteUrl: サイトURL,
        postUrlToSlug: 記事URL対応表,
        selfSlug: 'digital-garden-limits'
    });
    assert.deepEqual(result, ['hyperstrata-introduction']);
});

test('extractReferencedSlugs: 相対パス・クエリ・フラグメント付きのリンクも正規化して抽出する', () => {
    const html = [
        '<a href="/hyperstrata-introduction">末尾スラッシュ無し</a>',
        '<a href="/digital-garden-limits/?ref=note">クエリ付き</a>',
        '<a href=\'/correction-of-first-note/#section\'>フラグメント付き・シングルクォート</a>'
    ].join('');
    const result = extractReferencedSlugs({
        html,
        siteUrl: サイトURL,
        postUrlToSlug: 記事URL対応表,
        selfSlug: 'other-note'
    });
    assert.deepEqual(result, [
        'correction-of-first-note',
        'digital-garden-limits',
        'hyperstrata-introduction'
    ]);
});

test('extractReferencedSlugs: 外部リンク・未知のパス・自分自身へのリンクは無視し、重複は1件にまとめる', () => {
    const html = [
        '<a href="https://other.example.org/hyperstrata-introduction/">外部サイト</a>',
        '<a href="/tag/notes/">記事ではないパス</a>',
        '<a href="/digital-garden-limits/">自分自身</a>',
        '<a href="/hyperstrata-introduction/">1回目</a>',
        '<a href="https://example.com/hyperstrata-introduction/">2回目</a>'
    ].join('');
    const result = extractReferencedSlugs({
        html,
        siteUrl: サイトURL,
        postUrlToSlug: 記事URL対応表,
        selfSlug: 'digital-garden-limits'
    });
    assert.deepEqual(result, ['hyperstrata-introduction']);
});

test('extractReferencedSlugs: 本文が空(null)のときは空配列を返す', () => {
    const result = extractReferencedSlugs({
        html: null,
        siteUrl: サイトURL,
        postUrlToSlug: 記事URL対応表,
        selfSlug: 'digital-garden-limits'
    });
    assert.deepEqual(result, []);
});

test('planTagUpdate: 引用先が既存の引用タグと一致していれば変更なしと判定する', () => {
    const existingTags = [
        {id: 'tag-1', name: 'メモ', slug: 'memo'},
        {id: 'tag-2', name: `${REF_TAG_PREFIX}hyperstrata-introduction`, slug: 'hash-ref-hyperstrata-introduction'}
    ];
    const result = planTagUpdate({existingTags, referencedSlugs: ['hyperstrata-introduction']});
    assert.equal(result.changed, false);
});

test('planTagUpdate: 引用タグ以外の既存タグを維持したまま、引用タグを追加・削除する', () => {
    const existingTags = [
        {id: 'tag-1', name: 'メモ', slug: 'memo'},
        {id: 'tag-2', name: `${REF_TAG_PREFIX}old-note`, slug: 'hash-ref-old-note'},
        {id: 'tag-3', name: '#internal-only', slug: 'hash-internal-only'}
    ];
    const result = planTagUpdate({
        existingTags,
        referencedSlugs: ['hyperstrata-introduction', 'digital-garden-limits']
    });
    assert.equal(result.changed, true);
    assert.deepEqual(result.tags, [
        {id: 'tag-1'},
        {id: 'tag-3'},
        {name: `${REF_TAG_PREFIX}hyperstrata-introduction`, description: 'hyperstrata-introduction'},
        {name: `${REF_TAG_PREFIX}digital-garden-limits`, description: 'digital-garden-limits'}
    ]);
    assert.deepEqual(result.added, ['hyperstrata-introduction', 'digital-garden-limits']);
    assert.deepEqual(result.removed, ['old-note']);
});

test('createAdminToken: Admin APIキーからHS256署名付きのJWTを生成する', () => {
    const keyId = '5f9c2e3a1b2c3d4e5f6a7b8c';
    const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const 現在時刻秒 = 1_700_000_000;

    const token = createAdminToken(`${keyId}:${secret}`, 現在時刻秒);
    const [headerPart, payloadPart, signaturePart] = token.split('.');

    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
    assert.deepEqual(header, {alg: 'HS256', typ: 'JWT', kid: keyId});
    assert.deepEqual(payload, {iat: 現在時刻秒, exp: 現在時刻秒 + 5 * 60, aud: '/admin/'});

    const expectedSignature = createHmac('sha256', Buffer.from(secret, 'hex'))
        .update(`${headerPart}.${payloadPart}`)
        .digest('base64url');
    assert.equal(signaturePart, expectedSignature);
});

test('createAdminToken: "id:secret" 形式でないキーは例外を投げる', () => {
    assert.throws(() => createAdminToken('invalid-key', 0), /GHOST_ADMIN_API_KEY/);
});

test('buildRefTagsQuery: 引用タグ一覧のクエリは "#" を含まず、フィルタが URL エンコードされ、記事数を含める', () => {
    const query = buildRefTagsQuery();
    assert.ok(!query.includes('#'), 'URL クエリに "#" が含まれるとフラグメントとして切り捨てられる');
    assert.equal(query, `/tags/?limit=all&include=count.posts&filter=${encodeURIComponent("slug:~^'hash-ref-'")}`);
});

test('selectOrphanRefTags: どの記事にも付いていない引用タグだけを削除対象にする', () => {
    const tags = [
        {id: 'tag-1', name: `${REF_TAG_PREFIX}old-note`, slug: 'hash-ref-old-note', count: {posts: 0}},
        {id: 'tag-2', name: `${REF_TAG_PREFIX}hyperstrata-introduction`, slug: 'hash-ref-hyperstrata-introduction', count: {posts: 2}},
        {id: 'tag-3', name: `${REF_TAG_PREFIX}renamed-note`, slug: 'hash-ref-renamed-note', count: {posts: 0}}
    ];
    const result = selectOrphanRefTags(tags);
    assert.deepEqual(result.map(tag => tag.id), ['tag-1', 'tag-3']);
});

test('selectOrphanRefTags: 引用タグ以外の内部タグ・公開タグは記事数が0でも削除対象にしない', () => {
    const tags = [
        {id: 'tag-1', name: '#internal-only', slug: 'hash-internal-only', count: {posts: 0}},
        {id: 'tag-2', name: 'メモ', slug: 'memo', count: {posts: 0}},
        {id: 'tag-3', name: `${REF_TAG_PREFIX}old-note`, slug: 'hash-ref-old-note', count: {posts: 0}}
    ];
    const result = selectOrphanRefTags(tags);
    assert.deepEqual(result.map(tag => tag.id), ['tag-3']);
});

test('selectOrphanRefTags: 記事数(count.posts)が取得できていない引用タグがあれば例外を投げる', () => {
    const tags = [
        {id: 'tag-1', name: `${REF_TAG_PREFIX}old-note`, slug: 'hash-ref-old-note'}
    ];
    assert.throws(() => selectOrphanRefTags(tags), /count\.posts/);
});

// ---------------------------------------------------------------------------
// graph.json の生成(#25)
// ---------------------------------------------------------------------------

/** Admin API が返す記事の最小限の形(graph.json 生成に使う項目のみ) */
const グラフ用記事 = [
    {slug: 'hyperstrata-introduction', title: 'Hyperstrata 紹介', url: 'https://example.com/hyperstrata-introduction/', published_at: '2026-01-10T00:00:00.000Z'},
    {slug: 'digital-garden-limits', title: 'デジタルガーデンの限界', url: 'https://example.com/digital-garden-limits/', published_at: '2026-03-01T00:00:00.000Z'},
    {slug: 'correction-of-first-note', title: '最初のノートの訂正', url: 'https://example.com/correction-of-first-note/', published_at: '2026-03-01T00:00:00.000Z'}
];

test('buildGraph: 記事を公開日の降順(同日は slug 順)に並べ、slug/title/url/publishedAt/refs/inferredRefs/summary/icon/annotator/annotatedAt を含める', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', ['hyperstrata-introduction']],
        ['correction-of-first-note', ['digital-garden-limits', 'hyperstrata-introduction']]
    ]);
    // 入力順に依存しないことを確認するため、公開日順ではない順で渡す
    const graph = buildGraph({posts: [グラフ用記事[0], グラフ用記事[2], グラフ用記事[1]], referencedSlugsBySlug});
    assert.deepEqual(graph, {
        posts: [
            {slug: 'correction-of-first-note', title: '最初のノートの訂正', url: 'https://example.com/correction-of-first-note/', publishedAt: '2026-03-01T00:00:00.000Z', refs: ['digital-garden-limits', 'hyperstrata-introduction'], inferredRefs: [], summary: null, icon: null, annotator: null, annotatedAt: null},
            {slug: 'digital-garden-limits', title: 'デジタルガーデンの限界', url: 'https://example.com/digital-garden-limits/', publishedAt: '2026-03-01T00:00:00.000Z', refs: ['hyperstrata-introduction'], inferredRefs: [], summary: null, icon: null, annotator: null, annotatedAt: null},
            {slug: 'hyperstrata-introduction', title: 'Hyperstrata 紹介', url: 'https://example.com/hyperstrata-introduction/', publishedAt: '2026-01-10T00:00:00.000Z', refs: [], inferredRefs: [], summary: null, icon: null, annotator: null, annotatedAt: null}
        ]
    });
});

test('buildGraph: 引用先の対応表に無い記事があれば例外を投げる(引用抽出の漏れを黙って空にしない)', () => {
    const referencedSlugsBySlug = new Map([['hyperstrata-introduction', []]]);
    assert.throws(() => buildGraph({posts: グラフ用記事, referencedSlugsBySlug}), /digital-garden-limits/);
});

test('serializeGraph: 2 スペースインデントの JSON に末尾改行を付けて返す(差分検出のため出力を安定させる)', () => {
    const graph = {posts: [{slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: []}]};
    assert.equal(serializeGraph(graph), JSON.stringify(graph, null, 2) + '\n');
    assert.equal(serializeGraph(graph), serializeGraph(JSON.parse(serializeGraph(graph))));
});

test('GRAPH_JSON_PATH: テーマの assets 配下に置く(テーマ zip に同梱され {{asset}} で配信できる位置)', () => {
    assert.equal(GRAPH_JSON_PATH, 'assets/graph.json');
});

// ---------------------------------------------------------------------------
// 機械の層(posts/strata/)の合成(#12)
// ---------------------------------------------------------------------------

test('buildGraph: inferredRelationsBySlug を渡すと、各記事に inferredRefs({slug,type}[]) が付く', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const inferredRelationsBySlug = new Map([
        ['digital-garden-limits', [{slug: 'hyperstrata-introduction', type: 'continues'}]],
        ['correction-of-first-note', [
            {slug: 'digital-garden-limits', type: 'updates'},
            {slug: 'hyperstrata-introduction', type: 'revisits'}
        ]]
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, inferredRelationsBySlug});
    const 対応表 = new Map(graph.posts.map(post => [post.slug, post]));
    assert.deepEqual(対応表.get('hyperstrata-introduction').inferredRefs, []);
    assert.deepEqual(対応表.get('digital-garden-limits').inferredRefs, [
        {slug: 'hyperstrata-introduction', type: 'continues', reason: null}
    ]);
    assert.deepEqual(対応表.get('correction-of-first-note').inferredRefs, [
        {slug: 'digital-garden-limits', type: 'updates', reason: null},
        {slug: 'hyperstrata-introduction', type: 'revisits', reason: null}
    ]);
});

test('buildGraph: inferredRelationsBySlug に対応が無い記事は inferredRefs が空配列になる(refs と異なり例外にしない)', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const inferredRelationsBySlug = new Map();
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, inferredRelationsBySlug});
    graph.posts.forEach(post => {
        assert.deepEqual(post.inferredRefs, []);
    });
});

test('buildGraph: inferredRelationsBySlug を渡さない場合も、既存の呼び出し方のまま動作する(後方互換)', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', ['hyperstrata-introduction']],
        ['correction-of-first-note', []]
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug});
    graph.posts.forEach(post => {
        assert.deepEqual(post.inferredRefs, []);
    });
});

test('buildGraph: inferredRefs のうち、posts に存在しない関係先slugと自己参照は除外する', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const inferredRelationsBySlug = new Map([
        ['digital-garden-limits', [
            {slug: 'digital-garden-limits', type: 'continues'}, // 自己参照
            {slug: 'not-published-yet', type: 'continues'}, // posts に無い(下書きや削除済みを指している)
            {slug: 'hyperstrata-introduction', type: 'continues'}
        ]]
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, inferredRelationsBySlug});
    const 記事 = graph.posts.find(post => post.slug === 'digital-garden-limits');
    assert.deepEqual(記事.inferredRefs, [{slug: 'hyperstrata-introduction', type: 'continues', reason: null}]);
});

// ---------------------------------------------------------------------------
// 記事末尾への注釈表示(要約・関係の理由)用のフィールド追加
// ---------------------------------------------------------------------------

test('buildGraph: summaryBySlug を渡すと各記事に summary が付き、対応が無い記事は null になる', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const summaryBySlug = new Map([
        ['hyperstrata-introduction', 'Hyperstrata を Ghost に実装した記事の要約。']
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, summaryBySlug});
    const 対応表 = new Map(graph.posts.map(post => [post.slug, post]));
    assert.equal(対応表.get('hyperstrata-introduction').summary, 'Hyperstrata を Ghost に実装した記事の要約。');
    assert.equal(対応表.get('digital-garden-limits').summary, null);
});

test('buildGraph: inferredRelationsBySlug の各関係に reason があれば inferredRefs に含め、無ければ null にする', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const inferredRelationsBySlug = new Map([
        ['digital-garden-limits', [
            {slug: 'hyperstrata-introduction', type: 'continues', reason: '前回の紹介記事の続報のため。'}
        ]],
        ['correction-of-first-note', [
            {slug: 'hyperstrata-introduction', type: 'updates'} // reason 無し(private 注釈由来を想定)
        ]]
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, inferredRelationsBySlug});
    const 対応表 = new Map(graph.posts.map(post => [post.slug, post]));
    assert.deepEqual(対応表.get('digital-garden-limits').inferredRefs, [
        {slug: 'hyperstrata-introduction', type: 'continues', reason: '前回の紹介記事の続報のため。'}
    ]);
    assert.deepEqual(対応表.get('correction-of-first-note').inferredRefs, [
        {slug: 'hyperstrata-introduction', type: 'updates', reason: null}
    ]);
});

// ---------------------------------------------------------------------------
// parseAnnotation: posts/strata/ の注釈から graph.json 合成用の形を取り出す
// ---------------------------------------------------------------------------

test('parseAnnotation: includeText:true では summary と relations[].reason をそのまま含める(posts/strata/ の平文注釈)', () => {
    const annotation = {
        slug: 'hyperstrata-introduction',
        summary: 'Hyperstrata を Ghost に実装した記事の要約。',
        relations: [
            {slug: 'welcome-cat', type: 'continues', reason: '前回の記事として明言しているため。'}
        ],
        annotated_at: '2026-09-10T04:53:17Z',
        annotator: 'claude-sonnet-5'
    };
    const result = parseAnnotation(annotation, {includeText: true});
    assert.deepEqual(result, {
        slug: 'hyperstrata-introduction',
        summary: 'Hyperstrata を Ghost に実装した記事の要約。',
        relations: [
            {slug: 'welcome-cat', type: 'continues', reason: '前回の記事として明言しているため。'}
        ],
        icon: null,
        annotator: 'claude-sonnet-5',
        annotatedAt: '2026-09-10T04:53:17Z'
    });
});

test('parseAnnotation: includeText:false では summary と relations[].reason を null にする(posts/strata/private/ の暗号化注釈)', () => {
    const annotation = {
        slug: 'i-hate-multitask',
        summary: 'ENC[AES256_GCM,data:...]', // sops による暗号文
        relations: [
            {slug: 'diet-declaration-2023', type: 'continues', reason: 'ENC[AES256_GCM,data:...]'}
        ]
    };
    const result = parseAnnotation(annotation, {includeText: false});
    assert.deepEqual(result, {
        slug: 'i-hate-multitask',
        summary: null,
        relations: [
            {slug: 'diet-declaration-2023', type: 'continues', reason: null}
        ],
        icon: null,
        annotator: null,
        annotatedAt: null
    });
});

test('parseAnnotation: relations が無い注釈は空配列になる', () => {
    const result = parseAnnotation({slug: 'lonely-post'}, {includeText: true});
    assert.deepEqual(result, {slug: 'lonely-post', summary: null, relations: [], icon: null, annotator: null, annotatedAt: null});
});

// ---------------------------------------------------------------------------
// 題材アイコン(icon)の合成
// ---------------------------------------------------------------------------

test('parseAnnotation: icon はそのまま含める(private 由来の暗号化 summary/reason とは異なり暗号化されないため includeText に関わらず通す)', () => {
    const 平文注釈 = parseAnnotation({slug: 'welcome-cat', icon: 'cat'}, {includeText: true});
    assert.equal(平文注釈.icon, 'cat');
    const private注釈 = parseAnnotation({slug: 'welcome-cat', icon: 'cat'}, {includeText: false});
    assert.equal(private注釈.icon, 'cat');
});

test('parseAnnotation: icon が無い注釈は icon が null になる', () => {
    const result = parseAnnotation({slug: 'lonely-post'}, {includeText: true});
    assert.equal(result.icon, null);
});

test('buildGraph: iconBySlug を渡すと各記事に icon が付き、対応が無い記事は null になる', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const iconBySlug = new Map([
        ['hyperstrata-introduction', 'tech']
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, iconBySlug});
    const 対応表 = new Map(graph.posts.map(post => [post.slug, post]));
    assert.equal(対応表.get('hyperstrata-introduction').icon, 'tech');
    assert.equal(対応表.get('digital-garden-limits').icon, null);
});

test('buildGraph: iconBySlug を渡さない場合も、既存の呼び出し方のまま動作する(後方互換)', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug});
    graph.posts.forEach(post => {
        assert.equal(post.icon, null);
    });
});

// ---------------------------------------------------------------------------
// 発掘記録(annotator・annotated_at)の合成
// ---------------------------------------------------------------------------

test('parseAnnotation: annotator と annotated_at はそのまま含める(private でも暗号化されないため includeText に関わらず通す)', () => {
    const annotation = {slug: 'welcome-cat', annotated_at: '2026-09-10T04:51:15Z', annotator: 'claude-sonnet-5'};
    const 平文注釈 = parseAnnotation(annotation, {includeText: true});
    assert.equal(平文注釈.annotator, 'claude-sonnet-5');
    assert.equal(平文注釈.annotatedAt, '2026-09-10T04:51:15Z');
    const private注釈 = parseAnnotation(annotation, {includeText: false});
    assert.equal(private注釈.annotator, 'claude-sonnet-5');
    assert.equal(private注釈.annotatedAt, '2026-09-10T04:51:15Z');
});

test('buildGraph: annotatorBySlug と annotatedAtBySlug を渡すと各記事に annotator / annotatedAt が付き、対応が無い記事は null になる', () => {
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const annotatorBySlug = new Map([['hyperstrata-introduction', 'claude-sonnet-5']]);
    const annotatedAtBySlug = new Map([['hyperstrata-introduction', '2026-09-10T04:53:17Z']]);
    const graph = buildGraph({posts: グラフ用記事, referencedSlugsBySlug, annotatorBySlug, annotatedAtBySlug});
    const 対応表 = new Map(graph.posts.map(post => [post.slug, post]));
    assert.equal(対応表.get('hyperstrata-introduction').annotator, 'claude-sonnet-5');
    assert.equal(対応表.get('hyperstrata-introduction').annotatedAt, '2026-09-10T04:53:17Z');
    assert.equal(対応表.get('digital-garden-limits').annotator, null);
    assert.equal(対応表.get('digital-garden-limits').annotatedAt, null);
});

// selectLatestAnnotations: 1 記事に複数の注釈(初回 + 再検討)があるとき、annotated_at が最新のものを採用する(#32)

test('selectLatestAnnotations: 同じ slug の注釈が複数あれば annotated_at が最新のものだけを残す(ファイルの並び順に依存しない)', () => {
    const 初回 = parseAnnotation({slug: 'hyperstrata', summary: '初回の要約', relations: [{slug: 'window-film', type: 'continues', reason: '初回の理由'}], annotated_at: '2026-09-10T03:00:00.000Z', annotator: 'claude-sonnet-5'}, {includeText: true});
    const 再検討 = parseAnnotation({slug: 'hyperstrata', summary: '再検討の要約', relations: [{slug: 'window-film', type: 'revisits', reason: '再検討の理由'}], annotated_at: '2026-09-11T03:15:00Z', annotator: 'claude-fable-5-1', icon: 'tech'}, {includeText: true});
    const 猫 = parseAnnotation({slug: 'welcome-cat', summary: '猫の要約', relations: [], annotated_at: '2026-09-10T04:00:00Z', annotator: 'claude-sonnet-5'}, {includeText: true});
    const latest = selectLatestAnnotations([再検討, 猫, 初回]);
    assert.deepEqual(latest.map(item => item.slug), ['hyperstrata', 'welcome-cat']);
    assert.equal(latest[0].summary, '再検討の要約');
    assert.equal(latest[0].annotator, 'claude-fable-5-1');
    assert.equal(latest[0].annotatedAt, '2026-09-11T03:15:00Z');
    assert.deepEqual(latest[0].relations, [{slug: 'window-film', type: 'revisits', reason: '再検討の理由'}]);
});

test('selectLatestAnnotations: annotated_at が無い注釈が混ざっていれば例外を投げる(最新を決められない)', () => {
    const 日時なし = parseAnnotation({slug: 'hyperstrata', summary: '要約'}, {includeText: true});
    assert.throws(() => selectLatestAnnotations([日時なし]), /annotated_at/);
});

test('buildGraph: 再検討の注釈を採用したとき、graph.json には最新の summary / inferredRefs / annotator / annotatedAt だけが載る(履歴は含めない)', () => {
    const 初回 = parseAnnotation({slug: 'hyperstrata-introduction', summary: '初回の要約', relations: [{slug: 'digital-garden-limits', type: 'continues', reason: '初回の理由'}], annotated_at: '2026-09-10T03:00:00Z', annotator: 'claude-sonnet-5'}, {includeText: true});
    const 再検討 = parseAnnotation({slug: 'hyperstrata-introduction', summary: '再検討の要約', relations: [{slug: 'digital-garden-limits', type: 'updates', reason: '再検討の理由'}], annotated_at: '2026-09-11T03:15:00Z', annotator: 'claude-fable-5-1'}, {includeText: true});
    const latest = selectLatestAnnotations([初回, 再検討]);
    const referencedSlugsBySlug = new Map([
        ['hyperstrata-introduction', []],
        ['digital-garden-limits', []],
        ['correction-of-first-note', []]
    ]);
    const graph = buildGraph({
        posts: グラフ用記事,
        referencedSlugsBySlug,
        inferredRelationsBySlug: new Map(latest.map(item => [item.slug, item.relations])),
        summaryBySlug: new Map(latest.map(item => [item.slug, item.summary])),
        annotatorBySlug: new Map(latest.map(item => [item.slug, item.annotator])),
        annotatedAtBySlug: new Map(latest.map(item => [item.slug, item.annotatedAt]))
    });
    const 記事 = graph.posts.find(post => post.slug === 'hyperstrata-introduction');
    assert.equal(記事.summary, '再検討の要約');
    assert.equal(記事.annotator, 'claude-fable-5-1');
    assert.equal(記事.annotatedAt, '2026-09-11T03:15:00Z');
    assert.deepEqual(記事.inferredRefs, [{slug: 'digital-garden-limits', type: 'updates', reason: '再検討の理由'}]);
    assert.equal('history' in 記事, false);
});

/* ------------------------------------------------------------------
 * 記事ペインの列割り当て(#44): graph.json に paneCol / paneLanes を載せる
 * ------------------------------------------------------------------ */

test('attachPaneLayout: 各記事に列(paneCol)と、引用先・推定関係先ごとの幹の列(paneLanes)を付ける', () => {
    const graph = {posts: [
        {slug: 'newest', refs: ['oldest'], inferredRefs: [{slug: 'middle', type: 'continues', reason: null}]},
        {slug: 'middle', refs: [], inferredRefs: []},
        {slug: 'oldest', refs: [], inferredRefs: []}
    ]};
    const result = attachPaneLayout(graph, {maxColumns: 8});
    result.posts.forEach((post) => {
        assert.ok(Number.isInteger(post.paneCol), `${post.slug} に paneCol が無い`);
        assert.ok(post.paneCol >= 0 && post.paneCol < 8);
    });
    // newest → oldest(人間の引用)と newest → middle(推定)の 2 本ぶん
    assert.deepEqual(Object.keys(result.posts[0].paneLanes).sort(), ['middle', 'oldest']);
    assert.deepEqual(result.posts[1].paneLanes, {});
    assert.deepEqual(result.posts[2].paneLanes, {});
    // 引用チェーン newest → oldest は同じ列を継ぎ、middle は幹を避けて別の列になる
    assert.equal(result.posts[0].paneCol, result.posts[2].paneCol);
    assert.equal(result.posts[0].paneLanes.oldest, result.posts[0].paneCol);
    assert.notEqual(result.posts[1].paneCol, result.posts[0].paneCol);
});

test('attachPaneLayout: 入力の graph を変更せず、posts のその他の項目はそのまま残す', () => {
    const graph = {posts: [{slug: 'only', title: '唯一の記事', refs: [], inferredRefs: [], summary: null}]};
    const 複製 = JSON.stringify(graph);
    const result = attachPaneLayout(graph, {maxColumns: 8});
    assert.equal(JSON.stringify(graph), 複製);
    assert.equal(result.posts[0].title, '唯一の記事');
    assert.equal(result.posts[0].summary, null);
    assert.equal(result.posts[0].paneCol, 0);
    assert.deepEqual(result.posts[0].paneLanes, {});
});

test('attachPaneLayout: 一覧に無い引用先は paneLanes に含めない(buildGraph が refs に残した slug でも列は付けない)', () => {
    const graph = {posts: [{slug: 'only', refs: ['missing'], inferredRefs: []}]};
    const result = attachPaneLayout(graph, {maxColumns: 8});
    assert.deepEqual(result.posts[0].paneLanes, {});
});

test('PANE_MAX_COLUMNS: 記事ペインの列数の上限は 8(列幅 12px で最小幅 240px のペインに収まる)', () => {
    assert.equal(PANE_MAX_COLUMNS, 8);
});
