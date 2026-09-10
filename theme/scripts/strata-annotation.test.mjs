/**
 * assets/js/strata-annotation.js の純粋関数(表示データの組み立て)に対するテスト。
 *
 * テーマの JS は gulp で連結されるブラウザ向けスクリプトのため、ESM として import できない。
 * そのため node:vm で読み込み、window.HyperstrataAnnotation に公開された関数を検証する
 * (scripts/strata-graph.test.mjs と同じ方式)。DOM 操作(描画)はテスト対象外とする。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const スクリプト = readFileSync(new URL('../assets/js/strata-annotation.js', import.meta.url), 'utf8');

/**
 * strata-annotation.js をブラウザ環境なし(document 未定義)で評価し、公開 API を取り出す。
 * vm の別レルムで生成されたオブジェクトは assert.deepEqual(strict) でプロトタイプ不一致になるため、
 * buildAnnotationView の戻り値は JSON を経由してテスト側レルムの値に正規化する
 * (scripts/strata-graph.test.mjs の 読み込む と同じ方式)。
 */
function 読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    const api = window.HyperstrataAnnotation;
    return {
        buildAnnotationView: (posts, currentSlug) => JSON.parse(JSON.stringify(api.buildAnnotationView(posts, currentSlug)))
    };
}

const 記事一覧 = [
    {
        slug: 'hyperstrata',
        title: 'immutableなノートを堆積する',
        url: 'https://hanatane.net/hyperstrata/',
        publishedAt: '2026-09-09T11:00:41.000Z',
        refs: ['window-film'],
        inferredRefs: [{slug: 'window-film', type: 'continues', reason: '前回の記事として明言しているため。'}],
        summary: 'Hyperstrata を Ghost に実装した記事の要約。'
    },
    {
        slug: 'window-film',
        title: '縁側の窓に目隠しシートを貼った(猫のストレス対策)',
        url: 'https://hanatane.net/window-film/',
        publishedAt: '2026-04-06T12:54:38.000Z',
        refs: [],
        inferredRefs: [{slug: 'welcome-cat', type: 'continues', reason: null}],
        summary: null
    },
    {
        slug: 'welcome-cat',
        title: '猫を迎えた',
        url: 'https://hanatane.net/welcome-cat/',
        publishedAt: '2026-01-01T00:00:00.000Z',
        refs: [],
        inferredRefs: [],
        summary: null
    }
];

test('buildAnnotationView: 現在記事の summary と inferredRefs を、関係先の記事情報付きで返す', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧, 'hyperstrata');
    assert.equal(view.summary, 'Hyperstrata を Ghost に実装した記事の要約。');
    assert.deepEqual(view.relations, [
        {
            type: 'continues',
            reason: '前回の記事として明言しているため。',
            slug: 'window-film',
            title: '縁側の窓に目隠しシートを貼った(猫のストレス対策)',
            url: 'https://hanatane.net/window-film/',
            publishedAt: '2026-04-06T12:54:38.000Z'
        }
    ]);
});

test('buildAnnotationView: reason が無い関係は reason: null のまま返す(posts/strata/private/ 由来を想定)', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧, 'window-film');
    assert.equal(view.summary, null);
    assert.deepEqual(view.relations, [
        {
            type: 'continues',
            reason: null,
            slug: 'welcome-cat',
            title: '猫を迎えた',
            url: 'https://hanatane.net/welcome-cat/',
            publishedAt: '2026-01-01T00:00:00.000Z'
        }
    ]);
});

test('buildAnnotationView: 現在記事に inferredRefs も summary も無ければ空の関係一覧と null を返す', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧, 'welcome-cat');
    assert.equal(view.summary, null);
    assert.deepEqual(view.relations, []);
});

test('buildAnnotationView: currentSlug が posts に無い(空文字含む)場合は summary: null, relations: [] を返す', () => {
    const {buildAnnotationView} = 読み込む();
    assert.deepEqual(buildAnnotationView(記事一覧, ''), {summary: null, relations: []});
    assert.deepEqual(buildAnnotationView(記事一覧, 'not-found'), {summary: null, relations: []});
});

test('buildAnnotationView: 関係先slugが posts に存在しない場合(古いキャッシュ等)は無視する', () => {
    const {buildAnnotationView} = 読み込む();
    const posts = [
        {
            slug: 'a',
            title: 'A',
            url: '/a/',
            publishedAt: '2026-01-01T00:00:00.000Z',
            refs: [],
            inferredRefs: [{slug: 'missing', type: 'continues', reason: null}],
            summary: null
        }
    ];
    assert.deepEqual(buildAnnotationView(posts, 'a'), {summary: null, relations: []});
});

test('buildAnnotationView: posts が配列でない場合は例外を投げる', () => {
    const {buildAnnotationView} = 読み込む();
    assert.throws(() => buildAnnotationView(null, 'a'), /posts/);
});
