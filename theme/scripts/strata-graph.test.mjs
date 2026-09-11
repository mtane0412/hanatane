/**
 * assets/js/strata-graph.js の純粋関数(レイアウト計算)に対するテスト。
 *
 * テーマの JS は gulp で連結されるブラウザ向けスクリプトのため、ESM として import できない。
 * そのため node:vm で読み込み、window.HyperstrataGraph に公開された関数を検証する。
 * DOM 操作(SVG 描画)はテスト対象外とする。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const スクリプト = readFileSync(new URL('../assets/js/strata-graph.js', import.meta.url), 'utf8');

/**
 * strata-graph.js をブラウザ環境なし(document 未定義)で評価し、公開 API を取り出す。
 * vm の別レルムで生成された配列・オブジェクトは assert.deepEqual(strict) でプロトタイプ不一致になるため、
 * buildLayout の戻り値は JSON を経由してテスト側レルムの値に正規化する。
 */
function 読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataGraph;
    return {
        buildLayout: (posts, options) => JSON.parse(JSON.stringify(api.buildLayout(posts, options))),
        assignBandIcons: (bands, nodes, options) => JSON.parse(JSON.stringify(api.assignBandIcons(bands, nodes, options)))
    };
}

const 記事 = [
    {slug: 'introduction', title: '紹介記事', url: '/introduction/', publishedAt: '2026-01-10T00:00:00.000Z', refs: []},
    {slug: 'limits', title: '限界について', url: '/limits/', publishedAt: '2026-03-01T00:00:00.000Z', refs: ['introduction']},
    {slug: 'correction', title: '紹介記事の訂正', url: '/correction/', publishedAt: '2026-05-20T00:00:00.000Z', refs: ['introduction', 'unknown-slug']}
];

test('buildLayout: ノードは新しい記事が上(公開日の降順)に並び、y座標が単調増加する', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout([記事[2], 記事[0], 記事[1]], {minGap: 40, pixelsPerDay: 1});
    // 地表(上)が新しい記事、深い層(下)が古い記事
    assert.deepEqual(layout.nodes.map(node => node.slug), ['correction', 'limits', 'introduction']);
    assert.ok(layout.nodes[0].y < layout.nodes[1].y);
    assert.ok(layout.nodes[1].y < layout.nodes[2].y);
});

test('buildLayout: 近接する公開日でも最小間隔(minGap)を確保する', () => {
    const {buildLayout} = 読み込む();
    const 同日 = [
        {slug: 'a', title: 'a', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: []},
        {slug: 'b', title: 'b', url: '/b/', publishedAt: '2026-01-01T01:00:00.000Z', refs: []}
    ];
    const layout = buildLayout(同日, {minGap: 40, pixelsPerDay: 1});
    assert.deepEqual(layout.nodes.map(node => node.slug), ['b', 'a']);
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, 40);
});

test('buildLayout: 経過日数に応じて間隔が広がる(pixelsPerDay)', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout([記事[0], 記事[1]], {minGap: 40, pixelsPerDay: 2});
    // 2026-01-10 → 2026-03-01 は 50 日。新しい limits が上(y 小)、古い introduction が下(y 大)
    assert.deepEqual(layout.nodes.map(node => node.slug), ['limits', 'introduction']);
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, 100);
});

test('buildLayout: 引用関係は「引用元 → 引用先」のエッジになり、人間の引用は kind: "human" を持つ', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout(記事, {minGap: 40, pixelsPerDay: 1});
    assert.deepEqual(layout.edges, [
        {from: 'correction', to: 'introduction', kind: 'human'},
        {from: 'limits', to: 'introduction', kind: 'human'}
    ]);
});

test('buildLayout: 一覧に存在しない slug への引用はエッジにしない', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout(記事, {minGap: 40, pixelsPerDay: 1});
    assert.ok(layout.edges.every(edge => edge.to !== 'unknown-slug'));
});

/* ------------------------------------------------------------------
 * Hyperstrata の注釈(機械の層)から作る推定エッジ(#12)
 * ------------------------------------------------------------------ */

const 推定を含む記事 = [
    {slug: 'introduction', title: '紹介記事', url: '/introduction/', publishedAt: '2026-01-10T00:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'limits', title: '限界について', url: '/limits/', publishedAt: '2026-03-01T00:00:00.000Z', refs: ['introduction'], inferredRefs: [{slug: 'introduction', type: 'continues'}]},
    {slug: 'correction', title: '紹介記事の訂正', url: '/correction/', publishedAt: '2026-05-20T00:00:00.000Z', refs: [], inferredRefs: [{slug: 'introduction', type: 'revisits'}, {slug: 'unknown-slug', type: 'continues'}]}
];

test('buildLayout: inferredRefs から kind: "inferred" のエッジを作る', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout(推定を含む記事, {minGap: 40, pixelsPerDay: 1});
    assert.deepEqual(layout.edges, [
        {from: 'correction', to: 'introduction', kind: 'inferred'},
        {from: 'limits', to: 'introduction', kind: 'human'}
    ]);
});

test('buildLayout: 一覧に存在しない slug への inferredRefs はエッジにしない', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout(推定を含む記事, {minGap: 40, pixelsPerDay: 1});
    assert.ok(layout.edges.every(edge => edge.to !== 'unknown-slug'));
});

test('buildLayout: 同じ記事の組を人間の引用と機械の推定が両方指す場合、人間の引用を優先し重複エッジを作らない', () => {
    const {buildLayout} = 読み込む();
    const 重複あり記事 = [
        {slug: 'introduction', title: '紹介記事', url: '/introduction/', publishedAt: '2026-01-10T00:00:00.000Z', refs: [], inferredRefs: []},
        {slug: 'limits', title: '限界について', url: '/limits/', publishedAt: '2026-03-01T00:00:00.000Z', refs: ['introduction'], inferredRefs: [{slug: 'introduction', type: 'continues'}]}
    ];
    const layout = buildLayout(重複あり記事, {minGap: 40, pixelsPerDay: 1});
    assert.deepEqual(layout.edges, [{from: 'limits', to: 'introduction', kind: 'human'}]);
});

test('buildLayout: 年ごとの区切り(yearMarks)は新しい年から順に、その年で最も新しいノードの位置に置く', () => {
    const {buildLayout} = 読み込む();
    const 複数年 = [
        {slug: 'a', title: 'a', url: '/a/', publishedAt: '2025-12-31T00:00:00.000Z', refs: []},
        {slug: 'b', title: 'b', url: '/b/', publishedAt: '2026-01-01T00:00:00.000Z', refs: []},
        {slug: 'c', title: 'c', url: '/c/', publishedAt: '2026-06-01T00:00:00.000Z', refs: []}
    ];
    const layout = buildLayout(複数年, {minGap: 40, pixelsPerDay: 1});
    // ノードは c(2026-06), b(2026-01), a(2025-12) の順。2026 の区切りは c、2025 の区切りは a の位置
    assert.deepEqual(layout.yearMarks.map(mark => mark.year), [2026, 2025]);
    assert.equal(layout.yearMarks[0].y, layout.nodes[0].y);
    assert.equal(layout.yearMarks[1].y, layout.nodes[2].y);
});

test('buildLayout: ノードは記事の icon をそのまま持ち、無ければ null になる', () => {
    const {buildLayout} = 読み込む();
    const 記事一覧 = [
        Object.assign({}, 記事[0], {icon: 'cat'}),
        Object.assign({}, 記事[1])
    ];
    const layout = buildLayout(記事一覧, {minGap: 40, pixelsPerDay: 1});
    const icons = Object.fromEntries(layout.nodes.map(node => [node.slug, node.icon]));
    assert.equal(icons.introduction, 'cat');
    assert.equal(icons.limits, null);
});

test('buildLayout: 空配列でもノード・エッジ・年ラベルが空の結果を返す', () => {
    const {buildLayout} = 読み込む();
    const layout = buildLayout([], {minGap: 40, pixelsPerDay: 1});
    assert.deepEqual(layout, {nodes: [], edges: [], yearMarks: [], hiatuses: [], height: 0});
});

