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
        summary: 'Hyperstrata を Ghost に実装した記事の要約。',
        icon: 'tech',
        annotator: 'claude-sonnet-5',
        annotatedAt: '2026-09-10T04:53:17Z'
    },
    {
        slug: 'window-film',
        title: '縁側の窓に目隠しシートを貼った(猫のストレス対策)',
        url: 'https://hanatane.net/window-film/',
        publishedAt: '2026-04-06T12:54:38.000Z',
        refs: [],
        inferredRefs: [{slug: 'welcome-cat', type: 'continues', reason: null}],
        summary: null,
        icon: 'cat',
        annotator: 'claude-sonnet-5',
        annotatedAt: '2026-09-10T04:51:15Z'
    },
    {
        slug: 'welcome-cat',
        title: '猫を迎えた',
        url: 'https://hanatane.net/welcome-cat/',
        publishedAt: '2026-01-01T00:00:00.000Z',
        refs: [],
        inferredRefs: [],
        summary: null,
        icon: 'cat'
    },
    {
        slug: 'cat-one-year',
        title: '猫を迎えて1年',
        url: 'https://hanatane.net/cat-one-year/',
        publishedAt: '2026-12-31T00:00:00.000Z',
        refs: [],
        inferredRefs: [{slug: 'welcome-cat', type: 'updates', reason: '迎えた当初の見立てを1年後に改めているため。'}],
        summary: null,
        icon: 'cat'
    }
];

test('buildAnnotationView: 現在記事の inferredRefs を関係先の記事情報付きで返し、各関係には summary と icon を含めない(関連記事の一覧には要約も題材アイコンも出さない)', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧, 'hyperstrata');
    assert.deepEqual(Object.keys(view), ['record', 'relations', 'citedBy']);
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

test('buildAnnotationView: 現在記事に inferredRefs が無ければ空の関係一覧を返す(summary があっても表示対象にしない)', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧.map(post => (post.slug === 'welcome-cat' ? {...post, summary: '猫を迎えた記事の要約。'} : post)), 'welcome-cat');
    assert.deepEqual(view.relations, []);
});

test('buildAnnotationView: currentSlug が posts に無い(空文字含む)場合は relations: [] を返す', () => {
    const {buildAnnotationView} = 読み込む();
    assert.deepEqual(buildAnnotationView(記事一覧, ''), {record: null, relations: [], citedBy: []});
    assert.deepEqual(buildAnnotationView(記事一覧, 'not-found'), {record: null, relations: [], citedBy: []});
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
    assert.deepEqual(buildAnnotationView(posts, 'a'), {record: null, relations: [], citedBy: []});
});

test('buildAnnotationView: 現在記事を inferredRefs に持つ後の記事を citedBy として公開日の昇順で返す(古い記事側に updates / revisits を見せる)', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧, 'welcome-cat');
    assert.deepEqual(view.citedBy, [
        {
            type: 'continues',
            reason: null,
            slug: 'window-film',
            title: '縁側の窓に目隠しシートを貼った(猫のストレス対策)',
            url: 'https://hanatane.net/window-film/',
            publishedAt: '2026-04-06T12:54:38.000Z'
        },
        {
            type: 'updates',
            reason: '迎えた当初の見立てを1年後に改めているため。',
            slug: 'cat-one-year',
            title: '猫を迎えて1年',
            url: 'https://hanatane.net/cat-one-year/',
            publishedAt: '2026-12-31T00:00:00.000Z'
        }
    ]);
});

test('buildAnnotationView: 現在記事を参照する記事が無ければ citedBy は空配列を返す', () => {
    const {buildAnnotationView} = 読み込む();
    assert.deepEqual(buildAnnotationView(記事一覧, 'cat-one-year').citedBy, []);
});

test('buildAnnotationView: citedBy は公開日が逆順に並んだ posts でも公開日の昇順に整列する', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView([...記事一覧].reverse(), 'welcome-cat');
    assert.deepEqual(view.citedBy.map(post => post.slug), ['window-film', 'cat-one-year']);
});

test('buildAnnotationView: posts が配列でない場合は例外を投げる', () => {
    const {buildAnnotationView} = 読み込む();
    assert.throws(() => buildAnnotationView(null, 'a'), /posts/);
});

test('buildAnnotationView: 現在記事に summary があれば発掘記録(record)として要約・発掘者・発掘日を返す', () => {
    const {buildAnnotationView} = 読み込む();
    const view = buildAnnotationView(記事一覧, 'hyperstrata');
    assert.deepEqual(view.record, {
        summary: 'Hyperstrata を Ghost に実装した記事の要約。',
        annotator: 'claude-sonnet-5',
        annotatedAt: '2026-09-10T04:53:17Z'
    });
});

test('buildAnnotationView: summary が null の記事(posts/strata/private/ 由来)は annotator があっても record を null にする(限定記事では発掘記録を出さない)', () => {
    const {buildAnnotationView} = 読み込む();
    assert.equal(buildAnnotationView(記事一覧, 'window-film').record, null);
});

test('buildAnnotationView: summary があり annotator / annotatedAt が無い記事(旧形式の graph.json)は record の両者を null にする', () => {
    const {buildAnnotationView} = 読み込む();
    const posts = 記事一覧.map(post => (post.slug === 'welcome-cat' ? {...post, summary: '猫を迎えた記事の要約。'} : post));
    assert.deepEqual(buildAnnotationView(posts, 'welcome-cat').record, {
        summary: '猫を迎えた記事の要約。',
        annotator: null,
        annotatedAt: null
    });
});
