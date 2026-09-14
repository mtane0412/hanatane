/**
 * partials/post-share.hbs(記事末尾の共有導線: X / Bluesky への投稿、タイトルと URL のコピー、AI に渡す Markdown のコピー)と
 * assets/js/post-share.js(HTML → Markdown 変換、graph.json からの関連記事の抽出、AI に渡す文書の組み立て)のテスト。
 *
 * パーシャルは Ghost 本体のヘルパー群が使えないため、素の Handlebars で描画し、
 * Ghost のヘルパー `t` / `asset` / `encode` / `url` をスタブとして登録する(scripts/strata-layers.test.mjs と同じ方式)。
 * JS はブラウザ向けに gulp で連結されるため node:vm で読み込み、window.HanataneShare に公開された純粋関数を検証する。
 * HTML → Markdown 変換は DOM を歩くため、jsdom の window を vm のグローバルに渡す。
 * ボタンのクリック処理(クリップボードへの書き込み)はテスト対象外とする。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Handlebars from 'handlebars';
import {JSDOM} from 'jsdom';

const パーシャル = readFileSync(new URL('../partials/post-share.hbs', import.meta.url), 'utf8');
const スクリプト = readFileSync(new URL('../assets/js/post-share.js', import.meta.url), 'utf8');

const 現在記事 = {
    slug: 'implementation-hyperstrata',
    title: 'Hyperstrataの地層を考える',
    url: '/implementation-hyperstrata/',
    published_at: '2026-09-10T12:24:41.000Z'
};

/**
 * パーシャルを記事コンテキストで描画する。
 *
 * @param {object} [post] 描画する記事(既定は 現在記事)
 * @returns {string} 描画結果
 */
function 描画(post = 現在記事) {
    const hbs = Handlebars.create();
    hbs.registerHelper('t', text => text);
    hbs.registerHelper('asset', path => '/assets/' + path);
    hbs.registerHelper('encode', value => encodeURIComponent(value));
    // Ghost の url ヘルパーは absolute="true" でサイトの origin 付きの URL を返す
    hbs.registerHelper('url', function (options) {
        return options.hash.absolute ? 'https://hanatane.net' + this.url : this.url;
    });
    ['x', 'bluesky'].forEach(function (name) {
        hbs.registerPartial('icons/' + name, readFileSync(new URL(`../partials/icons/${name}.hbs`, import.meta.url), 'utf8'));
    });
    return hbs.compile(パーシャル)(post);
}

/**
 * assets/js/post-share.js を jsdom の window 付きで読み込み、window.HanataneShare を返す。
 *
 * @returns {{htmlToMarkdown: Function, collectRelated: Function, buildDocument: Function, buildCopyText: Function, extractPost: Function, window: object}}
 */
function 読み込み() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const {window} = dom;
    const context = vm.createContext({
        window,
        document: window.document,
        DOMParser: window.DOMParser,
        Node: window.Node,
        console
    });
    vm.runInContext(スクリプト, context);
    return Object.assign({window}, window.HanataneShare);
}

/**
 * vm の別レルムで作られた配列・オブジェクトを、assert.deepEqual で比べられる素の値にする。
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function 素(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * HTML 断片を要素にして htmlToMarkdown に渡す。
 *
 * @param {string} html
 * @returns {string}
 */
function 変換(html) {
    const api = 読み込み();
    const root = api.window.document.createElement('div');
    root.innerHTML = html;
    return api.htmlToMarkdown(root);
}

// ---------------------------------------------------------------------------
// パーシャル
// ---------------------------------------------------------------------------

test('X と Bluesky への投稿リンクは、タイトルと絶対 URL を URL エンコードして intent に渡し、別タブで開く', () => {
    const html = 描画();
    const title = encodeURIComponent('Hyperstrataの地層を考える');
    const url = encodeURIComponent('https://hanatane.net/implementation-hyperstrata/');
    assert.ok(html.includes(`href="https://x.com/intent/post?text=${title}&amp;url=${url}"`), html);
    assert.ok(html.includes(`href="https://bsky.app/intent/compose?text=${title}%0A${url}"`), html);
    const links = html.match(/<a [^>]*class="gh-post-share-button"[^>]*>/g);
    assert.equal(links.length, 2, html);
    links.forEach(function (link) {
        assert.ok(link.includes('target="_blank"'), link);
        assert.ok(link.includes('rel="noopener noreferrer"'), link);
    });
});

