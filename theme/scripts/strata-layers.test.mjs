/**
 * partials/strata-layers.hbs(記事ページの本文下: 上の層・下の層に束ねた他記事へのリンク)と
 * assets/js/strata-layers.js(注釈の追加・重複の統合・経過日数・並べ替え)のテスト(#42)。
 *
 * パーシャルは Ghost 本体のヘルパー群が使えないため、素の Handlebars で描画し、
 * Ghost のヘルパー `next_post` / `prev_post` / `get` / `foreach` / `match` / `t` / `date` / `asset` を
 * スタブとして登録する(scripts/head-title.test.mjs と同じ方式)。
 * JS はブラウザ向けに gulp で連結されるため node:vm で読み込み、window.HyperstrataLayers に
 * 公開された純粋関数を検証する。DOM 操作(描画)はテスト対象外とする。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Handlebars from 'handlebars';

const パーシャル = readFileSync(new URL('../partials/strata-layers.hbs', import.meta.url), 'utf8');
const スクリプト = readFileSync(new URL('../assets/js/strata-layers.js', import.meta.url), 'utf8');

const 現在記事 = {
    slug: 'implementation-hyperstrata',
    title: 'Hyperstrataの地層を考える',
    published_at: '2026-09-10T12:24:41.000Z',
    tags: [
        {slug: 'hash-ref-hyperstrata', description: 'hyperstrata'},
        {slug: 'tech', description: ''}
    ]
};
const 上の記事 = {slug: 'writing-focus', title: '「書くことに集中する」を作る', url: '/writing-focus/', published_at: '2026-09-12T02:00:00.000Z'};
const 下の記事 = {slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: '/hyperstrata/', published_at: '2026-09-09T11:00:41.000Z'};
const 引用元の記事 = {slug: 'window-film', title: '縁側の窓に目隠しシートを貼った(猫のストレス対策)', url: '/window-film/', published_at: '2026-04-06T12:54:38.000Z'};

/**
 * パーシャルを記事コンテキストで描画する。
 *
 * @param {object} 引数
 * @param {object|null} 引数.next - next_post ヘルパーが返す新しい記事(無ければ null)
 * @param {object|null} 引数.prev - prev_post ヘルパーが返す古い記事(無ければ null)
 * @param {Array<object>} 引数.citing - get ヘルパーが「現在記事を引用している記事」として返す記事
 * @param {Array<object>} 引数.referenced - get ヘルパーが「引用タグの slug に一致する記事」として返す記事
 * @param {object} [引数.post] - 描画する記事(既定は 現在記事)
 * @returns {string} 描画結果
 */
function 描画({next = null, prev = null, citing = [], referenced = [], post = 現在記事}) {
    const hbs = Handlebars.create();
    hbs.registerHelper('t', text => text);
    hbs.registerHelper('asset', path => '/assets/' + path);
    hbs.registerHelper('date', function () {
        return this.published_at.slice(0, 10);
    });
    hbs.registerHelper('next_post', function (options) {
        return next ? options.fn(next) : options.inverse(this);
    });
    hbs.registerHelper('prev_post', function (options) {
        return prev ? options.fn(prev) : options.inverse(this);
    });
    hbs.registerHelper('foreach', function (items, options) {
        return (items || []).map(item => options.fn(item)).join('');
    });
    hbs.registerHelper('match', function (value, operator, expected, options) {
        assert.equal(operator, '~^');
        return String(value).startsWith(expected) ? options.fn(this) : options.inverse(this);
    });
    hbs.registerHelper('get', function (resource, options) {
        assert.equal(resource, 'posts');
        // Ghost の get ヘルパーは filter 内の {{slug}} 等を現在の文脈で展開する。スタブでも同じ展開をする
        const filter = options.hash.filter.replace(/\{\{(\w+)\}\}/g, (_, key) => this[key]);
        let posts;
        if (filter.startsWith('tags:hash-ref-')) {
            assert.equal(filter, `tags:hash-ref-${post.slug}`);
            posts = citing;
        } else {
            const slug = filter.match(/^slug:'([^']+)'$/)[1];
            posts = referenced.filter(candidate => candidate.slug === slug);
        }
        return options.fn(this, {blockParams: [posts]});
    });
    return hbs.compile(パーシャル)(post);
}

/**
 * 描画結果からグループごとの <li> の HTML を取り出す。
 *
 * @param {string} html
 * @param {'above'|'below'} group
 * @returns {string[]}
 */
function グループの項目(html, group) {
    const start = html.indexOf(`data-strata-layers-group="${group}"`);
    assert.ok(start >= 0, html);
    const end = html.indexOf('</div>', start);
    return html.slice(start, end).split('<li').slice(1).map(item => '<li' + item);
}