test('buildLayout: 公開日が解釈できないノードは Fail-Fast で例外にする', () => {
    const {buildLayout} = 読み込む();
    assert.throws(
        () => buildLayout([{slug: 'x', title: 'x', url: '/x/', publishedAt: 'not-a-date', refs: []}], {minGap: 40, pixelsPerDay: 1}),
        /公開日/
    );
});

/* ------------------------------------------------------------------
 * 記事ページ左側の固定ペイン(partials/strata-pane.hbs)向けレイアウト
 * ------------------------------------------------------------------ */

/** ペイン用 API も含めて読み込む */
function ペインを読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataGraph;
    const 正規化 = value => JSON.parse(JSON.stringify(value));
    return {
        buildPaneLayout: (posts, options) => 正規化(api.buildPaneLayout(posts, options)),
        assignColumns: (nodes, edges) => 正規化(api.assignColumns(nodes, edges)),
        computeEmphasis: (nodes, edges, slug, hops) => 正規化(api.computeEmphasis(nodes, edges, slug, hops)),
        buildStrataBands: (marks, height) => 正規化(api.buildStrataBands(marks, height)),
        strataBoundaryPath: (y, width, options) => api.strataBoundaryPath(y, width, options),
        assignBandIcons: (bands, nodes, options) => 正規化(api.assignBandIcons(bands, nodes, options)),
        columnExtent: nodes => 正規化(api.columnExtent(nodes)),
        paneEdgePath: (edge, nodeY, options) => api.paneEdgePath(edge, nodeY, options)
    };
}

const ペイン設定 = {rowHeight: 26, monthGap: 30, paddingTop: 20, paddingBottom: 40};

/** 月ラベルはローカル時刻で判定するため、日付は月の中旬(タイムゾーンで月が変わらない)にする */
const ペイン記事 = [
    {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: []},
    {slug: 'middle', title: '中間の記事', url: '/middle/', publishedAt: '2026-01-20T12:00:00.000Z', refs: ['oldest']},
    {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: ['oldest']}
];

test('buildPaneLayout: ノードは新しい記事が上(row 0)になり、y が行ごとに増える', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(ペイン記事, ペイン設定);
    assert.deepEqual(layout.nodes.map(node => node.slug), ['newest', 'middle', 'oldest']);
    assert.deepEqual(layout.nodes.map(node => node.row), [0, 1, 2]);
    assert.ok(layout.nodes[0].y < layout.nodes[1].y);
    assert.ok(layout.nodes[1].y < layout.nodes[2].y);
    // 同じ月の隣接ノードは rowHeight ぶんだけ離れる
    assert.equal(layout.nodes[2].y - layout.nodes[1].y, ペイン設定.rowHeight);
});

test('buildPaneLayout: 月が変わるごとに YYYY-MM の区切りを置き、monthGap ぶん余白を空ける', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(ペイン記事, ペイン設定);
    assert.deepEqual(layout.monthMarks.map(mark => mark.label), ['2026-03', '2026-01']);
    // 区切りは各月の最初のノードより上にある
    assert.ok(layout.monthMarks[0].y < layout.nodes[0].y);
    assert.ok(layout.monthMarks[1].y < layout.nodes[1].y);
    assert.ok(layout.monthMarks[1].y > layout.nodes[0].y);
    // 月をまたぐ隣接ノードは rowHeight + monthGap ぶん離れる
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, ペイン設定.rowHeight + ペイン設定.monthGap);
    assert.equal(layout.height, layout.nodes[2].y + ペイン設定.paddingBottom);
});

test('buildPaneLayout: エッジは行番号(fromRow/toRow)と両端の列(fromCol/toCol)を持ち、fromRow < toRow になる', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(ペイン記事, ペイン設定);
    assert.deepEqual(
        layout.edges.map(edge => [edge.from, edge.to, edge.fromRow, edge.toRow]),
        [
            ['newest', 'oldest', 0, 2],
            ['middle', 'oldest', 1, 2]
        ]
    );
    const 列 = Object.fromEntries(layout.nodes.map(node => [node.slug, node.col]));
    assert.deepEqual(
        layout.edges.map(edge => [edge.fromCol, edge.toCol]),
        [[列.newest, 列.oldest], [列.middle, 列.oldest]]
    );
});

test('buildPaneLayout: ノードは列(col)を持ち、最も新しい記事の引用チェーン(newest → oldest)が列 0 を継ぎ、middle は別の列に分岐する', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(ペイン記事, ペイン設定);
    const 列 = Object.fromEntries(layout.nodes.map(node => [node.slug, node.col]));
    assert.equal(列.newest, 0);
    assert.equal(列.oldest, 0);
    assert.notEqual(列.middle, 0);
    assert.equal(layout.minCol, Math.min(列.newest, 列.middle, 列.oldest));
    assert.equal(layout.maxCol, Math.max(列.newest, 列.middle, 列.oldest));
});

test('buildPaneLayout: ノードは記事の summary(研究者の要約)をそのまま持ち、無ければ null になる(ツールチップに先頭を出すため)', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const 要約付き = ペイン記事.map(post => (post.slug === 'newest' ? {...post, summary: '最新の記事の要約。'} : post));
    const layout = buildPaneLayout(要約付き, ペイン設定);
    assert.deepEqual(layout.nodes.map(node => node.summary), ['最新の記事の要約。', null, null]);
});

test('buildPaneLayout: ノードは記事の icon をそのまま持ち、無ければ null になる', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const 記事一覧 = [
        Object.assign({}, ペイン記事[0], {icon: 'house'}),
        ペイン記事[1],
        ペイン記事[2]
    ];
    const layout = buildPaneLayout(記事一覧, ペイン設定);
    const icons = Object.fromEntries(layout.nodes.map(node => [node.slug, node.icon]));
    assert.equal(icons.oldest, 'house');
    assert.equal(icons.middle, null);
});

test('buildPaneLayout: 空配列でも空のレイアウトを返す', () => {
    const {buildPaneLayout} = ペインを読み込む();
    assert.deepEqual(buildPaneLayout([], ペイン設定), {nodes: [], edges: [], monthMarks: [], hiatuses: [], minCol: 0, maxCol: 0, height: 0});
});

/* ------------------------------------------------------------------
 * Hyperstrata の注釈(機械の層)から作る推定エッジ(#12)
 * ------------------------------------------------------------------ */

/** oldest への推定関係を middle にも持たせる(人間の引用は無い組み合わせ) */
const 推定を含むペイン記事 = [
    {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'middle', title: '中間の記事', url: '/middle/', publishedAt: '2026-01-20T12:00:00.000Z', refs: ['oldest'], inferredRefs: []},
    {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: ['oldest'], inferredRefs: [{slug: 'middle', type: 'continues'}]}
];

test('buildPaneLayout: 推定エッジ(kind: "inferred")を人間の引用に追加する', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(推定を含むペイン記事, ペイン設定);
    const 推定エッジ = layout.edges.filter(edge => edge.kind === 'inferred');
    assert.deepEqual(推定エッジ.map(edge => [edge.from, edge.to]), [['newest', 'middle']]);
    const 人間エッジ = layout.edges.filter(edge => edge.kind === 'human');
    assert.deepEqual(人間エッジ.map(edge => [edge.from, edge.to]), [['newest', 'oldest'], ['middle', 'oldest']]);
});

test('buildPaneLayout: 推定エッジを追加しても列(col)・minCol・maxCol は人間の引用のみの場合と変わらない(assignColumns に参加しない)', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const 人間のみ = buildPaneLayout(ペイン記事, ペイン設定);
    const 推定あり = buildPaneLayout(推定を含むペイン記事, ペイン設定);
    assert.deepEqual(推定あり.nodes.map(node => node.col), 人間のみ.nodes.map(node => node.col));
    assert.equal(推定あり.minCol, 人間のみ.minCol);
    assert.equal(推定あり.maxCol, 人間のみ.maxCol);
});

