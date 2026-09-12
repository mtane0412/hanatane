/**
 * coordinate-solver.mjs(差分制約つきの重み付き距離最小化)に対するテスト。
 *
 * Sugiyama 法の座標決定(Gansner らの TSE93 §4.2、Jünger らの Prescribed Width)で使う
 * 「x_to - x_from ≥ minGap の制約のもとで Σ weight × |x_a - x_b| を最小化する」問題を解く関数を検証する。
 * 小さな例題は手計算の期待値で、複雑な例は総当たりの最適値と比較して検証する。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

import {minimizeWeightedDistances} from './coordinate-solver.mjs';

test('minimizeWeightedDistances: 間隔制約だけなら、制約を満たす最小の整数座標を返す(最小値は 0 に正規化)', () => {
    const x = minimizeWeightedDistances({size: 3, gaps: [{from: 0, to: 1, min: 1}, {from: 1, to: 2, min: 2}], distances: []});
    assert.deepEqual(x, [0, 1, 3]);
});

test('minimizeWeightedDistances: 距離の目的関数は、制約が許す限り 2 点を同じ座標に引き寄せる', () => {
    // 上の層 t(0) と下の層 b1(1) b2(2) b3(3)。b は左から順に間隔 1。t は b3 と結ばれているので b3 の真上に来る
    const x = minimizeWeightedDistances({
        size: 4,
        gaps: [{from: 1, to: 2, min: 1}, {from: 2, to: 3, min: 1}],
        distances: [{a: 0, b: 3, weight: 1}]
    });
    assert.deepEqual(x, [2, 0, 1, 2]);
});

test('minimizeWeightedDistances: 2 つの引力が競合するときは、重みの大きいほうを優先する', () => {
    // t(0) は b1(1) と重み 1、b3(3) と重み 3 で結ばれている。b1 と b3 は 2 列離れているので、重い b3 側に寄る
    const x = minimizeWeightedDistances({
        size: 4,
        gaps: [{from: 1, to: 2, min: 1}, {from: 2, to: 3, min: 1}],
        distances: [{a: 0, b: 1, weight: 1}, {a: 0, b: 3, weight: 3}]
    });
    assert.deepEqual(x, [2, 0, 1, 2]);
});

test('minimizeWeightedDistances: 幅の上限(仮想の左右ノードとの制約)は、引力による自然な幅より優先される', () => {
    // 3 層: 上 a(0) b(1)(b は a の右)、中 c(2)、下 d(3) e(4)(e は d の右)。c は a と e の両方に引かれる。
    // 幅の制限が無ければ a=0, b=1, c=0, e=0, d=-1 で距離 0 になるが幅は 3 列になる
    const problem = {
        size: 7,
        gaps: [{from: 0, to: 1, min: 1}, {from: 3, to: 4, min: 1}],
        distances: [{a: 0, b: 2, weight: 1}, {a: 2, b: 4, weight: 1}]
    };
    const 自由 = minimizeWeightedDistances(problem);
    assert.equal(Math.max(...自由) - Math.min(...自由), 2);
    assert.equal(Math.abs(自由[0] - 自由[2]) + Math.abs(自由[2] - 自由[4]), 0);

    // 左端 L(5)・右端 R(6) を置き x_R - x_L ≤ 1(2 列)に制限すると、c は a か e のどちらかから 1 離れる
    const 幅制限 = minimizeWeightedDistances({
        size: problem.size,
        gaps: problem.gaps.concat(
            [0, 1, 2, 3, 4].map(node => ({from: 5, to: node, min: 0})),
            [0, 1, 2, 3, 4].map(node => ({from: node, to: 6, min: 0})),
            [{from: 6, to: 5, min: -1}]
        ),
        distances: problem.distances
    });
    assert.ok(幅制限.slice(0, 5).every(value => value >= 0 && value <= 1), `2 列に収まっていない: ${幅制限}`);
    assert.equal(Math.abs(幅制限[0] - 幅制限[2]) + Math.abs(幅制限[2] - 幅制限[4]), 1);
});

test('minimizeWeightedDistances: 制約を同時に満たせない(正の長さの閉路がある)場合は例外にする', () => {
    assert.throws(
        () => minimizeWeightedDistances({size: 2, gaps: [{from: 0, to: 1, min: 1}, {from: 1, to: 0, min: 0}], distances: []}),
        /満たせません/
    );
});

test('minimizeWeightedDistances: 逆向きの弧(流量を戻す)を含む負閉路も消去して最適解に到達する', () => {
    // t(0) は b1(1) と重み 1、b3(3) と重み 1 で結ばれ、b1 → b3 は間隔 2。初期流(補助ノードから両端へ)を
    // 戻す閉路を消さないと t の座標が b1 か b3 の一方に偏るが、最適解は t が b1 と b3 の間のどこでも距離 2。
    // さらに t と b2(2) を重み 5 で結ぶと、t は b2 の真上(距離 2 + 0)に固定される
    const x = minimizeWeightedDistances({
        size: 4,
        gaps: [{from: 1, to: 2, min: 1}, {from: 2, to: 3, min: 1}],
        distances: [{a: 0, b: 1, weight: 1}, {a: 0, b: 3, weight: 1}, {a: 0, b: 2, weight: 5}]
    });
    assert.deepEqual(x, [1, 0, 1, 2]);
});

test('minimizeWeightedDistances: 制約もノードも無ければ空配列を返す', () => {
    assert.deepEqual(minimizeWeightedDistances({size: 0, gaps: [], distances: []}), []);
});

/** 決定的な疑似乱数(線形合同法)。テストの再現性のため Math.random は使わない */
function 疑似乱数(seed) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