test('新しい記事を「上の層」、古い記事を「下の層」に、直上・直下のバッジ付きで出し、上の層を先に置く', () => {
    const html = 描画({next: 上の記事, prev: 下の記事});
    const 上 = html.indexOf('Layers above');
    const 下 = html.indexOf('Layers below');
    assert.ok(上 >= 0 && 下 >= 0 && 上 < 下, html);
    const [上の項目] = グループの項目(html, 'above');
    assert.ok(上の項目.includes('data-slug="writing-focus"'), 上の項目);
    assert.ok(上の項目.includes('href="/writing-focus/"'), 上の項目);
    assert.ok(上の項目.includes('「書くことに集中する」を作る'), 上の項目);
    assert.ok(上の項目.includes('<time datetime="2026-09-12T02:00:00.000Z"'), 上の項目);
    assert.ok(上の項目.includes('data-strata-badge="adjacent"'), 上の項目);
    assert.ok(上の項目.includes('Directly above'), 上の項目);
    const [下の項目] = グループの項目(html, 'below');
    assert.ok(下の項目.includes('data-slug="hyperstrata"'), 下の項目);
    assert.ok(下の項目.includes('Directly below'), 下の項目);
});

test('引用タグ(#ref-<slug>)の記事を「下の層」に Cited バッジで、現在記事を引用する記事を「上の層」に Cites this バッジで出す', () => {
    const html = 描画({referenced: [下の記事, 引用元の記事], citing: [上の記事]});
    const 下 = グループの項目(html, 'below');
    assert.equal(下.length, 1, html);
    assert.ok(下[0].includes('data-slug="hyperstrata"'), 下[0]);
    assert.ok(下[0].includes('data-strata-badge="cites"'), 下[0]);
    assert.ok(下[0].includes('>Cited<'), 下[0]);
    const 上 = グループの項目(html, 'above');
    assert.equal(上.length, 1, html);
    assert.ok(上[0].includes('data-slug="writing-focus"'), 上[0]);
    assert.ok(上[0].includes('data-strata-badge="cited-by"'), 上[0]);
    assert.ok(上[0].includes('>Cites this<'), 上[0]);
});

test('直下の記事が引用先でもある場合、JS 無しでは 2 行になる(JS が data-slug で 1 行に統合する)', () => {
    const html = 描画({prev: 下の記事, referenced: [下の記事]});
    const 下 = グループの項目(html, 'below');
    assert.equal(下.length, 2, html);
    assert.ok(下.every(item => item.includes('data-slug="hyperstrata"')), html);
});

test('発掘記録(details)はリンク群より前に hidden で置き、JS が要約を入れてから表示する', () => {
    const html = 描画({next: 上の記事});
    const 記録 = html.indexOf('data-strata-record');
    const 上 = html.indexOf('data-strata-layers-group="above"');
    assert.ok(記録 >= 0 && 記録 < 上, html);
    assert.ok(/<details[^>]*data-strata-record[^>]*hidden/.test(html), html);
    assert.ok(html.includes('Excavation record'), html);
    assert.ok(html.includes('data-label-annotator="Excavated by"'), html);
});

test('JS が使う現在記事の slug・公開日時・graph.json の URL・ラベルを data 属性で渡す', () => {
    const html = 描画({});
    assert.ok(html.includes('data-strata-layers'), html);
    assert.ok(html.includes('data-current-slug="implementation-hyperstrata"'), html);
    assert.ok(html.includes('data-current-published="2026-09-10T12:24:41.000Z"'), html);
    assert.ok(html.includes('data-strata-graph-url="/assets/graph.json"'), html);
    assert.ok(html.includes('data-label-later="% days later"'), html);
    assert.ok(html.includes('data-label-earlier="% days earlier"'), html);
    assert.ok(html.includes('data-label-one-later="1 day later"'), html);
    assert.ok(html.includes('data-label-one-earlier="1 day earlier"'), html);
    assert.ok(html.includes('data-label-continues="Continues"'), html);
    assert.ok(html.includes('data-label-revisits="Revisits"'), html);
    assert.ok(html.includes('data-label-updates="Updates"'), html);
});

test('前後の記事も引用も無ければ <li> を 1 つも出さない(セクションは CSS の :has で隠す)', () => {
    const html = 描画({});
    assert.ok(html.includes('gh-strata-layers'), html);
    assert.ok(!html.includes('<li'), html);
});

test('タイトルに含まれる HTML 特殊文字はエスケープする', () => {
    const html = 描画({next: {...上の記事, title: 'A & B <C>'}});
    assert.ok(html.includes('A &amp; B &lt;C&gt;'), html);
});

/**
 * strata-layers.js をブラウザ環境なし(document 未定義)で評価し、公開 API を取り出す。
 * vm の別レルムで生成されたオブジェクトは assert.deepEqual(strict) でプロトタイプ不一致になるため、
 * buildLayersView の戻り値は JSON を経由してテスト側レルムの値に正規化する。
 */