test('buildPaneLayout: 推定エッジの fromRow/toRow は上(新しい記事)から下(古い記事)へ揃える', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(推定を含むペイン記事, ペイン設定);
    const 推定エッジ = layout.edges.find(edge => edge.kind === 'inferred');
    assert.equal(推定エッジ.fromRow, 0); // newest
    assert.equal(推定エッジ.toRow, 1); // middle
});

test('buildPaneLayout: 同じ記事の組を人間の引用と機械の推定が両方指す場合、人間の引用を優先し重複エッジを作らない', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const 重複あり記事 = [
        {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: [], inferredRefs: []},
        {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: ['oldest'], inferredRefs: [{slug: 'oldest', type: 'continues'}]}
    ];
    const layout = buildPaneLayout(重複あり記事, ペイン設定);
    assert.deepEqual(layout.edges.map(edge => [edge.from, edge.to, edge.kind]), [['newest', 'oldest', 'human']]);
});

test('buildPaneLayout: inferredRefs 自体に同じ関係先が重複していても、推定エッジは 1 本だけ作る', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const 推定重複記事 = [
        {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: [], inferredRefs: []},
        {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: [], inferredRefs: [
            {slug: 'oldest', type: 'continues'},
            {slug: 'oldest', type: 'revisits'}
        ]}
    ];
    const layout = buildPaneLayout(推定重複記事, ペイン設定);
    assert.deepEqual(layout.edges.map(edge => [edge.from, edge.to, edge.kind]), [['newest', 'oldest', 'inferred']]);
});

/* ------------------------------------------------------------------
 * エッジの迂回(viaCol): 途中の行のノードや人間の幹の上を通らないように別の列へ回り込む
 * ------------------------------------------------------------------ */

/**
 * 行順(新しい順): a(0) b(1) c(2) e(3) f(4) d(5)。
 * 人間の引用: a→b, a→d, c→e。列は a,b,c,e,f が 0、d が +1(a→d の幹が +1 の行 1..5 を占有する)。
 * 推定: a→f は列 0 を直進すると b, c, e の上を通り、+1 は a→d の幹と重なるため、-1 へ迂回するはず。
 */
const 迂回が必要な記事 = [
    {slug: 'd', title: '最古の記事', url: '/d/', publishedAt: '2026-01-10T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'f', title: '記事f', url: '/f/', publishedAt: '2026-01-11T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'e', title: '記事e', url: '/e/', publishedAt: '2026-01-12T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'c', title: '記事c', url: '/c/', publishedAt: '2026-01-13T12:00:00.000Z', refs: ['e'], inferredRefs: []},
    {slug: 'b', title: '記事b', url: '/b/', publishedAt: '2026-01-14T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'a', title: '最新の記事', url: '/a/', publishedAt: '2026-01-15T12:00:00.000Z', refs: ['b', 'd'], inferredRefs: [{slug: 'f', type: 'continues'}]}
];

test('buildPaneLayout: 途中の行に同じ列のノードがある推定エッジは、ノードの無い列へ迂回する(viaCol)', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(迂回が必要な記事, ペイン設定);
    const 列 = Object.fromEntries(layout.nodes.map(node => [node.slug, node.col]));
    assert.deepEqual([列.a, 列.b, 列.c, 列.e, 列.f, 列.d], [0, 0, 0, 0, 0, 1]);
    const 推定エッジ = layout.edges.find(edge => edge.from === 'a' && edge.to === 'f');
    assert.equal(推定エッジ.kind, 'inferred');
    assert.equal(typeof 推定エッジ.viaCol, 'number');
    assert.notEqual(推定エッジ.viaCol, 0);
    // 迂回した列の途中の行(1..3)にノードは無い
    const 途中のノード = layout.nodes.filter(node => node.col === 推定エッジ.viaCol && node.row > 0 && node.row < 4);
    assert.deepEqual(途中のノード, []);
});

test('buildPaneLayout: 迂回する列は人間の幹(エッジの縦の区間)とも重ならない', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(迂回が必要な記事, ペイン設定);
    const 推定エッジ = layout.edges.find(edge => edge.from === 'a' && edge.to === 'f');
    // +1 は a→d の幹が行 1..5 を占有しているため使えず、-1 へ回る
    assert.equal(推定エッジ.viaCol, -1);
});

test('buildPaneLayout: 迂回した列は minCol / maxCol に含める(ペインの幅に反映するため)', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(迂回が必要な記事, ペイン設定);
    assert.equal(layout.minCol, -1);
    assert.equal(layout.maxCol, 1);
});

test('buildPaneLayout: 途中にノードの無いエッジは迂回しない(viaCol を持たない)', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const layout = buildPaneLayout(迂回が必要な記事, ペイン設定);
    const 迂回しない = layout.edges.filter(edge => !(edge.from === 'a' && edge.to === 'f'));
    assert.ok(迂回しない.length > 0);
    迂回しない.forEach(edge => {
        assert.equal(edge.viaCol, undefined, edge.from + ' → ' + edge.to);
    });
});

test('buildPaneLayout: 迂回するエッジ同士は同じ列を共有できる(ペインの幅を広げすぎないため)', () => {
    const {buildPaneLayout} = ペインを読み込む();
    const 記事一覧 = 迂回が必要な記事.map(post => post.slug === 'b'
        ? Object.assign({}, post, {inferredRefs: [{slug: 'f', type: 'continues'}]})
        : post);
    const layout = buildPaneLayout(記事一覧, ペイン設定);
    const aからf = layout.edges.find(edge => edge.from === 'a' && edge.to === 'f');
    const bからf = layout.edges.find(edge => edge.from === 'b' && edge.to === 'f');
    assert.equal(aからf.viaCol, -1);
    assert.equal(bからf.viaCol, -1);
    assert.equal(layout.minCol, -1);
});

test('paneEdgePath: viaCol を持つエッジは、上で迂回列へ S 字で移り、下で相手の列へ S 字で戻る', () => {
    const {paneEdgePath} = ペインを読み込む();
    const options = {axisX: 100, laneWidth: 12, rowHeight: 26};
    const nodeY = {a: 20, f: 150};
    const path = paneEdgePath({from: 'a', to: 'f', fromCol: 0, toCol: 0, viaCol: -1}, nodeY, options);
    assert.ok(path.startsWith('M 100 20'));
    assert.ok(path.endsWith('100 150'));
    // 迂回列(x = 88)を縦に通る
    assert.match(path, /L 88 \d+/);
    assert.equal((path.match(/ C /g) || []).length, 2);
});

test('paneEdgePath: viaCol の無いエッジは従来どおり(同じ列なら直線)', () => {
    const {paneEdgePath} = ペインを読み込む();
    const options = {axisX: 100, laneWidth: 12, rowHeight: 26};
    const path = paneEdgePath({from: 'a', to: 'f', fromCol: 0, toCol: 0}, {a: 20, f: 150}, options);
    assert.equal(path, 'M 100 20 L 100 150');
});

/**
 * assignColumns の入力を作る。slug の配列を行順(新しい順)のノードとし、[引用元, 引用先] の組をエッジにする。
 */
function 列割り当て入力(slugs, 引用) {
    const rowOf = Object.fromEntries(slugs.map((slug, row) => [slug, row]));
    return {
        nodes: slugs.map((slug, row) => ({slug, row})),
        edges: 引用.map(([from, to]) => ({from, to, fromRow: rowOf[from], toRow: rowOf[to]}))
    };
}

