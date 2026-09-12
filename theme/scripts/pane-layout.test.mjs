/**
 * pane-layout.mjs(記事ペインの列割り当て。横幅上限つきの座標決定)に対するテスト。
 *
 * 行 = 記事 1 件(新しい順)、エッジ = 引用(上の行 → 下の行)という前提で、
 * 各記事の列(col)と各エッジの縦の区間が通る列(lane)を、列数の上限(maxColumns)の中で決める関数を検証する。
 * 同じ引用先へのエッジは 1 本の幹(lane)に合流し、幹は途中で列を変えない。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

import {layoutTrunks, layoutPane} from './pane-layout.mjs';

/**
 * テスト用の入力を作る。slugs は上から順(row 0, 1, …)、引用は [引用元, 引用先] の組。
 * 戻り値のエッジには fromRow < toRow を保証する
 */
function 入力(slugs, 引用) {
    const rowOf = Object.fromEntries(slugs.map((slug, row) => [slug, row]));
    return {
        nodes: slugs.map((slug, row) => ({slug, row})),
        edges: 引用.map(([from, to]) => ({from, to, fromRow: rowOf[from], toRow: rowOf[to]}))
    };
}

test('layoutTrunks: 引用チェーン(a → b → c)は同じ列を継ぎ、幅は 1 列になる', () => {
    const {nodes, edges} = 入力(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    assert.deepEqual(result.cols, [0, 0, 0]);
    assert.deepEqual(result.lanes, [0, 0]);
    assert.equal(result.width, 1);
});

test('layoutTrunks: 途中の行の記事は幹を避けて別の列に置かれ、幹は引用元と引用先の列をまっすぐ結ぶ', () => {
    const {nodes, edges} = 入力(['a', 'b', 'c'], [['a', 'c']]);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    assert.equal(result.cols[0], result.cols[2]);
    assert.equal(result.lanes[0], result.cols[0]);
    assert.notEqual(result.cols[1], result.cols[0]);
    assert.equal(result.width, 2);
});

test('layoutTrunks: 同じ引用先へのエッジは 1 本の幹に合流する(lane が同じ列になる)', () => {
    // a と b が c を引用する。幹は 1 本(行 1 の b の隣を通る必要は無く、b は幹から c へ合流する)
    const {nodes, edges} = 入力(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']]);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    assert.equal(result.lanes[0], result.lanes[1]);
    assert.equal(result.lanes[0], result.cols[2]);
    assert.notEqual(result.cols[1], result.lanes[0]);
    assert.equal(result.width, 2);
});

test('layoutTrunks: 幹が通る行の記事は幹の列に置かれない', () => {
    // a → e の幹が行 1〜3 を通る。b, c, d はその列に置けない
    const {nodes, edges} = 入力(['a', 'b', 'c', 'd', 'e'], [['a', 'e']]);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    const lane = result.lanes[0];
    [1, 2, 3].forEach((row) => {
        assert.notEqual(result.cols[row], lane, `行 ${row} の記事が幹の列にある`);
    });
});

test('layoutTrunks: 同じ行を通る 2 本の幹は別の列になる', () => {
    // a → d と b → e の幹が行 2〜3 で重なる
    const {nodes, edges} = 入力(['a', 'b', 'c', 'd', 'e'], [['a', 'd'], ['b', 'e']]);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    assert.notEqual(result.lanes[0], result.lanes[1]);
});

test('layoutTrunks: 列数の上限を超えない(重なる幹が多くても上限内に収める)', () => {
    // 4 本の幹(a→f, b→g, c→h, d→i)が行 4 で全部重なり、行 4 には e もある。自然な幅は 5 列
    const {nodes, edges} = 入力(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
        [['a', 'f'], ['b', 'g'], ['c', 'h'], ['d', 'i']]
    );
    const 自由 = layoutTrunks(nodes, edges, {maxColumns: 8});
    assert.equal(自由.width, 5);
    assert.ok(自由.cols.every(col => col >= 0 && col < 5));
    assert.ok(自由.lanes.every(lane => lane >= 0 && lane < 5));
});

test('layoutTrunks: 幹だけで列数の上限を超える場合は例外にする(黙って幅を広げない)', () => {
    const {nodes, edges} = 入力(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
        [['a', 'f'], ['b', 'g'], ['c', 'h'], ['d', 'i']]
    );
    assert.throws(() => layoutTrunks(nodes, edges, {maxColumns: 4}), /列数の上限/);
});

test('layoutTrunks: 曲がりの総量が最小になる(引用元は幹の真上、引用先は幹の真下に置く)', () => {
    // a → c、a → d、b → d。行 1 には b と c の幹と d の幹があるので幅は 3 列。
    // b は d の幹の隣に置けば b → d の曲がりは 1 で済み、a を c の幹の上に置けば a → d の曲がりが 1(合計 2 が最小)
    const {nodes, edges} = 入力(['a', 'b', 'c', 'd'], [['a', 'c'], ['a', 'd'], ['b', 'd']]);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    const 曲がり = edges.reduce((sum, edge, index) => (
        sum + Math.abs(result.cols[edge.fromRow] - result.lanes[index]) + Math.abs(result.lanes[index] - result.cols[edge.toRow])
    ), 0);
    assert.equal(曲がり, 2);
    assert.equal(result.width, 3);
});

test('layoutTrunks: 引用が無ければ全記事が列 0 に並ぶ', () => {
    const {nodes, edges} = 入力(['a', 'b', 'c'], []);
    const result = layoutTrunks(nodes, edges, {maxColumns: 4});
    assert.deepEqual(result.cols, [0, 0, 0]);
    assert.deepEqual(result.lanes, []);
    assert.equal(result.width, 1);
});

test('layoutTrunks: 空の入力では幅 1・空の結果を返す', () => {
    assert.deepEqual(layoutTrunks([], [], {maxColumns: 4}), {cols: [], lanes: [], width: 1});
});

test('layoutTrunks: maxColumns が 1 以上の整数でなければ例外にする', () => {
    const {nodes, edges} = 入力(['a'], []);
    assert.throws(() => layoutTrunks(nodes, edges, {maxColumns: 0}), /maxColumns/);
    assert.throws(() => layoutTrunks(nodes, edges, {maxColumns: 2.5}), /maxColumns/);
    assert.throws(() => layoutTrunks(nodes, edges, {}), /maxColumns/);
});

test('layoutTrunks: 入力のノード・エッジ配列を変更しない', () => {
    const {nodes, edges} = 入力(['a', 'b'], [['a', 'b']]);
    const ノード複製 = JSON.stringify(nodes);
    const エッジ複製 = JSON.stringify(edges);
    layoutTrunks(nodes, edges, {maxColumns: 4});
    assert.equal(JSON.stringify(nodes), ノード複製);
    assert.equal(JSON.stringify(edges), エッジ複製);
});

/**
 * layoutPane 用の入力。graph.json の posts と同じ形(新しい順に並んでいる前提)を slug と引用から作る
 */
function 記事(slugs, 引用, 推定 = []) {
    return slugs.map(slug => ({
        slug,
        refs: 引用.filter(([from]) => from === slug).map(([, to]) => to),
        inferredRefs: 推定.filter(([from]) => from === slug).map(([, to]) => ({slug: to, type: 'continues'}))
    }));
}

test('layoutPane: 人間の引用の列と幹は layoutTrunks と同じになり、推定エッジを足しても変わらない', () => {
    const {nodes, edges} = 入力(['a', 'b', 'c', 'd'], [['a', 'c'], ['a', 'd'], ['b', 'd']]);
    const trunks = layoutTrunks(nodes, edges, {maxColumns: 6});
    const 人間だけ = layoutPane(記事(['a', 'b', 'c', 'd'], [['a', 'c'], ['a', 'd'], ['b', 'd']]), {maxColumns: 6});
    const 推定あり = layoutPane(記事(['a', 'b', 'c', 'd'], [['a', 'c'], ['a', 'd'], ['b', 'd']], [['b', 'c'], ['a', 'b']]), {maxColumns: 6});
    ['a', 'b', 'c', 'd'].forEach((slug, row) => {
        assert.equal(人間だけ.cols[slug], trunks.cols[row]);
        assert.equal(推定あり.cols[slug], trunks.cols[row]);
    });
    [['a', 'c'], ['a', 'd'], ['b', 'd']].forEach(([from, to], index) => {
        assert.equal(人間だけ.lanes[from + '|' + to], trunks.lanes[index]);
        assert.equal(推定あり.lanes[from + '|' + to], trunks.lanes[index]);
    });
});

test('layoutPane: 推定エッジの幹は途中の行の記事を跨がない列に置く', () => {
    // 引用が無いので全記事が列 0。推定 a → c は b(列 0)を跨げないので列 1 を通る
    const result = layoutPane(記事(['a', 'b', 'c'], [], [['a', 'c']]), {maxColumns: 4});
    assert.equal(result.cols.a, result.cols.b);
    assert.equal(result.cols.b, result.cols.c);
    assert.notEqual(result.lanes['a|c'], result.cols.b);
    assert.equal(result.width, 2);
});

test('layoutPane: 隣の行への推定エッジは幹を通らず、引用先の列をそのまま lane にする', () => {
    const result = layoutPane(記事(['a', 'b'], [], [['a', 'b']]), {maxColumns: 4});
    assert.equal(result.lanes['a|b'], 0);
    assert.equal(result.width, 1);
});

test('layoutPane: 同じ引用先への推定エッジは同じ列(1 本の幹)に合流する', () => {
    // a → d と b → d(いずれも推定)。c(行 2)を跨ぐので列 1 を通り、2 本とも同じ列になる
    const result = layoutPane(記事(['a', 'b', 'c', 'd'], [], [['a', 'd'], ['b', 'd']]), {maxColumns: 4});
    assert.equal(result.lanes['a|d'], result.lanes['b|d']);
    assert.notEqual(result.lanes['a|d'], result.cols.c);
});

test('layoutPane: 引用先が違う推定の幹は、幅に余裕があれば別の列に置く', () => {
    // a → d と b → e が行 2〜3 で重なる。列 0 は記事、列 1 と 2 に分ける
    const result = layoutPane(記事(['a', 'b', 'c', 'd', 'e'], [], [['a', 'd'], ['b', 'e']]), {maxColumns: 4});
    assert.notEqual(result.lanes['a|d'], result.lanes['b|e']);
    assert.equal(result.width, 3);
});

test('layoutPane: 余った列は人間の列の両側に配る(推定の幹が記事の列の左右に分かれる)', () => {
    // 引用が無いので記事は 1 列。上限 3 列なら記事の列を中央にして、推定 a → d と b → e の幹は左右に 1 本ずつ
    const result = layoutPane(記事(['a', 'b', 'c', 'd', 'e'], [], [['a', 'd'], ['b', 'e']]), {maxColumns: 3});
    const lanes = [result.lanes['a|d'], result.lanes['b|e']];
    assert.ok(Math.min(...lanes) < result.cols.c && result.cols.c < Math.max(...lanes), `左右に分かれていない: ${JSON.stringify(result)}`);
});

test('layoutPane: 使った列の最小は 0 になる(余った列を配っても左に空き列を残さない)', () => {
    const result = layoutPane(記事(['a', 'b'], [['a', 'b']]), {maxColumns: 8});
    assert.deepEqual(result.cols, {a: 0, b: 0});
    assert.equal(result.width, 1);
});

test('layoutPane: 幅の上限に余裕が無ければ、引用先が違う推定の幹も列を共有する', () => {
    const result = layoutPane(記事(['a', 'b', 'c', 'd', 'e'], [], [['a', 'd'], ['b', 'e']]), {maxColumns: 2});
    assert.equal(result.lanes['a|d'], 1);
    assert.equal(result.lanes['b|e'], 1);
    assert.equal(result.width, 2);
});

test('layoutPane: 同じ引用先へ向かう推定エッジは人間の幹に合流する(幹の列をそのまま lane にする)', () => {
    // 人間の a → e の幹(行 1〜3)。推定 b → e は行 2〜3 を通り、同じ引用先なので幹に合流してよい
    const result = layoutPane(記事(['a', 'b', 'c', 'd', 'e'], [['a', 'e']], [['b', 'e']]), {maxColumns: 4});
    assert.equal(result.lanes['b|e'], result.lanes['a|e']);
});

test('layoutPane: 引用先が違う人間の幹の縦の区間とは、幅に余裕があれば重ならない列に置く', () => {
    // 人間の a → e の幹(列 0、行 1〜3)。推定 b → d は行 2 を通る。行 2 の c は列 1 にあり、列 0 は人間の幹なので列 2 を通る
    const result = layoutPane(記事(['a', 'b', 'c', 'd', 'e'], [['a', 'e']], [['b', 'd']]), {maxColumns: 4});
    assert.equal(result.lanes['a|e'], result.cols.a);
    assert.equal(result.cols.c, 1);
    assert.equal(result.lanes['b|d'], 2);
});

test('layoutPane: 人間の引用と同じ組の推定エッジは人間の引用として扱い、lane は 1 つだけ持つ', () => {
    const result = layoutPane(記事(['a', 'b', 'c'], [['a', 'c']], [['a', 'c']]), {maxColumns: 4});
    assert.deepEqual(Object.keys(result.lanes), ['a|c']);
    assert.equal(result.lanes['a|c'], result.cols.a);
});

test('layoutPane: 一覧に無い slug と自己参照は無視する', () => {
    const result = layoutPane(記事(['a', 'b'], [['a', 'unknown'], ['a', 'a']], [['b', 'unknown']]), {maxColumns: 4});
    assert.deepEqual(result.lanes, {});
    assert.deepEqual(result.cols, {a: 0, b: 0});
});

test('layoutPane: 推定の幹を置く列が上限内に無ければ例外にする(記事を跨ぐ列に黙って置かない)', () => {
    // 幅 1 では列 0 しか無く、a → c は b を跨ぐことになる
    assert.throws(() => layoutPane(記事(['a', 'b', 'c'], [], [['a', 'c']]), {maxColumns: 1}), /列数の上限/);
});

test('layoutPane: 空の入力では幅 1・空の結果を返す', () => {
    assert.deepEqual(layoutPane([], {maxColumns: 4}), {cols: {}, lanes: {}, width: 1});
});
