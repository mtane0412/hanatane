/**
 * assets/js/strata-icons.js(Hyperstrata の題材アイコン定義)に対するテスト。
 *
 * テーマの JS は gulp で連結されるブラウザ向けスクリプトのため、ESM として import できない。
 * そのため node:vm で読み込み、window.HyperstrataIcons に公開された値を検証する。
 * <svg> の実描画(DOM 操作)はテスト対象外とし、markup 文字列の中身だけを検証する。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const スクリプト = readFileSync(new URL('../assets/js/strata-icons.js', import.meta.url), 'utf8');

/** strata-icons.js をブラウザ環境なし(document 未定義)で評価し、公開 API を取り出す */
function 読み込む() {
    const window = {};
    vm.runInNewContext(スクリプト, {window});
    return window.HyperstrataIcons;
}

// posts/src/strata.ts の TOPIC_ICONS と一致させる(このテストでは値をハードコードして二重管理を許容する)
const 題材アイコン一覧 = ['cat', 'house', 'hunting', 'game', 'tech', 'travel', 'journal', 'event'];

test('ICONS: TOPIC_ICONS(posts/src/strata.ts)と同じ8種類を定義している', () => {
    const {ICONS} = 読み込む();
    assert.deepEqual(Object.keys(ICONS).sort(), 題材アイコン一覧.slice().sort());
});

test('ICONS: 背景色での塗りつぶし(var(--background-color))を使わない(単色のシルエットだけで表現する。地層に埋まった見た目を損なうため)', () => {
    const {ICONS} = 読み込む();
    題材アイコン一覧.forEach(icon => {
        assert.ok(
            !ICONS[icon].includes('background-color'),
            `${icon} は background-color での塗りつぶしを含むべきではない: ${ICONS[icon]}`
        );
    });
});

test('markup: hunting はライフルを表すシルエットにする(狩猟の的ではなく銃器の形にしてほしいという要望)', () => {
    const {markup} = 読み込む();
    // ライフルらしい細長いパーツ(銃身・台尻)を rect で組む前提とし、同心円の的の形(hunting の旧実装)は使わない
    assert.ok(!markup('hunting').includes('circle'), 'hunting は同心円(的)の形を含むべきではない');
});

test('markup: tech は太陽(放射状の細い線)ではなく歯車に見える形にする(中心の丸+短く太い歯)', () => {
    const {markup} = 読み込む();
    const tech = markup('tech');
    assert.ok(tech.includes('circle'), 'tech は歯車の本体(丸)を含むべき');
    // 太陽のような細い放射線(stroke-width 2 の長い線)ではなく、歯車の歯として短く太い線にする
    assert.doesNotMatch(tech, /stroke-width="2"/, '旧実装(太陽に見える細い放射線)の stroke-width のままになっている');
});

test('markup: 未知の icon は null を返す', () => {
    const {markup} = 読み込む();
    assert.equal(markup('unknown-icon'), null);
    assert.equal(markup(null), null);
    assert.equal(markup(undefined), null);
    assert.equal(markup(''), null);
});