test('assignColumns: 引用チェーン(a → b → c)は 1 本の幹として同じ列 0 を継ぐ', () => {
    const {assignColumns} = ペインを読み込む();
    const {nodes, edges} = 列割り当て入力(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result = assignColumns(nodes, edges);
    assert.deepEqual(result.cols, [0, 0, 0]);
    assert.equal(result.minCol, 0);
    assert.equal(result.maxCol, 0);
});

test('assignColumns: 複数を引用する記事は、最も近い(新しい)引用先に列を継がせ、残りの引用先は別の列に分岐する', () => {
    const {assignColumns} = ペインを読み込む();
    // a は b(隣の行)と c(2 行下)を引用する。b が a の列を継ぎ、c は別の列に置かれる
    const {nodes, edges} = 列割り当て入力(['a', 'b', 'c'], [['a', 'c'], ['a', 'b']]);
    const result = assignColumns(nodes, edges);
    assert.equal(result.cols[0], 0);
    assert.equal(result.cols[1], 0);
    assert.notEqual(result.cols[2], 0);
});

test('assignColumns: 既に列を持つ引用先へは合流し、新しい列を作らない', () => {
    const {assignColumns} = ペインを読み込む();
    // a → c で c は列 0 を継ぐ。b も c を引用するが、c の列は変わらず、b は自分の列から c へ合流する
    const {nodes, edges} = 列割り当て入力(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']]);
    const result = assignColumns(nodes, edges);
    assert.equal(result.cols[0], 0);
    assert.equal(result.cols[2], 0);
    assert.notEqual(result.cols[1], 0);
    assert.equal(result.maxCol - result.minCol, 1);
});

test('assignColumns: 引用先までの途中の行が別の幹に占有されていれば、空いている列に退避する', () => {
    const {assignColumns} = ペインを読み込む();
    // a(row0) は c(row2) と e(row4) を引用する。近い c が列 0 を継ぎ、行 1〜2 を占有するため、
    // e は列 0 を通れず隣の列 1 に退避する(行 1〜4 を占有)。
    // 次に b(row1) を処理すると列 0 も列 1 も塞がっているので列 -1 に置かれ、b が引用する d も列 -1 を継ぐ
    const {nodes, edges} = 列割り当て入力(['a', 'b', 'c', 'd', 'e'], [['a', 'c'], ['a', 'e'], ['b', 'd']]);
    const result = assignColumns(nodes, edges);
    assert.deepEqual(result.cols, [0, -1, 0, -1, 1]);
    assert.equal(result.minCol, -1);
    assert.equal(result.maxCol, 1);
});

test('assignColumns: 引用も被引用も無い孤立した記事は、その行で空いていれば列 0 に置く', () => {
    const {assignColumns} = ペインを読み込む();
    const {nodes, edges} = 列割り当て入力(['a', 'b'], []);
    assert.deepEqual(assignColumns(nodes, edges).cols, [0, 0]);
});

test('assignColumns: 幹が通っている行にある孤立した記事は、幹を避けて隣の列に置く', () => {
    const {assignColumns} = ペインを読み込む();
    // a → c の幹が行 1 を通るため、行 1 の孤立記事 b は列 0 に置けない
    const {nodes, edges} = 列割り当て入力(['a', 'b', 'c'], [['a', 'c']]);
    const result = assignColumns(nodes, edges);
    assert.deepEqual(result.cols, [0, 1, 0]);
});

test('assignColumns: 入力のノード・エッジ配列を変更しない', () => {
    const {assignColumns} = ペインを読み込む();
    const {nodes, edges} = 列割り当て入力(['a', 'b'], [['a', 'b']]);
    const ノード複製 = JSON.stringify(nodes);
    const エッジ複製 = JSON.stringify(edges);
    assignColumns(nodes, edges);
    assert.equal(JSON.stringify(nodes), ノード複製);
    assert.equal(JSON.stringify(edges), エッジ複製);
});

/** 引用チェーン: a → b → c → d(矢印は「引用する → 引用される」)、e は孤立 */
const 連鎖エッジ = [
    {from: 'a', to: 'b'},
    {from: 'b', to: 'c'},
    {from: 'c', to: 'd'}
];
const 連鎖ノード = [{slug: 'a'}, {slug: 'b'}, {slug: 'c'}, {slug: 'd'}, {slug: 'e'}];

test('computeEmphasis: 現在記事から引用の向きを問わず 2 ホップまでの距離を返す', () => {
    const {computeEmphasis} = ペインを読み込む();
    const emphasis = computeEmphasis(連鎖ノード, 連鎖エッジ, 'b', 2);
    assert.deepEqual(emphasis.nodes, {b: 0, a: 1, c: 1, d: 2});
});

test('computeEmphasis: エッジの距離は両端ノードの近いほうの距離 + 1 になる', () => {
    const {computeEmphasis} = ペインを読み込む();
    const emphasis = computeEmphasis(連鎖ノード, 連鎖エッジ, 'b', 2);
    assert.deepEqual(emphasis.edges, [1, 1, 2]);
});

test('computeEmphasis: ホップ数の上限を超えるノード・エッジは含めない(距離 -1)', () => {
    const {computeEmphasis} = ペインを読み込む();
    const emphasis = computeEmphasis(連鎖ノード, 連鎖エッジ, 'a', 1);
    assert.deepEqual(emphasis.nodes, {a: 0, b: 1});
    assert.deepEqual(emphasis.edges, [1, -1, -1]);
});

test('computeEmphasis: 現在記事がグラフに無ければ何も強調しない', () => {
    const {computeEmphasis} = ペインを読み込む();
    const emphasis = computeEmphasis(連鎖ノード, 連鎖エッジ, 'missing', 2);
    assert.deepEqual(emphasis.nodes, {});
    assert.deepEqual(emphasis.edges, [-1, -1, -1]);
});

test('computeEmphasis: 現在記事の slug が空(トップページ)なら中立モードになり、何も暗くしない(距離 null)', () => {
    const {computeEmphasis} = ペインを読み込む();
    const emphasis = computeEmphasis(連鎖ノード, 連鎖エッジ, '', 2);
    assert.equal(emphasis.neutral, true);
    assert.deepEqual(emphasis.nodes, {});
    assert.deepEqual(emphasis.edges, [null, null, null]);
});

/* ------------------------------------------------------------------
 * 孤立した現在記事の強調(引用が無い記事でもノードとして存在すれば距離 0 にする)
 * ------------------------------------------------------------------ */

test('computeEmphasis: 引用が無い孤立した現在記事でも、ノードに存在すれば距離 0 で強調し、他はすべて暗くする', () => {
    const {computeEmphasis} = ペインを読み込む();
    const ノード = [{slug: 'a'}, {slug: 'b'}, {slug: 'c'}, {slug: 'd'}, {slug: 'lonely'}];
    const emphasis = computeEmphasis(ノード, 連鎖エッジ, 'lonely', 2);
    assert.equal(emphasis.neutral, false);
    assert.deepEqual(emphasis.nodes, {lonely: 0});
    assert.deepEqual(emphasis.edges, [-1, -1, -1]);
});

/* ------------------------------------------------------------------
 * 地層の帯(月ごとの区切りの間を地層として塗り分ける)
 * ------------------------------------------------------------------ */

test('buildStrataBands: 月の区切りごとに帯を作り、上から順に深さ(depth)が増える', () => {
    const {buildStrataBands} = ペインを読み込む();
    const bands = buildStrataBands([{label: '2026-03', y: 15}, {label: '2026-01', y: 71}], 140);
    assert.deepEqual(bands, [
        {label: '2026-03', top: 15, bottom: 71, depth: 0},
        {label: '2026-01', top: 71, bottom: 140, depth: 1}
    ]);
});

test('buildStrataBands: 区切りが無ければ帯も無い', () => {
    const {buildStrataBands} = ペインを読み込む();
    assert.deepEqual(buildStrataBands([], 100), []);
});

test('strataBoundaryPath: 波線は指定した y から始まり、右端(width)まで到達する', () => {
    const {strataBoundaryPath} = ペインを読み込む();
    const path = strataBoundaryPath(50, 200, {amplitude: 2, wavelength: 40});
    assert.match(path, /^M 0 50 /);
    // 最後の座標の x は width に一致する
    const 座標 = path.trim().split(/\s+/);
    assert.equal(Number(座標[座標.length - 2]), 200);
});

// ---------------------------------------------------------------------------
// assignBandIcons: 帯(地層)の中に題材アイコンをランダムに散らす
// ---------------------------------------------------------------------------

const 帯 = [
    {label: '2026-03', top: 0, bottom: 100, depth: 0},
    {label: '2026-01', top: 100, bottom: 300, depth: 1}
];

test('assignBandIcons: icon を持つノードだけを配置し、所属する帯(top <= y < bottom)の中に置く', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [
        {slug: 'newest', y: 40, icon: 'cat'},
        {slug: 'no-icon', y: 60, icon: null},
        {slug: 'middle', y: 140, icon: 'tech'}
    ];
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10});
    assert.deepEqual(placements.map(p => p.slug), ['newest', 'middle']);
    const 種別 = Object.fromEntries(placements.map(p => [p.slug, p.icon]));
    assert.equal(種別.newest, 'cat');
    assert.equal(種別.middle, 'tech');
    placements.forEach(p => {
        assert.ok(p.x >= 0 && p.x <= 200, 'x は xMin〜xMax の範囲内');
    });
    const newest = placements.find(p => p.slug === 'newest');
    assert.ok(newest.y >= 帯[0].top + 10 && newest.y <= 帯[0].bottom - 10, 'y は所属する帯の marginY を除いた範囲内');
});