test('コピーと AI のボタンには、JS が使うタイトル・絶対 URL・slug・公開日時・graph.json の URL を data 属性で渡す', () => {
    const html = 描画();
    assert.ok(html.includes('data-post-share'), html);
    assert.ok(html.includes('data-title="Hyperstrataの地層を考える"'), html);
    assert.ok(html.includes('data-url="https://hanatane.net/implementation-hyperstrata/"'), html);
    assert.ok(html.includes('data-current-slug="implementation-hyperstrata"'), html);
    assert.ok(html.includes('data-published="2026-09-10T12:24:41.000Z"'), html);
    assert.ok(html.includes('data-strata-graph-url="/assets/graph.json"'), html);
    assert.ok(/<button[^>]*data-share-copy[^>]*>/.test(html), html);
    assert.ok(/<button[^>]*data-share-ai-toggle[^>]*aria-expanded="false"/.test(html), html);
});

test('AI に渡す選択肢(この記事だけ / 関連記事も含める)は初期状態では hidden で、JS が開くまで見えない', () => {
    const html = 描画();
    assert.ok(/<div[^>]*data-share-ai-options[^>]*hidden/.test(html), html);
    assert.ok(/<button[^>]*data-share-ai="single"/.test(html), html);
    assert.ok(/<button[^>]*data-share-ai="related"/.test(html), html);
    assert.ok(html.includes('data-label-copied="Copied"'), html);
    assert.ok(html.includes('data-label-failed="Copy failed"'), html);
    assert.ok(html.includes('data-label-related="This post and % related posts"'), html);
});

// ---------------------------------------------------------------------------
// buildCopyText
// ---------------------------------------------------------------------------

test('buildCopyText はタイトルと URL を改行で並べる', () => {
    const {buildCopyText} = 読み込み();
    assert.equal(
        buildCopyText('Hyperstrataの地層を考える', 'https://hanatane.net/implementation-hyperstrata/'),
        'Hyperstrataの地層を考える\nhttps://hanatane.net/implementation-hyperstrata/'
    );
});

// ---------------------------------------------------------------------------
// htmlToMarkdown
// ---------------------------------------------------------------------------

test('見出し・段落・強調・リンク・インラインコードを Markdown にする', () => {
    const md = 変換(`
        <h2 id="a">地層とは</h2>
        <p>記事は<strong>不変</strong>で、<em>上に</em>積む。<a href="https://hanatane.net/hyperstrata/">前の記事</a>と<code>graph.json</code>。</p>
        <h3>小見出し</h3>
        <p>二つ目の段落。</p>
    `);
    assert.equal(md, [
        '## 地層とは',
        '',
        '記事は**不変**で、*上に*積む。[前の記事](https://hanatane.net/hyperstrata/)と`graph.json`。',
        '',
        '### 小見出し',
        '',
        '二つ目の段落。'
    ].join('\n'));
});

test('段落内の改行(br)は行末の 2 スペース付きの改行にし、段落間はソースの改行やインデントに影響されない', () => {
    const md = 変換('<p>一行目<br>二行目</p>\n\n\n   <p>次の段落</p>');
    assert.equal(md, '一行目  \n二行目\n\n次の段落');
});

test('箇条書きと番号付きリストを入れ子も含めて Markdown にする', () => {
    const md = 変換(`
        <ul>
            <li>猫</li>
            <li>犬
                <ul><li>柴犬</li></ul>
            </li>
        </ul>
        <ol>
            <li>起きる</li>
            <li>寝る</li>
        </ol>
    `);
    assert.equal(md, [
        '- 猫',
        '- 犬',
        '  - 柴犬',
        '',
        '1. 起きる',
        '2. 寝る'
    ].join('\n'));
});

test('引用・水平線・コードブロック(言語付き)を Markdown にする', () => {
    const md = 変換(`
        <blockquote><p>もう少し遠くを見た生活の組み立て方</p></blockquote>
        <hr>
        <figure class="kg-card kg-code-card"><pre><code class="language-js">const a = 1;
console.log(a);</code></pre><figcaption>例</figcaption></figure>
    `);
    assert.equal(md, [
        '> もう少し遠くを見た生活の組み立て方',
        '',
        '---',
        '',
        '```js',
        'const a = 1;',
        'console.log(a);',
        '```',
        '',
        '例'
    ].join('\n'));
});

test('画像カードは alt とキャプション付きの画像記法にする', () => {
    const md = 変換(`
        <figure class="kg-card kg-image-card kg-card-hascaption">
            <img src="https://hanatane.net/content/images/cat.jpg" alt="縁側の猫" width="800" height="600">
            <figcaption><span>窓辺で寝る猫</span></figcaption>
        </figure>
    `);
    assert.equal(md, '![縁側の猫](https://hanatane.net/content/images/cat.jpg)\n\n窓辺で寝る猫');
});