function 読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataLayers;
    return {
        buildLayersView: (...args) => JSON.parse(JSON.stringify(api.buildLayersView(...args))),
        formatGap: api.formatGap
    };
}

const 記事一覧 = [
    {
        slug: 'writing-focus',
        title: '「書くことに集中する」を作る',
        url: '/writing-focus/',
        publishedAt: '2026-09-12T02:00:00.000Z',
        refs: ['implementation-hyperstrata'],
        inferredRefs: [{slug: 'implementation-hyperstrata', type: 'continues', reason: '前回明確になった分業を仕組みとして実装した続報である。'}],
        summary: null
    },
    {
        slug: 'implementation-hyperstrata',
        title: 'Hyperstrataの地層を考える',
        url: '/implementation-hyperstrata/',
        publishedAt: '2026-09-10T12:24:41.000Z',
        refs: ['hyperstrata'],
        inferredRefs: [
            {slug: 'hyperstrata', type: 'continues', reason: '前回取り込んだ Hyperstrata の実装について続報として説明している。'},
            {slug: 'went-to-special-exhibition', type: 'revisits', reason: '企画展で見た土器の話題に別の経験から戻っている。'}
        ],
        summary: '地層のメタファーを素直に実装した考えを述べた記事の要約。',
        annotator: 'claude-sonnet-5',
        annotatedAt: '2026-09-10T13:00:00Z'
    },
    {
        slug: 'hyperstrata',
        title: 'immutableなノートを堆積する',
        url: '/hyperstrata/',
        publishedAt: '2026-09-09T11:00:41.000Z',
        refs: [],
        inferredRefs: [],
        summary: null
    },
    {
        slug: 'went-to-special-exhibition',
        title: '「大船渡市の縄文土器ほぼ全部展」に行ってきた',
        url: '/went-to-special-exhibition/',
        publishedAt: '2026-05-01T00:00:00.000Z',
        refs: [],
        inferredRefs: [],
        summary: null
    }
];

/** サーバー(パーシャル)が描画した項目を DOM から読み取った形 */
const サーバー項目 = {
    above: [
        {slug: 'writing-focus', title: '「書くことに集中する」を作る', url: '/writing-focus/', publishedAt: '2026-09-12T02:00:00.000Z', badges: ['adjacent']},
        {slug: 'writing-focus', title: '「書くことに集中する」を作る', url: '/writing-focus/', publishedAt: '2026-09-12T02:00:00.000Z', badges: ['cited-by']}
    ],
    below: [
        {slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: '/hyperstrata/', publishedAt: '2026-09-09T11:00:41.000Z', badges: ['adjacent']},
        {slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: '/hyperstrata/', publishedAt: '2026-09-09T11:00:41.000Z', badges: ['cites']}
    ]
};

test('buildLayersView: 同じ slug のサーバー項目を 1 行に統合し、バッジを 直上直下 → 引用 → 注釈 の順に束ねる', () => {
    const {buildLayersView} = 読み込む();
    const view = buildLayersView([], 'implementation-hyperstrata', サーバー項目);
    assert.deepEqual(view, {
        record: null,
        above: [{slug: 'writing-focus', title: '「書くことに集中する」を作る', url: '/writing-focus/', publishedAt: '2026-09-12T02:00:00.000Z', badges: ['adjacent', 'cited-by'], reason: null}],
        below: [{slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: '/hyperstrata/', publishedAt: '2026-09-09T11:00:41.000Z', badges: ['adjacent', 'cites'], reason: null}]
    });
});

test('buildLayersView: 注釈の関係先を下の層に、現在記事を関係先に持つ後の記事を上の層に、種類のバッジと理由付きで足す(既存の行には統合する)', () => {
    const {buildLayersView} = 読み込む();
    const view = buildLayersView(記事一覧, 'implementation-hyperstrata', サーバー項目);
    assert.deepEqual(view.above, [
        {slug: 'writing-focus', title: '「書くことに集中する」を作る', url: '/writing-focus/', publishedAt: '2026-09-12T02:00:00.000Z', badges: ['adjacent', 'cited-by', 'continues'], reason: '前回明確になった分業を仕組みとして実装した続報である。'}
    ]);
    assert.deepEqual(view.below, [
        {slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: '/hyperstrata/', publishedAt: '2026-09-09T11:00:41.000Z', badges: ['adjacent', 'cites', 'continues'], reason: '前回取り込んだ Hyperstrata の実装について続報として説明している。'},
        {slug: 'went-to-special-exhibition', title: '「大船渡市の縄文土器ほぼ全部展」に行ってきた', url: '/went-to-special-exhibition/', publishedAt: '2026-05-01T00:00:00.000Z', badges: ['revisits'], reason: '企画展で見た土器の話題に別の経験から戻っている。'}
    ]);
});