test('assignBandIcons: どの帯にも属さない y のノード(範囲外)は配置しない', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [{slug: 'out-of-range', y: 500, icon: 'cat'}];
    assert.deepEqual(assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10}), []);
});

test('assignBandIcons: 同じ入力なら常に同じ位置を返す(決定的。再描画で種の位置が跳ねないため)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [{slug: 'stable-position', y: 40, icon: 'cat'}];
    const options = {xMin: 0, xMax: 200, marginY: 10};
    const 一回目 = assignBandIcons(帯, nodes, options);
    const 二回目 = assignBandIcons(帯, nodes, options);
    assert.deepEqual(一回目, 二回目);
});

test('assignBandIcons: slug が違えば(y が同じでも)配置が変わる(全部同じ位置に重ならない)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [
        {slug: 'a', y: 40, icon: 'cat'},
        {slug: 'b', y: 40, icon: 'cat'}
    ];
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10});
    assert.notDeepEqual([placements[0].x, placements[0].y], [placements[1].x, placements[1].y]);
});

test('assignBandIcons: options.avoid(ノード・エッジの描画領域)を渡すと、その範囲を避けて配置する', () => {
    const {assignBandIcons} = ペインを読み込む();
    // 多数のノードを用意し、avoid の範囲(80〜160)に x が落ちないことを網羅的に確認する
    const nodes = Array.from({length: 50}, (_, index) => ({slug: `post-${index}`, y: 40, icon: 'cat'}));
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10, avoid: {min: 80, max: 160}});
    placements.forEach(p => {
        assert.ok(p.x < 80 || p.x > 160, `x=${p.x} は avoid 範囲(80〜160)の外側であるべき`);
        assert.ok(p.x >= 0 && p.x <= 200, 'x は xMin〜xMax の範囲内');
    });
});

test('assignBandIcons: avoid が xMin〜xMax をほぼ覆っていても、残った隙間(xMin 側)に収まる', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [{slug: 'squeezed', y: 40, icon: 'cat'}];
    // avoid が右側(40〜200)を覆うので、残るのは xMin(0)〜40 の隙間だけ
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10, avoid: {min: 40, max: 200}});
    assert.equal(placements.length, 1);
    assert.ok(placements[0].x >= 0 && placements[0].x <= 40, `x=${placements[0].x} は残った隙間(0〜40)の内側であるべき`);
});

test('assignBandIcons: avoid を渡さない場合は従来どおり xMin〜xMax 全体から配置する(後方互換)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [{slug: 'stable-position', y: 40, icon: 'cat'}];
    const options = {xMin: 0, xMax: 200, marginY: 10};
    assert.deepEqual(assignBandIcons(帯, nodes, options), assignBandIcons(帯, nodes, Object.assign({}, options, {avoid: null})));
});

test('assignBandIcons: options.maxPerBand を渡すと、1つの帯に配置するアイコン数をその上限までに絞る', () => {
    const {assignBandIcons} = ペインを読み込む();
    // 帯[0](top:0〜bottom:100)に icon 付きノードを 6 件用意する
    const nodes = Array.from({length: 6}, (_, index) => ({slug: `dense-post-${index}`, y: 10 + index, icon: 'cat'}));
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10, maxPerBand: 3});
    assert.equal(placements.length, 3);
});

test('assignBandIcons: maxPerBand による絞り込みは決定的(同じ入力なら常に同じ3件を選ぶ)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = Array.from({length: 6}, (_, index) => ({slug: `dense-post-${index}`, y: 10 + index, icon: 'cat'}));
    const options = {xMin: 0, xMax: 200, marginY: 10, maxPerBand: 3};
    const 一回目 = assignBandIcons(帯, nodes, options).map(p => p.slug).sort();
    const 二回目 = assignBandIcons(帯, nodes, options).map(p => p.slug).sort();
    assert.deepEqual(一回目, 二回目);
});

test('assignBandIcons: maxPerBand は帯ごとに独立して適用する(帯をまたいで数えない)', () => {
    const {assignBandIcons} = ペインを読み込む();
    // 帯[0]に4件、帯[1]に4件(帯[1]は top:100〜bottom:300 の範囲)
    const nodes = [
        ...Array.from({length: 4}, (_, index) => ({slug: `band0-${index}`, y: 10 + index, icon: 'cat'})),
        ...Array.from({length: 4}, (_, index) => ({slug: `band1-${index}`, y: 110 + index, icon: 'cat'}))
    ];
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10, maxPerBand: 3});
    const 帯0の件数 = placements.filter(p => p.slug.startsWith('band0')).length;
    const 帯1の件数 = placements.filter(p => p.slug.startsWith('band1')).length;
    assert.equal(帯0の件数, 3);
    assert.equal(帯1の件数, 3);
});

test('assignBandIcons: maxPerBand を渡さない場合は従来どおり件数を絞らない(後方互換)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = Array.from({length: 6}, (_, index) => ({slug: `dense-post-${index}`, y: 10 + index, icon: 'cat'}));
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10});
    assert.equal(placements.length, 6);
});

test('assignBandIcons: 各配置は angle(回転角度)を持ち、-30〜30度の範囲に収まる(埋蔵物のように傾ける)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [{slug: 'tilted', y: 40, icon: 'cat'}];
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10});
    assert.equal(placements.length, 1);
    assert.ok(typeof placements[0].angle === 'number', 'angle は数値であるべき');
    assert.ok(placements[0].angle >= -30 && placements[0].angle <= 30, `angle=${placements[0].angle} は -30〜30 の範囲内であるべき`);
});

test('assignBandIcons: slug が違えば angle も変わる(全部同じ向きに揃わない)', () => {
    const {assignBandIcons} = ペインを読み込む();
    const nodes = [
        {slug: 'angle-a', y: 40, icon: 'cat'},
        {slug: 'angle-b', y: 40, icon: 'cat'}
    ];
    const placements = assignBandIcons(帯, nodes, {xMin: 0, xMax: 200, marginY: 10});
    assert.notEqual(placements[0].angle, placements[1].angle);
});

// ---------------------------------------------------------------------------
// columnExtent: ノード配列が使っている列(col)の最小値・最大値
// ---------------------------------------------------------------------------

test('columnExtent: ノードが使っている列の最小値・最大値を返す', () => {
    const {columnExtent} = ペインを読み込む();
    const nodes = [{slug: 'a', col: 0}, {slug: 'b', col: 2}, {slug: 'c', col: -1}];
    assert.deepEqual(columnExtent(nodes), {min: -1, max: 2});
});

test('columnExtent: ノードが空配列なら null を返す', () => {
    const {columnExtent} = ペインを読み込む();
    assert.equal(columnExtent([]), null);
});