test('ブックマークカードはタイトルと説明をリンクにする', () => {
    const md = 変換(`
        <figure class="kg-card kg-bookmark-card">
            <a class="kg-bookmark-container" href="https://example.com/article">
                <div class="kg-bookmark-content">
                    <div class="kg-bookmark-title">縄文土器の企画展</div>
                    <div class="kg-bookmark-description">大船渡市立博物館の企画展の案内</div>
                    <div class="kg-bookmark-metadata"><span class="kg-bookmark-publisher">example.com</span></div>
                </div>
                <div class="kg-bookmark-thumbnail"><img src="https://example.com/thumb.jpg" alt=""></div>
            </a>
        </figure>
    `);
    assert.equal(md, '[縄文土器の企画展](https://example.com/article)\n大船渡市立博物館の企画展の案内');
});

test('埋め込みカード(iframe)は src へのリンクにし、キャプションを添える', () => {
    const md = 変換(`
        <figure class="kg-card kg-embed-card kg-card-hascaption">
            <iframe src="https://www.youtube.com/embed/abc123" title="動画"></iframe>
            <figcaption>三内丸山遺跡の動画</figcaption>
        </figure>
    `);
    assert.equal(md, '[https://www.youtube.com/embed/abc123](https://www.youtube.com/embed/abc123)\n\n三内丸山遺跡の動画');
});

test('コールアウトとトグルは本文のテキストを残し、サインアップカードは出さない', () => {
    const md = 変換(`
        <div class="kg-card kg-callout-card kg-callout-card-blue">
            <div class="kg-callout-emoji">💡</div>
            <div class="kg-callout-text">この記事は<a href="https://hanatane.net/">連載</a>の一部です。</div>
        </div>
        <div class="kg-card kg-toggle-card" data-kg-toggle-state="close">
            <div class="kg-toggle-heading"><div class="kg-toggle-heading-text">補足</div></div>
            <div class="kg-toggle-content"><p>折りたたみの中身</p></div>
        </div>
        <div class="kg-card kg-signup-card"><h2>購読する</h2><form><input type="email"></form></div>
    `);
    assert.equal(md, [
        '> 💡 この記事は[連載](https://hanatane.net/)の一部です。',
        '',
        '**補足**',
        '',
        '折りたたみの中身'
    ].join('\n'));
});

test('表は Markdown のパイプ表にする', () => {
    const md = 変換(`
        <table>
            <thead><tr><th>項目</th><th>費用</th></tr></thead>
            <tbody><tr><td>保存</td><td>1 億円</td></tr><tr><td>改修</td><td>3 億円</td></tr></tbody>
        </table>
    `);
    assert.equal(md, [
        '| 項目 | 費用 |',
        '| --- | --- |',
        '| 保存 | 1 億円 |',
        '| 改修 | 3 億円 |'
    ].join('\n'));
});

// ---------------------------------------------------------------------------
// collectRelated
// ---------------------------------------------------------------------------

const グラフ = [
    {slug: 'window-film', title: '縁側の窓に目隠しシートを貼った', url: 'https://hanatane.net/window-film/', publishedAt: '2026-04-06T12:54:38.000Z', refs: [], inferredRefs: []},
    {slug: 'hyperstrata', title: 'immutableなノートを堆積する', url: 'https://hanatane.net/hyperstrata/', publishedAt: '2026-09-09T11:00:41.000Z', refs: [], inferredRefs: []},
    {
        slug: 'implementation-hyperstrata',
        title: 'Hyperstrataの地層を考える',
        url: 'https://hanatane.net/implementation-hyperstrata/',
        publishedAt: '2026-09-10T12:24:41.000Z',
        refs: ['hyperstrata'],
        inferredRefs: [{slug: 'window-film', type: 'revisits', reason: '窓の話を地層の例として見直している。'}]
    },
    {
        slug: 'writing-focus',
        title: '「書くことに集中する」を作る',
        url: 'https://hanatane.net/writing-focus/',
        publishedAt: '2026-09-12T02:00:00.000Z',
        refs: ['implementation-hyperstrata'],
        inferredRefs: [{slug: 'implementation-hyperstrata', type: 'continues', reason: '地層の実装の続きとして書いている。'}]
    },
    {slug: 'unrelated', title: '関係のない記事', url: 'https://hanatane.net/unrelated/', publishedAt: '2026-09-13T00:00:00.000Z', refs: [], inferredRefs: []}
];

