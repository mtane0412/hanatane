/**
 * 差分制約つきの重み付き距離最小化(Sugiyama 法の座標決定の中核)
 *
 * 「x_to - x_from ≥ min」という間隔制約(gaps)のもとで、Σ weight × |x_a - x_b|(distances)を最小化する
 * 整数座標 x を求める。Gansner らの TSE93 §4.2 の補助グラフの方法を使う:
 *
 * - 距離 |x_a - x_b| は補助ノード n を置き、n → a と n → b(いずれも min 0)に重み weight を掛けた
 *   線形の目的関数 weight × (x_a - x_n) + weight × (x_b - x_n) に置き換える。最適解では x_n = min(x_a, x_b) になる
 * - 得られる線形計画(min Σ c_j x_j s.t. x_to - x_from ≥ min)の双対は、各ノードに供給 c_j を持つ
 *   最大重み流(Σ min × f を最大化)になる。補助ノードから両端へ weight ずつ流す初期流から始め、
 *   残余グラフの負閉路を消去して最適な循環を求める(Bellman-Ford による負閉路検出)
 * - 最適な流れが決まれば、残余グラフの最短距離(潜在価)の符号を反転したものが x になる
 *   (相補性条件: 流れが正の制約は等号で成立し、それ以外は不等号を満たす)
 *
 * 制約を同時に満たせない(制約グラフに正の長さの閉路がある)場合は例外にする(Fail-Fast)。
 * 対象の規模はペイン 1 枚(ノード数百・制約数百)なので、計算量より実装の単純さを優先している。
 */

/** 残余グラフの弧。capacity が Infinity の弧は元の制約の向き(容量無制限)、有限の弧はその逆向き(流れを戻す) */

/**
 * 間隔制約のもとで重み付き距離の総和を最小化する整数座標を返す。
 *
 * @param {object} problem
 * @param {number} problem.size ノード数(座標のインデックスは 0..size-1)
 * @param {Array<{from: number, to: number, min: number}>} problem.gaps 間隔制約 x_to - x_from ≥ min(min は負でもよい)
 * @param {Array<{a: number, b: number, weight: number}>} problem.distances 最小化する距離 weight × |x_a - x_b|(weight > 0)
 * @returns {number[]} 各ノードの整数座標。最小値が 0 になるよう平行移動する
 * @throws {Error} 制約を同時に満たせない場合
 */
export function minimizeWeightedDistances({size, gaps, distances}) {
    if (size === 0) {
        return [];
    }
    // 制約の弧: index < gaps.length は間隔制約、それ以降は距離の補助ノードから両端への弧(min 0)
    const nodeCount = size + distances.length;
    const arcs = gaps.map(gap => ({from: gap.from, to: gap.to, min: gap.min, flow: 0}));
    distances.forEach((distance, index) => {
        const aux = size + index;
        if (!(distance.weight > 0)) {
            throw new Error('距離の重みは正の数である必要があります: ' + JSON.stringify(distance));
        }
        arcs.push({from: aux, to: distance.a, min: 0, flow: distance.weight});
        arcs.push({from: aux, to: distance.b, min: 0, flow: distance.weight});
    });

    // 残余グラフで負閉路を探し、無くなるまで流れを回す
    for (;;) {
        const cycle = findNegativeCycle(nodeCount, arcs);
        if (cycle === null) {
            break;
        }
        const amount = Math.min(...cycle.map(step => (step.forward ? Infinity : step.arc.flow)));
        if (amount === Infinity) {
            throw new Error('間隔制約を同時に満たせません(正の長さの閉路があります)');
        }
        cycle.forEach((step) => {
            step.arc.flow += step.forward ? amount : -amount;
        });
    }

    // 最適な流れのもとで残余グラフの最短距離(潜在価)を求め、符号を反転して座標にする
    const potential = new Array(nodeCount).fill(0);
    for (let iteration = 0; iteration < nodeCount; iteration += 1) {
        let changed = false;
        arcs.forEach((arc) => {
            if (potential[arc.from] - arc.min < potential[arc.to]) {
                potential[arc.to] = potential[arc.from] - arc.min;
                changed = true;
            }
            if (arc.flow > 0 && potential[arc.to] + arc.min < potential[arc.from]) {
                potential[arc.from] = potential[arc.to] + arc.min;
                changed = true;
            }
        });
        if (!changed) {
            break;
        }
    }
    const x = potential.slice(0, size).map(value => -value);
    const base = Math.min(...x);
    return x.map(value => value - base);
}

/**
 * 残余グラフの負閉路を 1 つ返す(無ければ null)。
 * 弧のコストは、制約の向き(forward)は -min、逆向き(流れを戻す。flow > 0 のときだけ通れる)は +min。
 *
 * @param {number} nodeCount
 * @param {Array<{from: number, to: number, min: number, flow: number}>} arcs
 * @returns {Array<{arc: object, forward: boolean}>|null} 閉路を構成する弧の列(閉路の向きに沿う)
 */
function findNegativeCycle(nodeCount, arcs) {
    const distance = new Array(nodeCount).fill(0);
    const predecessor = new Array(nodeCount).fill(null);
    let last = null;
    for (let iteration = 0; iteration < nodeCount; iteration += 1) {
        last = null;
        arcs.forEach((arc) => {
            if (distance[arc.from] - arc.min < distance[arc.to]) {
                distance[arc.to] = distance[arc.from] - arc.min;
                predecessor[arc.to] = {arc: arc, forward: true, from: arc.from};
                last = arc.to;
            }
            if (arc.flow > 0 && distance[arc.to] + arc.min < distance[arc.from]) {
                distance[arc.from] = distance[arc.to] + arc.min;
                predecessor[arc.from] = {arc: arc, forward: false, from: arc.to};
                last = arc.from;
            }
        });
        if (last === null) {
            return null;
        }
    }
    // nodeCount 回目でも更新があれば負閉路がある。前任者を nodeCount 回たどると必ず閉路の中に入る
    let node = last;
    for (let i = 0; i < nodeCount; i += 1) {
        node = predecessor[node].from;
    }
    const cycle = [];
    const start = node;
    do {
        const step = predecessor[node];
        cycle.push({arc: step.arc, forward: step.forward});
        node = step.from;
    } while (node !== start);
    return cycle.reverse();
}
