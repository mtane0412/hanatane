/**
 * partials/strata-neighbors.hbs(記事ページの直上・直下の層: 前後の記事)と
 * assets/js/strata-neighbors.js(経過日数の置き換え)のテスト。
 *
 * パーシャルは Ghost 本体のヘルパー群が使えないため、素の Handlebars で描画し、
 * Ghost のブロックヘルパー `next_post` / `prev_post` と `t` `date` をスタブとして登録する
 * (scripts/head-title.test.mjs と同じ方式)。
 * JS はブラウザ向けに gulp で連結されるため node:vm で読み込み、window.HyperstrataNeighbors に
 * 公開された純粋関数を検証する(scripts/strata-annotation.test.mjs と同じ方式)。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Handlebars from 'handlebars';

const パーシャル = readFileSync(new URL('../partials/strata-neighbors.hbs', import.meta.url), 'utf8');
const スクリプト = readFileSync(new URL('../assets/js/strata-neighbors.js', import.meta.url), 'utf8');

const 現在記事 = {title: 'immutableなノートを堆積する', published_at: '2026-09-09T11:00:41.000Z'};
const 上の記事 = {title: 'Hyperstrata を Ghost に実装する', url: '/implementation-hyperstrata/', published_at: '2026-09-10T02:00:00.000Z'};
const 下の記事 = {title: '縁側の窓に目隠しシートを貼った(猫のストレス対策)', url: '/window-film/', published_at: '2026-04-06T12:54:38.000Z'};

/**
 * パーシャルを記事コンテキストで描画する。
 *
 * @param {object} 引数
 * @param {object|null} 引数.next - next_post ヘルパーが返す新しい記事(無ければ null)
 * @param {object|null} 引数.prev - prev_post ヘルパーが返す古い記事(無ければ null)
 * @returns {string} 描画結果
 */
function 描画({next, prev}) {
    const hbs = Handlebars.create();
    hbs.registerHelper('t', text => text);
    hbs.registerHelper('date', function () {
        return this.published_at.slice(0, 10);
    });
    hbs.registerHelper('next_post', function (options) {
        return next ? options.fn(next) : options.inverse(this);
    });
    hbs.registerHelper('prev_post', function (options) {
        return prev ? options.fn(prev) : options.inverse(this);
    });
    return hbs.compile(パーシャル)(現在記事);
}

test('新しい記事を「上の層」、古い記事を「下の層」としてタイトル・URL・日付付きで出す', () => {
    const html = 描画({next: 上の記事, prev: 下の記事});
    const 上 = html.indexOf('Layer above');
    const 下 = html.indexOf('Layer below');
    assert.ok(上 >= 0 && 下 >= 0 && 上 < 下, html);
    assert.ok(html.includes('href="/implementation-hyperstrata/"'), html);
    assert.ok(html.includes('Hyperstrata を Ghost に実装する'), html);
    assert.ok(html.includes('href="/window-film/"'), html);
    assert.ok(html.includes('縁側の窓に目隠しシートを貼った(猫のストレス対策)'), html);
    assert.ok(html.includes('<time datetime="2026-04-06T12:54:38.000Z"'), html);
    assert.ok(html.includes('<time datetime="2026-09-10T02:00:00.000Z"'), html);
});

test('経過日数を JS が計算できるように、現在記事の公開日時とラベルを data 属性で渡す', () => {
    const html = 描画({next: 上の記事, prev: 下の記事});
    assert.ok(html.includes('data-strata-neighbors'), html);
    assert.ok(html.includes('data-current-published="2026-09-09T11:00:41.000Z"'), html);
    assert.ok(html.includes('data-label-later="% days later"'), html);
    assert.ok(html.includes('data-label-earlier="% days earlier"'), html);
});

test('最新の記事では上の層を出さず、下の層だけを出す', () => {
    const html = 描画({next: null, prev: 下の記事});
    assert.ok(!html.includes('Layer above'), html);
    assert.ok(html.includes('Layer below'), html);
});

test('最古の記事では下の層を出さず、上の層だけを出す', () => {
    const html = 描画({next: 上の記事, prev: null});
    assert.ok(html.includes('Layer above'), html);
    assert.ok(!html.includes('Layer below'), html);
});

test('前後の記事が無ければリンクを 1 つも出さない(セクションは CSS の :has で隠す)', () => {
    const html = 描画({next: null, prev: null});
    assert.ok(html.includes('gh-strata-neighbors'), html);
    assert.ok(!html.includes('gh-strata-neighbor '), html);
});

test('タイトルに含まれる HTML 特殊文字はエスケープする', () => {
    const html = 描画({next: {...上の記事, title: 'A & B <C>'}, prev: null});
    assert.ok(html.includes('A &amp; B &lt;C&gt;'), html);
});

/**
 * strata-neighbors.js をブラウザ環境なし(document 未定義)で評価し、公開 API を取り出す。
 */
function 読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    return window.HyperstrataNeighbors;
}

test('formatGap は現在記事と隣接記事の公開日時から経過日数の文言を作る', () => {
    const {formatGap} = 読み込む();
    const labels = {later: '% days later', earlier: '% days earlier'};
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', '2026-09-10T02:00:00.000Z', labels), '1 days later');
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', '2026-04-06T12:54:38.000Z', labels), '156 days earlier');
});

test('formatGap は同じ日の記事でも 0 日として文言を返す', () => {
    const {formatGap} = 読み込む();
    const labels = {later: '% days later', earlier: '% days earlier'};
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', '2026-09-09T12:00:00.000Z', labels), '0 days later');
});

test('formatGap は日時が解釈できなければ null を返す', () => {
    const {formatGap} = 読み込む();
    const labels = {later: '% days later', earlier: '% days earlier'};
    assert.equal(formatGap('', '2026-09-10T02:00:00.000Z', labels), null);
    assert.equal(formatGap('2026-09-09T11:00:41.000Z', 'not-a-date', labels), null);
});