test('collectRelated は引用(refs)と注釈(inferredRefs)の双方向の関係を集め、同じ記事は 1 件に統合して公開日順に並べる', () => {
    const {collectRelated} = 読み込み();
    const related = 素(collectRelated(グラフ, 'implementation-hyperstrata'));
    assert.deepEqual(related.map(post => post.slug), ['window-film', 'hyperstrata', 'writing-focus']);
    assert.deepEqual(related[0].relations, [{type: 'revisits', reason: '窓の話を地層の例として見直している。'}]);
    assert.deepEqual(related[1].relations, [{type: 'cites', reason: null}]);
    assert.deepEqual(related[2].relations, [
        {type: 'cited-by', reason: null},
        {type: 'continued-by', reason: '地層の実装の続きとして書いている。'}
    ]);
    assert.equal(related[2].title, '「書くことに集中する」を作る');
    assert.equal(related[2].url, 'https://hanatane.net/writing-focus/');
    assert.equal(related[2].publishedAt, '2026-09-12T02:00:00.000Z');
});

test('collectRelated は現在記事が graph.json に無ければ空配列を返し、posts が配列でなければ例外を投げる', () => {
    const {collectRelated} = 読み込み();
    assert.deepEqual(素(collectRelated(グラフ, 'not-in-graph')), []);
    assert.throws(() => collectRelated(null, 'hyperstrata'), /配列/);
});

// ---------------------------------------------------------------------------
// extractPost
// ---------------------------------------------------------------------------

test('extractPost は取得した記事ページの HTML からタイトルと本文の Markdown を取り出す', () => {
    const {extractPost} = 読み込み();
    const html = `<!doctype html><html><body>
        <main><article>
            <header><h1 class="gh-article-title is-title">immutableなノートを堆積する</h1></header>
            <section class="gh-content gh-canvas is-body"><p>ノートは<strong>消さない</strong>。</p><h2>理由</h2><p>積むため。</p></section>
        </article></main>
    </body></html>`;
    assert.deepEqual(素(extractPost(html)), {
        title: 'immutableなノートを堆積する',
        markdown: 'ノートは**消さない**。\n\n## 理由\n\n積むため。'
    });
});

test('extractPost は本文(.gh-content)が無い HTML には例外を投げる', () => {
    const {extractPost} = 読み込み();
    assert.throws(() => extractPost('<html><body><p>not a post</p></body></html>'), /gh-content/);
});

// ---------------------------------------------------------------------------
// buildDocument
// ---------------------------------------------------------------------------

test('buildDocument はこの記事だけの場合、見出し・URL・公開日・本文を並べる', () => {
    const {buildDocument} = 読み込み();
    const doc = buildDocument({
        title: 'Hyperstrataの地層を考える',
        url: 'https://hanatane.net/implementation-hyperstrata/',
        publishedAt: '2026-09-10T12:24:41.000Z',
        markdown: '## 地層とは\n\n記事は積む。'
    }, []);
    assert.equal(doc, [
        '# Hyperstrataの地層を考える',
        '',
        '- URL: https://hanatane.net/implementation-hyperstrata/',
        '- Published: 2026-09-10',
        '',
        '## 地層とは',
        '',
        '記事は積む。'
    ].join('\n'));
});

test('buildDocument は関連記事を区切り線の後に、関係の種類と理由を添えて並べる', () => {
    const {buildDocument} = 読み込み();
    const doc = buildDocument({
        title: 'Hyperstrataの地層を考える',
        url: 'https://hanatane.net/implementation-hyperstrata/',
        publishedAt: '2026-09-10T12:24:41.000Z',
        markdown: '本文'
    }, [
        {
            title: 'immutableなノートを堆積する',
            url: 'https://hanatane.net/hyperstrata/',
            publishedAt: '2026-09-09T11:00:41.000Z',
            relations: [{type: 'cites', reason: null}],
            markdown: '前の本文'
        },
        {
            title: '「書くことに集中する」を作る',
            url: 'https://hanatane.net/writing-focus/',
            publishedAt: '2026-09-12T02:00:00.000Z',
            relations: [{type: 'cited-by', reason: null}, {type: 'continued-by', reason: '地層の実装の続きとして書いている。'}],
            markdown: '後の本文'
        }
    ]);
    assert.equal(doc, [
        '# Hyperstrataの地層を考える',
        '',
        '- URL: https://hanatane.net/implementation-hyperstrata/',
        '- Published: 2026-09-10',
        '',
        '本文',
        '',
        '---',
        '',
        '# Related post: immutableなノートを堆積する',
        '',
        '- URL: https://hanatane.net/hyperstrata/',
        '- Published: 2026-09-09',
        '- Relation: cited by the main post',
        '',
        '前の本文',
        '',
        '---',
        '',
        '# Related post: 「書くことに集中する」を作る',
        '',
        '- URL: https://hanatane.net/writing-focus/',
        '- Published: 2026-09-12',
        '- Relation: cites the main post; continues the main post (地層の実装の続きとして書いている。)',
        '',
        '後の本文'
    ].join('\n'));
});