// ---------------------------------------------------------------------------
// graph.json の読み取り(#25)
// ---------------------------------------------------------------------------

/** parseGraph を読み込む(戻り値はテスト側レルムの値に正規化する) */
function parseGraphを読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    return data => JSON.parse(JSON.stringify(window.HyperstrataGraph.parseGraph(data)));
}

test('parseGraph: graph.json の posts をそのまま記事配列として返す', () => {
    const parseGraph = parseGraphを読み込む();
    const posts = parseGraph({posts: 記事});
    assert.deepEqual(posts, 記事);
});

test('parseGraph: posts が配列でない・必須項目が欠けている場合は例外を投げる', () => {
    const parseGraph = parseGraphを読み込む();
    assert.throws(() => parseGraph({}), /posts/);
    assert.throws(() => parseGraph({posts: 'not-an-array'}), /posts/);
    assert.throws(() => parseGraph({posts: [{slug: 'a', title: 'A', url: '/a/', refs: []}]}), /publishedAt/);
    assert.throws(() => parseGraph({posts: [{slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z'}]}), /refs/);
});

/* ------------------------------------------------------------------
 * inferredRefs(機械の層)の検証(#12): 省略可能な項目として扱い、旧形式の graph.json でも壊れない
 * ------------------------------------------------------------------ */

test('parseGraph: inferredRefs フィールドが無い記事(旧形式の graph.json)も検証を通す', () => {
    const parseGraph = parseGraphを読み込む();
    const posts = parseGraph({posts: 記事}); // 記事 fixture には inferredRefs が無い
    assert.deepEqual(posts, 記事);
});

test('parseGraph: inferredRefs がある場合は {slug, type} の配列として通す', () => {
    const parseGraph = parseGraphを読み込む();
    const 記事with推定 = [{
        slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: [],
        inferredRefs: [{slug: 'b', type: 'continues'}]
    }];
    const posts = parseGraph({posts: 記事with推定});
    assert.deepEqual(posts, 記事with推定);
});

test('parseGraph: inferredRefs が配列でない場合は例外を投げる', () => {
    const parseGraph = parseGraphを読み込む();
    assert.throws(
        () => parseGraph({posts: [{slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: [], inferredRefs: 'not-an-array'}]}),
        /inferredRefs/
    );
});

test('parseGraph: inferredRefs の要素に slug または type が無い場合は例外を投げる', () => {
    const parseGraph = parseGraphを読み込む();
    assert.throws(
        () => parseGraph({posts: [{slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: [], inferredRefs: [{slug: 'b'}]}]}),
        /inferredRefs/
    );
    assert.throws(
        () => parseGraph({posts: [{slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: [], inferredRefs: [{type: 'continues'}]}]}),
        /inferredRefs/
    );
});

/* ------------------------------------------------------------------
 * トップページの地層タイムライン(partials/strata-timeline.hbs)向けレイアウト
 * ------------------------------------------------------------------ */

/** タイムライン用 API を読み込む */
function タイムラインを読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataGraph;
    return {
        buildTimelineLayout: (rows, posts) => JSON.parse(JSON.stringify(api.buildTimelineLayout(rows, posts))),
        placeTimelineAxis: options => JSON.parse(JSON.stringify(api.placeTimelineAxis(options)))
    };
}

/**
 * テンプレートが出力し JS が計測した行(新しい順)。month は行の公開月、publishedAt は行の公開日時(data-published)、
 * top/bottom は行の上下端、y は種の中心
 */
const 行 = [
    {slug: 'newest', month: '2026-03', publishedAt: '2026-03-15T12:00:00.000Z', top: 0, bottom: 100, y: 40},
    {slug: 'middle', month: '2026-01', publishedAt: '2026-01-20T12:00:00.000Z', top: 100, bottom: 200, y: 140},
    {slug: 'oldest', month: '2026-01', publishedAt: '2026-01-15T12:00:00.000Z', top: 200, bottom: 300, y: 240}
];

const タイムライン記事 = [
    {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: ['oldest', 'ancient', 'prehistoric']},
    {slug: 'middle', title: '中間の記事', url: '/middle/', publishedAt: '2026-01-20T12:00:00.000Z', refs: ['oldest']},
    {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: []},
    {slug: 'ancient', title: 'ページ外の古い記事', url: '/ancient/', publishedAt: '2025-06-01T12:00:00.000Z', refs: []}
];

test('buildTimelineLayout: 連続する同じ月の行を 1 つの地層の帯にまとめ、上から順に深さ(depth)が増える', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const layout = buildTimelineLayout(行, タイムライン記事);
    assert.deepEqual(layout.bands, [
        {label: '2026-03', top: 0, bottom: 100, depth: 0},
        {label: '2026-01', top: 100, bottom: 300, depth: 1}
    ]);
});

test('buildTimelineLayout: ノードは行の順に並び、行番号・種の y 座標・列(col)を持つ', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const layout = buildTimelineLayout(行, タイムライン記事);
    assert.deepEqual(layout.nodes.map(node => [node.slug, node.row, node.y]), [['newest', 0, 40], ['middle', 1, 140], ['oldest', 2, 240]]);
    layout.nodes.forEach(node => assert.equal(typeof node.col, 'number'));
});

test('buildTimelineLayout: ノードは posts の icon をそのまま持ち、graph.json に無い行(icon 未取得)は null になる', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const 記事一覧 = タイムライン記事.map(post => post.slug === 'oldest' ? Object.assign({}, post, {icon: 'travel'}) : post);
    const 行一覧 = 行.concat([{slug: 'not-synced', month: '2025-12', publishedAt: '2025-12-10T12:00:00.000Z', top: 300, bottom: 400, y: 340}]);
    const layout = buildTimelineLayout(行一覧, 記事一覧);
    const icons = Object.fromEntries(layout.nodes.map(node => [node.slug, node.icon]));
    assert.equal(icons.oldest, 'travel');
    assert.equal(icons.newest, null);
    assert.equal(icons['not-synced'], null);
});

test('buildTimelineLayout: エッジは表示中の行どうしの引用だけを持ち、上(fromRow)から下(toRow)へ向く', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const layout = buildTimelineLayout(行, タイムライン記事);
    assert.deepEqual(layout.edges.map(edge => [edge.from, edge.to, edge.fromRow, edge.toRow]), [
        ['newest', 'oldest', 0, 2],
        ['middle', 'oldest', 1, 2]
    ]);
    layout.edges.forEach(edge => {
        assert.equal(typeof edge.fromCol, 'number');
        assert.equal(typeof edge.toCol, 'number');
    });
});

test('buildTimelineLayout: 表示中の行に無い記事への引用は、行ごとにページ外の本数(offPage)として数える', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const layout = buildTimelineLayout(行, タイムライン記事);
    // newest は ancient(graph.json にある)と prehistoric(graph.json にも無い)の 2 本がページ外
    assert.deepEqual(layout.offPage, [{slug: 'newest', row: 0, count: 2}]);
});

test('buildTimelineLayout: graph.json に無い行(同期前の新しい記事)は引用の無い孤立した記事として扱う', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const 未同期の行 = [{slug: 'unsynced', month: '2026-04', publishedAt: '2026-04-10T12:00:00.000Z', top: 0, bottom: 100, y: 40}].concat(行);
    const layout = buildTimelineLayout(未同期の行, タイムライン記事);
    assert.equal(layout.nodes[0].slug, 'unsynced');
    assert.equal(layout.edges.some(edge => edge.from === 'unsynced' || edge.to === 'unsynced'), false);
    assert.equal(layout.offPage.some(item => item.slug === 'unsynced'), false);
});

test('buildTimelineLayout: 枝分かれした列は幹の左(負の列)に置き、記事カードの文字に根が重ならないようにする', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    // newest → oldest の幹が列 0 を占めるため、同じ oldest を引用する middle は分岐する
    const layout = buildTimelineLayout(行, タイムライン記事);
    const middle = layout.nodes.find(node => node.slug === 'middle');
    assert.ok(middle.col < 0, `middle の列は負であるべきですが ${middle.col} でした`);
    const edge = layout.edges.find(item => item.from === 'middle');
    assert.equal(edge.fromCol, middle.col);
});