test('buildLayersView: 上の層は公開日の昇順(現在記事に近い順)、下の層は降順(現在記事に近い順)に並べる', () => {
    const {buildLayersView} = 読み込む();
    const 項目 = {
        above: [
            {slug: 'far', title: '遠い後の記事', url: '/far/', publishedAt: '2026-12-01T00:00:00.000Z', badges: ['cited-by']},
            {slug: 'near', title: '近い後の記事', url: '/near/', publishedAt: '2026-09-11T00:00:00.000Z', badges: ['cited-by']}
        ],
        below: [
            {slug: 'old', title: '遠い前の記事', url: '/old/', publishedAt: '2026-01-01T00:00:00.000Z', badges: ['cites']},
            {slug: 'recent', title: '近い前の記事', url: '/recent/', publishedAt: '2026-09-01T00:00:00.000Z', badges: ['cites']}
        ]
    };
    const view = buildLayersView([], 'implementation-hyperstrata', 項目);
    assert.deepEqual(view.above.map(item => item.slug), ['near', 'far']);
    assert.deepEqual(view.below.map(item => item.slug), ['recent', 'old']);
});

test('buildLayersView: 現在記事に summary があれば発掘記録(record)として要約・発掘者・発掘日を返し、無ければ null にする', () => {
    const {buildLayersView} = 読み込む();
    assert.deepEqual(buildLayersView(記事一覧, 'implementation-hyperstrata', {above: [], below: []}).record, {
        summary: '地層のメタファーを素直に実装した考えを述べた記事の要約。',
        annotator: 'claude-sonnet-5',
        annotatedAt: '2026-09-10T13:00:00Z'
    });
    assert.equal(buildLayersView(記事一覧, 'hyperstrata', {above: [], below: []}).record, null);
});

test('buildLayersView: reason が無い関係(posts/strata/private/ 由来)は reason: null で足す', () => {
    const {buildLayersView} = 読み込む();
    const posts = 記事一覧.map(post => (post.slug === 'implementation-hyperstrata'
        ? {...post, inferredRefs: [{slug: 'hyperstrata', type: 'continues', reason: null}]}
        : post));
    const view = buildLayersView(posts, 'implementation-hyperstrata', {above: [], below: []});
    assert.deepEqual(view.below, [
        {slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: '/hyperstrata/', publishedAt: '2026-09-09T11:00:41.000Z', badges: ['continues'], reason: null}
    ]);
});

test('buildLayersView: 関係先 slug が posts に無い関係は無視し、currentSlug が posts に無ければサーバー項目だけを返す', () => {
    const {buildLayersView} = 読み込む();
    const posts = [{slug: 'a', title: 'A', url: '/a/', publishedAt: '2026-01-01T00:00:00.000Z', refs: [], inferredRefs: [{slug: 'missing', type: 'continues', reason: null}], summary: null}];
    assert.deepEqual(buildLayersView(posts, 'a', {above: [], below: []}), {record: null, above: [], below: []});
    const view = buildLayersView(記事一覧, 'not-found', サーバー項目);
    assert.equal(view.record, null);
    assert.deepEqual(view.above.map(item => item.slug), ['writing-focus']);
});

test('buildLayersView: posts が配列でない場合は例外を投げる', () => {
    const {buildLayersView} = 読み込む();
    assert.throws(() => buildLayersView(null, 'a', {above: [], below: []}), /posts/);
});

const ラベル = {later: '% days later', earlier: '% days earlier', oneLater: '1 day later', oneEarlier: '1 day earlier'};

test('formatGap は現在記事と相手の公開日時から経過日数の文言を作り、1 日のときは単数形を使う', () => {
    const {formatGap} = 読み込む();
    assert.equal(formatGap('2026-09-10T12:24:41.000Z', '2026-09-12T02:00:00.000Z', ラベル), '2 days later');
    assert.equal(formatGap('2026-09-10T12:24:41.000Z', '2026-09-09T11:00:41.000Z', ラベル), '1 day earlier');
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', '2026-09-10T02:00:00.000Z', ラベル), '1 day later');
    assert.equal(formatGap('2026-09-10T12:24:41.000Z', '2026-04-06T12:54:38.000Z', ラベル), '157 days earlier');
});

test('formatGap は同じ日の記事でも 0 日として文言を返し、日時が解釈できなければ null を返す', () => {
    const {formatGap} = 読み込む();
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', '2026-09-09T12:00:00.000Z', ラベル), '0 days later');
    assert.equal(formatGap('', '2026-09-10T02:00:00.000Z', ラベル), null);
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', 'not-a-date', ラベル), null);
});