/** 小さな問題を総当たりで解き、目的関数の最小値を返す(座標は 0..range) */
function 総当たり最小値({size, gaps, distances}, range) {
    let best = Infinity;
    const x = new Array(size).fill(0);
    const 評価 = () => {
        if (!gaps.every(gap => x[gap.to] - x[gap.from] >= gap.min)) {
            return;
        }
        const cost = distances.reduce((sum, d) => sum + d.weight * Math.abs(x[d.a] - x[d.b]), 0);
        best = Math.min(best, cost);
    };
    const 再帰 = (index) => {
        if (index === size) {
            評価();
            return;
        }
        for (let value = 0; value <= range; value += 1) {
            x[index] = value;
            再帰(index + 1);
        }
    };
    再帰(0);
    return best;
}

test('minimizeWeightedDistances: ランダムな小問題で、総当たりの最小値と一致し、制約を満たす整数座標を返す', () => {
    const rand = 疑似乱数(20260912);
    for (let trial = 0; trial < 40; trial += 1) {
        const size = 4 + Math.floor(rand() * 2);
        const gaps = [];
        // 連鎖する間隔制約(閉路を作らないよう from < to に限る)と、幅の上限を 1 本入れる
        for (let i = 0; i + 1 < size; i += 1) {
            if (rand() < 0.6) {
                gaps.push({from: i, to: i + 1, min: Math.floor(rand() * 2)});
            }
        }
        gaps.push({from: size - 1, to: 0, min: -3});
        const distances = [];
        for (let k = 0; k < 4; k += 1) {
            const a = Math.floor(rand() * size);
            const b = Math.floor(rand() * size);
            if (a !== b) {
                distances.push({a, b, weight: 1 + Math.floor(rand() * 3)});
            }
        }
        const x = minimizeWeightedDistances({size, gaps, distances});
        assert.ok(x.every(Number.isInteger), `整数でない座標: ${x}`);
        assert.ok(gaps.every(gap => x[gap.to] - x[gap.from] >= gap.min), `制約違反: ${JSON.stringify({gaps, x})}`);
        const cost = distances.reduce((sum, d) => sum + d.weight * Math.abs(x[d.a] - x[d.b]), 0);
        assert.equal(cost, 総当たり最小値({size, gaps, distances}, 3), `最適でない: ${JSON.stringify({gaps, distances, x})}`);
    }
});