test('buildTimelineLayout: 行が無ければ空のレイアウトを返す', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    assert.deepEqual(buildTimelineLayout([], タイムライン記事), {bands: [], nodes: [], edges: [], offPage: [], hiatuses: []});
});

/* ------------------------------------------------------------------
 * Hyperstrata の注釈(機械の層)から作る推定エッジ(#12)
 * ------------------------------------------------------------------ */

/** oldest ではなく middle への推定関係を newest に持たせる(人間の引用は oldest のみ) */
const 推定を含むタイムライン記事 = [
    {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: ['oldest'], inferredRefs: [{slug: 'middle', type: 'continues'}, {slug: 'ancient', type: 'revisits'}]},
    {slug: 'middle', title: '中間の記事', url: '/middle/', publishedAt: '2026-01-20T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: [], inferredRefs: []},
    {slug: 'ancient', title: 'ページ外の古い記事', url: '/ancient/', publishedAt: '2025-06-01T12:00:00.000Z', refs: [], inferredRefs: []}
];

test('buildTimelineLayout: 推定エッジ(kind: "inferred")を人間の引用に追加する', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const layout = buildTimelineLayout(行, 推定を含むタイムライン記事);
    const 推定エッジ = layout.edges.filter(edge => edge.kind === 'inferred');
    assert.deepEqual(推定エッジ.map(edge => [edge.from, edge.to]), [['newest', 'middle']]);
    const 人間エッジ = layout.edges.filter(edge => edge.kind === 'human');
    assert.deepEqual(人間エッジ.map(edge => [edge.from, edge.to]), [['newest', 'oldest']]);
});

test('buildTimelineLayout: 表示中に無い記事への推定関係(ancient)は offPage の件数に含めない(人間の引用のみ数える)', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const layout = buildTimelineLayout(行, 推定を含むタイムライン記事);
    // 人間の引用(oldest)のみが表示中にあり、ページ外の引用は無いので offPage は空
    assert.deepEqual(layout.offPage, []);
});

test('buildTimelineLayout: 同じ記事の組を人間の引用と機械の推定が両方指す場合、人間の引用を優先し重複エッジを作らない', () => {
    const {buildTimelineLayout} = タイムラインを読み込む();
    const 重複あり記事 = [
        {slug: 'newest', title: '最新の記事', url: '/newest/', publishedAt: '2026-03-15T12:00:00.000Z', refs: ['oldest'], inferredRefs: [{slug: 'oldest', type: 'continues'}]},
        {slug: 'middle', title: '中間の記事', url: '/middle/', publishedAt: '2026-01-20T12:00:00.000Z', refs: [], inferredRefs: []},
        {slug: 'oldest', title: '最初の記事', url: '/oldest/', publishedAt: '2026-01-15T12:00:00.000Z', refs: [], inferredRefs: []}
    ];
    const layout = buildTimelineLayout(行, 重複あり記事);
    assert.deepEqual(layout.edges.map(edge => [edge.from, edge.to, edge.kind]), [['newest', 'oldest', 'human']]);
});

/* ------------------------------------------------------------------
 * トップページの無限スクロール(次ページの行の追加)
 * ------------------------------------------------------------------ */

/** 無限スクロール用 API を読み込む */
function 無限スクロールを読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataGraph;
    return {
        selectNewTimelineRows: (existing, incoming) => JSON.parse(JSON.stringify(api.selectNewTimelineRows(existing, incoming)))
    };
}

test('selectNewTimelineRows: 次ページの行のうち、表示済みの slug と重複しない行の添字を順に返す', () => {
    const {selectNewTimelineRows} = 無限スクロールを読み込む();
    // 取得の合間に記事が公開されてページ境界がずれると、既に表示した記事が次ページの先頭に再び現れる
    const 添字 = selectNewTimelineRows(['newest', 'middle', 'oldest'], ['oldest', 'ancient', 'prehistoric']);
    assert.deepEqual(添字, [1, 2]);
});

test('selectNewTimelineRows: 次ページ内で同じ slug が重複した場合も 1 件だけ採用する', () => {
    const {selectNewTimelineRows} = 無限スクロールを読み込む();
    assert.deepEqual(selectNewTimelineRows(['newest'], ['ancient', 'ancient']), [0]);
});

test('selectNewTimelineRows: 次ページが空なら空配列を返す', () => {
    const {selectNewTimelineRows} = 無限スクロールを読み込む();
    assert.deepEqual(selectNewTimelineRows(['newest'], []), []);
});

/* ------------------------------------------------------------------
 * タイムラインの軸(列 0)の x 座標
 * ------------------------------------------------------------------ */

test('placeTimelineAxis: 列が 0 だけなら軸はガターの右端(laneRight)に置き、列幅はそのまま', () => {
    const {placeTimelineAxis} = タイムラインを読み込む();
    assert.deepEqual(placeTimelineAxis({minCol: 0, maxCol: 0, laneLeft: 84, laneRight: 140, laneWidth: 16}), {axisX: 140, laneWidth: 16});
});

test('placeTimelineAxis: 負の列(左の枝)があっても軸は動かない(次ページを継ぎ足しても種の位置が跳ねない)', () => {
    const {placeTimelineAxis} = タイムラインを読み込む();
    assert.deepEqual(placeTimelineAxis({minCol: -3, maxCol: 0, laneLeft: 84, laneRight: 140, laneWidth: 16}), {axisX: 140, laneWidth: 16});
});

test('placeTimelineAxis: 正の列(右の枝)がある場合は、右端の列が laneRight に収まるよう軸を左へずらす', () => {
    const {placeTimelineAxis} = タイムラインを読み込む();
    assert.deepEqual(placeTimelineAxis({minCol: 0, maxCol: 2, laneLeft: 84, laneRight: 140, laneWidth: 16}), {axisX: 108, laneWidth: 16});
});

test('placeTimelineAxis: 列が多くて laneLeft〜laneRight に収まらない場合は列幅を縮めて収める', () => {
    const {placeTimelineAxis} = タイムラインを読み込む();
    // 8 列分(-7..0)を 56px に収める → 列幅 8px
    assert.deepEqual(placeTimelineAxis({minCol: -7, maxCol: 0, laneLeft: 84, laneRight: 140, laneWidth: 16}), {axisX: 140, laneWidth: 8});
    // 正負にまたがる場合も同様に縮め、右端の列を laneRight に置く
    assert.deepEqual(placeTimelineAxis({minCol: -6, maxCol: 1, laneLeft: 84, laneRight: 140, laneWidth: 16}), {axisX: 132, laneWidth: 8});
});

/* ------------------------------------------------------------------
 * 長い空白期間を地層の不整合面(hiatus)として扱う(#29)
 * ------------------------------------------------------------------ */

/** 不整合面用 API を読み込む */
function 不整合面を読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataGraph;
    const 正規化 = value => JSON.parse(JSON.stringify(value));
    return {
        buildLayout: (posts, options) => 正規化(api.buildLayout(posts, options)),
        buildPaneLayout: (posts, options) => 正規化(api.buildPaneLayout(posts, options)),
        buildTimelineLayout: (rows, posts, options) => 正規化(api.buildTimelineLayout(rows, posts, options)),
        hiatusBoundaryPath: (y, width, options) => api.hiatusBoundaryPath(y, width, options)
    };
}

/**
 * 実際の graph.json と同じ空白: window-film(2026-04-06)と hyperstrata(2026-09-09)の間が 156 日。
 * first-hunt → window-film は 37 日で、しきい値(60 日)を超えない。
 * 日数を整数にするため時刻は正午に揃える(月ラベルはローカル時刻で判定するため月末・月初も避ける)
 */
const 空白のある記事 = [
    {slug: 'first-hunt', title: '初めての狩猟', url: '/first-hunt/', publishedAt: '2026-02-27T12:00:00.000Z', refs: []},
    {slug: 'window-film', title: '窓フィルム', url: '/window-film/', publishedAt: '2026-04-05T12:00:00.000Z', refs: []},
    {slug: 'hyperstrata', title: 'Hyperstrata', url: '/hyperstrata/', publishedAt: '2026-09-08T12:00:00.000Z', refs: ['window-film']}
];

const 不整合面設定 = {hiatusDays: 60, hiatusGap: 44};

test('buildLayout: しきい値(hiatusDays)を超える空白は hiatusGap の高さに圧縮し、hiatuses に日数と前後の記事を記録する', () => {
    const {buildLayout} = 不整合面を読み込む();
    const layout = buildLayout(空白のある記事, {minGap: 44, pixelsPerDay: 1.5, ...不整合面設定});
    assert.deepEqual(layout.nodes.map(node => node.slug), ['hyperstrata', 'window-film', 'first-hunt']);
    // 156 日 × 1.5px = 234px のところを hiatusGap(44px)に圧縮する
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, 44);
    // しきい値以下の空白(37 日)は従来どおり日数に比例する
    assert.equal(layout.nodes[2].y - layout.nodes[1].y, 37 * 1.5);
    assert.deepEqual(layout.hiatuses, [{y: layout.nodes[0].y + 22, days: 156, newer: 'hyperstrata', older: 'window-film'}]);
});

test('buildLayout: 圧縮したぶんは後続のノードにも引き継がれ、全体の高さ(height)が縮む', () => {
    const {buildLayout} = 不整合面を読み込む();
    const 圧縮なし = buildLayout(空白のある記事, {minGap: 44, pixelsPerDay: 1.5, hiatusDays: 1000, hiatusGap: 44});
    const 圧縮あり = buildLayout(空白のある記事, {minGap: 44, pixelsPerDay: 1.5, ...不整合面設定});
    assert.deepEqual(圧縮なし.hiatuses, []);
    assert.equal(圧縮なし.height - 圧縮あり.height, 234 - 44);
});

test('buildLayout: hiatusDays を省略した場合は不整合面を検出せず、hiatuses は空になる(既存の呼び出しと互換)', () => {
    const {buildLayout} = 不整合面を読み込む();
    const layout = buildLayout(空白のある記事, {minGap: 44, pixelsPerDay: 1.5});
    assert.deepEqual(layout.hiatuses, []);
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, 234);
});

test('buildPaneLayout: しきい値を超える空白の前後の行の間に hiatusGap ぶんの余白を空け、その中央に不整合面を置く', () => {
    const {buildPaneLayout} = 不整合面を読み込む();
    const layout = buildPaneLayout(空白のある記事, {...ペイン設定, ...不整合面設定});
    assert.deepEqual(layout.nodes.map(node => node.slug), ['hyperstrata', 'window-film', 'first-hunt']);
    // 不整合面 → 月の区切り → 行の順に並ぶため、行の間隔は hiatusGap + monthGap + rowHeight になる
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, 不整合面設定.hiatusGap + ペイン設定.monthGap + ペイン設定.rowHeight);
    assert.deepEqual(layout.hiatuses, [{y: layout.nodes[0].y + 不整合面設定.hiatusGap / 2, days: 156, newer: 'hyperstrata', older: 'window-film'}]);
    // 不整合面は月の区切り(2026-04)より上にある
    const 月の区切り = layout.monthMarks.find(mark => mark.label === '2026-04');
    assert.ok(layout.hiatuses[0].y < 月の区切り.y);
    // しきい値以下の空白(37 日)には不整合面を置かず、月の区切りだけになる
    assert.equal(layout.nodes[2].y - layout.nodes[1].y, ペイン設定.monthGap + ペイン設定.rowHeight);
});

test('buildPaneLayout: hiatusDays を省略した場合は不整合面を検出せず、hiatuses は空になる(既存の呼び出しと互換)', () => {
    const {buildPaneLayout} = 不整合面を読み込む();
    const layout = buildPaneLayout(空白のある記事, ペイン設定);
    assert.deepEqual(layout.hiatuses, []);
    assert.equal(layout.nodes[1].y - layout.nodes[0].y, ペイン設定.monthGap + ペイン設定.rowHeight);
});

/** タイムラインの行は DOM の位置で決まるため空白は圧縮せず、隣接する行の境界に不整合面を置く */
const 空白のある行 = [
    {slug: 'hyperstrata', month: '2026-09', publishedAt: '2026-09-08T12:00:00.000Z', top: 0, bottom: 100, y: 40},
    {slug: 'window-film', month: '2026-04', publishedAt: '2026-04-05T12:00:00.000Z', top: 100, bottom: 200, y: 140},
    {slug: 'first-hunt', month: '2026-02', publishedAt: '2026-02-27T12:00:00.000Z', top: 200, bottom: 300, y: 240}
];

test('buildTimelineLayout: しきい値を超える空白は、前後の行の境界(前の行の bottom)に不整合面として記録する', () => {
    const {buildTimelineLayout} = 不整合面を読み込む();
    const layout = buildTimelineLayout(空白のある行, 空白のある記事, {hiatusDays: 60});
    assert.deepEqual(layout.hiatuses, [{y: 100, days: 156, newer: 'hyperstrata', older: 'window-film'}]);
});

test('buildTimelineLayout: 行の公開日は graph.json ではなく行自身の publishedAt(テンプレートの data-published)から読む', () => {
    const {buildTimelineLayout} = 不整合面を読み込む();
    // graph.json に無い(同期前の)行どうしでも空白を判定できる
    const layout = buildTimelineLayout(空白のある行, [], {hiatusDays: 60});
    assert.deepEqual(layout.hiatuses.map(item => [item.newer, item.older, item.days]), [['hyperstrata', 'window-film', 156]]);
});

test('buildTimelineLayout: 行の publishedAt が解釈できない場合は Fail-Fast で例外にする', () => {
    const {buildTimelineLayout} = 不整合面を読み込む();
    const 壊れた行 = [{slug: 'broken', month: '2026-09', publishedAt: 'not-a-date', top: 0, bottom: 100, y: 40}];
    assert.throws(() => buildTimelineLayout(壊れた行, [], {hiatusDays: 60}), /公開日を解釈できません: broken/);
});

test('buildTimelineLayout: hiatusDays を省略した場合は不整合面を検出せず、hiatuses は空になる(既存の呼び出しと互換)', () => {
    const {buildTimelineLayout} = 不整合面を読み込む();
    assert.deepEqual(buildTimelineLayout(空白のある行, 空白のある記事).hiatuses, []);
});

test('hiatusBoundaryPath: 荒い境界線は指定した y から始まり右端(width)まで到達し、振幅は amplitude 以内に収まる', () => {
    const {hiatusBoundaryPath} = 不整合面を読み込む();
    const path = hiatusBoundaryPath(50, 200, {amplitude: 6, step: 12, seed: 1});
    assert.match(path, /^M 0 50 /);
    const 座標 = path.trim().split(/\s+/).filter(token => !Number.isNaN(Number(token))).map(Number);
    assert.equal(座標[座標.length - 2], 200);
    for (let i = 1; i < 座標.length; i += 2) {
        assert.ok(Math.abs(座標[i] - 50) <= 6, `y=${座標[i]} は 50±6 の範囲を超えています`);
    }
});

test('hiatusBoundaryPath: 同じ入力なら常に同じ形になり(決定的)、seed が違えば形が変わる', () => {
    const {hiatusBoundaryPath} = 不整合面を読み込む();
    const 設定 = {amplitude: 6, step: 12, seed: 1};
    assert.equal(hiatusBoundaryPath(50, 200, 設定), hiatusBoundaryPath(50, 200, 設定));
    assert.notEqual(hiatusBoundaryPath(50, 200, 設定), hiatusBoundaryPath(50, 200, {...設定, seed: 2}));
});
