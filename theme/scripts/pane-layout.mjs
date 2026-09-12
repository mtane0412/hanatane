/**
 * 記事ペイン(partials/strata-pane.hbs)の列割り当て。横幅上限つきの座標決定
 *
 * 行 = 記事 1 件(新しい順、固定)、エッジ = 引用(上の行 → 下の行)というグラフに対して、
 * 各記事の列(col)と各エッジの縦の区間が通る列(lane)を、列数の上限(maxColumns)の中で決める。
 * Sugiyama 法の後半 2 段階(行内の順序付け → 座標決定)を、次の独自の前提で行う:
 *
 * - 同じ引用先へのエッジは 1 本の幹(lane)に合流し、幹は途中で列を変えない(git のブランチ図の見た目を保つ)。
 *   幹は「最も上の引用元の次の行」から「引用先の前の行」までの区間を占める
 * - 順序付け: 行を上から順に掃引し、記事と幹を 1 本の並び(全順序)に挿入していく。幹は引用元の位置に、
 *   幹の終点の記事は幹の位置に入れて、引用チェーンが同じ列を継ぐようにする
 * - 座標決定: 同じ行にある記事・幹の隣り合う組に間隔 ≥ 1、仮想の左端・右端で幅 ≤ maxColumns の制約を置き、
 *   エッジの曲がり(引用元と幹、幹と引用先の列の差)の重み付き総和を最小化する(coordinate-solver.mjs)。
 *   全体を左へ寄せる弱い引力を加えて、解を一意に近づけ幅を詰める
 * - 幹だけで上限に収まらない場合は例外にする(Fail-Fast。黙って幅を広げない)
 *
 * このモジュールは Node(scripts/hyperstrata-sync.mjs)で実行し、結果を graph.json に載せる想定。
 */
import {minimizeWeightedDistances} from './coordinate-solver.mjs';

/** エッジの曲がり 1 列ぶんのコスト。左寄せの引力(1)より十分大きくし、幅を詰めるために曲がりを増やさないようにする */
const BEND_WEIGHT = 10;
/** 全体を左へ寄せる引力の重み */
const COMPACT_WEIGHT = 1;
/**
 * 推定エッジが、引用先の違う推定エッジと同じ列で縦の区間を共有するときのコスト(重なる行 1 つ・相手の引用先 1 つごと)。
 * 曲がり 1 列(BEND_WEIGHT)の 1/10 にして、10 行以上の重なりを避けるためなら 1 列ぶん曲げる、という釣り合いにする。
 * 実データ(記事 96 件)で曲がり・共有の超過本数・1 区間の最大本数をすべて改善した値
 */
const SHARE_INFERRED_COST = 1;
/** 推定エッジが、引用先の違う人間の幹と同じ列で縦の区間を共有するときのコスト(重なる行 1 つごと)。人間の幹の見た目を優先して重くする */
const SHARE_HUMAN_COST = 10;
/**
 * 推定エッジが、同じ引用先へ向かう別のエッジと同じ列で縦の区間を重ねる(合流して 1 本の幹になる)ときの値引き(相手 1 本ごと)。
 * 曲がり半列ぶんにして、曲がりが同点なら合流を選ぶ(曲がりを増やしてまで合流はしない)。
 * 実データでは 10 にすると曲がりの総量が増え、0 にすると共有の超過本数が増えたので中間を取った
 */
const MERGE_BONUS = 5;
/** 推定エッジの置き直しの回数。先に置いたエッジが後のエッジを見て列を選び直せるようにする */
const REFINE_PASSES = 2;

/**
 * 記事と引用から、各記事の列と各エッジの幹の列を決める。
 *
 * @param {Array<{row: number}>} nodes 記事(row は 0 から連番。配列の順は row 順)
 * @param {Array<{fromRow: number, toRow: number}>} edges 引用(fromRow < toRow)
 * @param {{maxColumns: number}} options 列数の上限(1 以上)
 * @returns {{cols: number[], lanes: number[], width: number}}
 *   cols は nodes と同じ順の列番号(0 始まり)、lanes は edges と同じ順の幹の列番号、width は使った列数
 * @throws {Error} 幹だけで列数の上限を超える場合
 */
export function layoutTrunks(nodes, edges, options) {
    if (!Number.isInteger(options.maxColumns) || options.maxColumns < 1) {
        throw new Error('maxColumns は 1 以上の整数である必要があります: ' + options.maxColumns);
    }
    if (nodes.length === 0) {
        return {cols: [], lanes: [], width: 1};
    }
    const items = buildItems(nodes, edges);
    const order = orderItems(items, nodes, edges);
    const x = solveCoordinates(items, order, nodes, edges, options.maxColumns);

    const cols = nodes.map((node, index) => x[items.nodeItem[index]]);
    const lanes = edges.map((edge) => {
        const chain = items.chainOfTarget[edge.toRow];
        return chain === undefined ? cols[edge.toRow] : x[chain];
    });
    const width = Math.max(...cols.concat(lanes)) + 1;
    return {cols, lanes, width};
}

/**
 * graph.json の posts(新しい順)から、記事ペインの列と幹の列を決める。
 *
 * 人間の引用(refs)だけで記事の列と幹(layoutTrunks)を決め、Hyperstrata の注釈から合成した推定エッジ
 * (inferredRefs)は、確定した列の上に 1 本ずつ重ねる。推定エッジの縦の区間が通る列(lane)は次の基準で選ぶ:
 *
 * - 途中の行の記事を跨がない列だけを候補にする(必須)。列数の上限の中に候補が無ければ例外にする
 * - 曲がり(引用元と lane、lane と引用先の列の差 × BEND_WEIGHT)と、引用先の違うエッジとの縦の区間の共有
 *   (人間の幹は SHARE_HUMAN_COST、推定エッジは SHARE_INFERRED_COST。重なる行と相手の引用先ごと)の合計が最小の列を選ぶ。
 *   同じ引用先へ向かうエッジとの重なりは合流(1 本の幹)なので、コストにせず MERGE_BONUS だけ値引きする
 * - 縦の区間が長いエッジから順に置き、REFINE_PASSES 回だけ全体を見直す(貪欲法)
 *
 * 人間の引用の列は上限の幅の中央に寄せ、余った列を左右に配ってから推定エッジを置く(片側に寄せるより
 * 推定エッジの移動が短くなる)。最後に使った列の最小が 0 になるよう平行移動する。
 * 人間の引用と同じ組(引用元, 引用先)の推定エッジは人間の引用として扱う。一覧に無い slug と自己参照は無視する。
 *
 * @param {Array<{slug: string, refs: string[], inferredRefs?: Array<{slug: string}>}>} posts 新しい順に並んだ記事
 * @param {{maxColumns: number}} options 列数の上限
 * @returns {{cols: Object<string, number>, lanes: Object<string, number>, width: number}}
 *   cols は slug → 列、lanes は "引用元slug|引用先slug" → 幹の列(人間・推定の両方)、width は使った列数
 * @throws {Error} 列数の上限に収まらない場合
 */
export function layoutPane(posts, options) {
    if (!Number.isInteger(options.maxColumns) || options.maxColumns < 1) {
        throw new Error('maxColumns は 1 以上の整数である必要があります: ' + options.maxColumns);
    }
    if (posts.length === 0) {
        return {cols: {}, lanes: {}, width: 1};
    }
    const rowOf = {};
    posts.forEach((post, row) => {
        rowOf[post.slug] = row;
    });
    const nodes = posts.map((post, row) => ({row}));
    const humanEdges = [];
    const inferredEdges = [];
    const keys = new Set();
    const collect = (post, ref, bucket) => {
        const key = post.slug + '|' + ref;
        if (!Object.prototype.hasOwnProperty.call(rowOf, ref) || ref === post.slug || keys.has(key)) {
            return;
        }
        keys.add(key);
        const from = rowOf[post.slug];
        const to = rowOf[ref];
        bucket.push({key, fromRow: Math.min(from, to), toRow: Math.max(from, to)});
    };
    posts.forEach((post) => {
        post.refs.forEach(ref => collect(post, ref, humanEdges));
    });
    posts.forEach((post) => {
        (post.inferredRefs || []).forEach(relation => collect(post, relation.slug, inferredEdges));
    });
    // 同じ slug に対する列は graph.json の行順(新しい順・同時刻は slug 順)に依存するため、入力の順序をそのまま使う

    const trunks = layoutTrunks(nodes, humanEdges, options);
    // 余った列を左右に配る
    const offset = Math.floor((options.maxColumns - trunks.width) / 2);
    const nodeCols = trunks.cols.map(col => col + offset);
    const humanLanes = humanEdges.map((edge, index) => Object.assign({}, edge, {lane: trunks.lanes[index] + offset}));
    const inferredLanes = inferredEdges.map(edge => Object.assign({}, edge, {lane: null}));
    placeInferredLanes(inferredLanes, humanLanes, nodeCols, options.maxColumns);

    const used = nodeCols.concat(humanLanes.map(edge => edge.lane), inferredLanes.map(edge => edge.lane));
    const base = Math.min(...used);
    const cols = {};
    posts.forEach((post, row) => {
        cols[post.slug] = nodeCols[row] - base;
    });
    const lanes = {};
    humanLanes.concat(inferredLanes).forEach((edge) => {
        lanes[edge.key] = edge.lane - base;
    });
    return {cols, lanes, width: Math.max(...used) - base + 1};
}

/**
 * 推定エッジの lane を決める(edges の lane を書き換える)。隣の行へのエッジ(縦の区間が無い)は引用先の列にする。
 *
 * @param {Array<{fromRow: number, toRow: number, lane: number|null}>} edges 推定エッジ
 * @param {Array<{fromRow: number, toRow: number, lane: number}>} humanEdges 人間の引用(lane 確定済み)
 * @param {number[]} cols 行 → 記事の列
 * @param {number} maxColumns
 */
function placeInferredLanes(edges, humanEdges, cols, maxColumns) {
    const interior = edge => ({fromRow: edge.fromRow + 1, toRow: edge.toRow - 1});
    const hasNode = (lane, edge) => {
        const range = interior(edge);
        return cols.some((col, row) => col === lane && range.fromRow <= row && row <= range.toRow);
    };
    /**
     * 同じ列で縦の区間が重なる、引用先の違うエッジの本数を、重なる行ごとに数えて合計する
     * (同じ行では引用先ごとに 1 回だけ数える。同じ引用先へ向かうエッジは合流なので数えない)
     */
    const sharedTargets = (edge, lane, others) => {
        const range = interior(edge);
        let total = 0;
        for (let row = range.fromRow; row <= range.toRow; row += 1) {
            const targets = new Set();
            others.forEach((other) => {
                const otherRange = interior(other);
                if (other !== edge && other.lane === lane && other.toRow !== edge.toRow && otherRange.fromRow <= row && row <= otherRange.toRow) {
                    targets.add(other.toRow);
                }
            });
            total += targets.size;
        }
        return total;
    };
    /** 同じ列で縦の区間が重なる、同じ引用先へ向かう別のエッジの本数(合流の相手) */
    const mergePartners = (edge, lane) => {
        const range = interior(edge);
        return edges.filter((other) => {
            const otherRange = interior(other);
            return other !== edge && other.lane === lane && other.toRow === edge.toRow &&
                otherRange.fromRow <= range.toRow && range.fromRow <= otherRange.toRow;
        }).length;
    };
    const cost = (edge, lane) => (
        BEND_WEIGHT * (Math.abs(cols[edge.fromRow] - lane) + Math.abs(lane - cols[edge.toRow])) +
        SHARE_HUMAN_COST * sharedTargets(edge, lane, humanEdges) +
        SHARE_INFERRED_COST * sharedTargets(edge, lane, edges) -
        MERGE_BONUS * mergePartners(edge, lane)
    );
    const choose = (edge) => {
        let best = null;
        for (let lane = 0; lane < maxColumns; lane += 1) {
            if (hasNode(lane, edge)) {
                continue;
            }
            const value = cost(edge, lane);
            if (best === null || value < best.value) {
                best = {lane, value};
            }
        }
        if (best === null) {
            const range = interior(edge);
            throw new Error('推定エッジを置く列が列数の上限(maxColumns ' + maxColumns + ')の中にありません: 行 ' + range.fromRow + '〜' + range.toRow);
        }
        edge.lane = best.lane;
    };
    edges.forEach((edge) => {
        if (edge.toRow - edge.fromRow <= 1) {
            edge.lane = cols[edge.toRow];
        }
    });
    // 縦の区間が長いエッジから順に置き、そのあと全体を見直す
    const spanning = edges.filter(edge => edge.toRow - edge.fromRow > 1)
        .sort((a, b) => (b.toRow - b.fromRow) - (a.toRow - a.fromRow) || a.toRow - b.toRow || a.fromRow - b.fromRow);
    for (let pass = 0; pass <= REFINE_PASSES; pass += 1) {
        spanning.forEach(choose);
    }
}

/**
 * 記事と幹を「項目」として並べる。項目は id(配列の添字)で参照し、span(占める行の区間)を持つ。
 *
 * @returns {{spans: Array<{fromRow: number, toRow: number}>, nodeItem: number[], chainOfTarget: Object<number, number>, chainTarget: Object<number, number>}}
 *   nodeItem は記事の添字 → 項目 id、chainOfTarget は引用先の行 → 幹の項目 id(幹が不要なら無し)、chainTarget はその逆
 */
function buildItems(nodes, edges) {
    const spans = nodes.map(node => ({fromRow: node.row, toRow: node.row}));
    const nodeItem = nodes.map((node, index) => index);
    const chainOfTarget = {};
    const chainTarget = {};
    const topSourceOfTarget = {};
    edges.forEach((edge) => {
        const current = topSourceOfTarget[edge.toRow];
        topSourceOfTarget[edge.toRow] = current === undefined ? edge.fromRow : Math.min(current, edge.fromRow);
    });
    Object.keys(topSourceOfTarget).map(Number).sort((a, b) => a - b).forEach((toRow) => {
        const fromRow = topSourceOfTarget[toRow] + 1;
        if (fromRow > toRow - 1) {
            return;
        }
        const id = spans.length;
        spans.push({fromRow, toRow: toRow - 1});
        chainOfTarget[toRow] = id;
        chainTarget[id] = toRow;
    });
    return {spans, nodeItem, chainOfTarget, chainTarget};
}

/**
 * 行を上から掃引し、記事と幹に仮の列を first-fit で与えて、その列順を全順序にする。
 *
 * 幹は途中で列を変えないため、同じ行に無い幹同士にも左右関係が連鎖して幅が広がりやすい
 * (区間順序の次元の問題)。列を先に仮決めしてから並べれば、同じ行に重ならない幹は同じ列を共有でき、
 * 必要な幅が同じ行に重なる本数(クリーク)に近づく。座標はこの順序の中でソルバーが最適化し直す。
 *
 * 仮の列の決め方は優先順に: 幹は引用元の列(空いていなければ最も近い空き列)に、引用先が近い順で置く。
 * 記事は (1) 幹の終点なら幹の列、(2) 直前の行の記事から直接引用されていればその記事の列、
 * (3) 引用先の幹がこの行を通っていればその幹の最も近い空き列、(4) それ以外は列 0 に最も近い空き列。
 * いずれも空いていなければ最も近い空き列に退避する。
 *
 * @returns {number[]} 項目 id の並び(左から右)
 */
function orderItems(items, nodes, edges) {
    const tentative = new Array(items.spans.length).fill(null);
    /** 列 → 占有している行区間の配列 */
    const reserved = {};
    const isFree = (col, span) => (reserved[col] || []).every(range => span.toRow < range.fromRow || range.toRow < span.fromRow);
    const reserve = (col, span) => {
        (reserved[col] = reserved[col] || []).push(span);
    };
    const nearestFree = (center, span) => {
        for (let offset = 0; ; offset += 1) {
            const candidates = offset === 0 ? [center] : [center + offset, center - offset];
            const found = candidates.find(col => isFree(col, span));
            if (found !== undefined) {
                return found;
            }
        }
    };
    const place = (id, center) => {
        tentative[id] = nearestFree(center, items.spans[id]);
        reserve(tentative[id], items.spans[id]);
    };
    const isActiveAt = (id, row) => items.spans[id].fromRow <= row && row <= items.spans[id].toRow;
    const chainsStartingAt = {};
    Object.keys(items.chainTarget).map(Number).forEach((id) => {
        (chainsStartingAt[items.spans[id].fromRow] = chainsStartingAt[items.spans[id].fromRow] || []).push(id);
    });
    const outgoing = nodes.map(() => []);
    const adjacentSource = {};
    edges.forEach((edge) => {
        outgoing[edge.fromRow].push(edge);
        if (edge.toRow === edge.fromRow + 1) {
            adjacentSource[edge.toRow] = edge.fromRow;
        }
    });

    nodes.forEach((node, index) => {
        const row = node.row;
        (chainsStartingAt[row] || []).sort((a, b) => items.chainTarget[a] - items.chainTarget[b]).forEach((chain) => {
            const source = nodes.findIndex(candidate => candidate.row === row - 1);
            place(chain, tentative[items.nodeItem[source]]);
        });

        const id = items.nodeItem[index];
        const endingChain = items.chainOfTarget[row];
        if (endingChain !== undefined) {
            place(id, tentative[endingChain]);
            return;
        }
        if (adjacentSource[row] !== undefined) {
            place(id, tentative[items.nodeItem[adjacentSource[row]]]);
            return;
        }
        const nearestActiveChain = outgoing[index]
            .map(edge => items.chainOfTarget[edge.toRow])
            .filter(chain => chain !== undefined && isActiveAt(chain, row))
            .sort((a, b) => items.chainTarget[a] - items.chainTarget[b])[0];
        if (nearestActiveChain !== undefined) {
            place(id, tentative[nearestActiveChain]);
            return;
        }
        place(id, 0);
    });

    // 仮の列の順に並べる。同じ列の項目は同じ行に重ならない(first-fit が保証する)ので、順序は行ごとに一貫する
    return tentative.map((col, id) => ({col, id}))
        .sort((a, b) => a.col - b.col || a.id - b.id)
        .map(entry => entry.id);
}

/**
 * 全順序と行ごとの同居関係から間隔制約を作り、曲がりの重み付き総和を最小化する座標を求める。
 * 項目 id をそのままソルバーのノード番号に使い、末尾に仮想の左端 L と右端 R を足す。
 *
 * @returns {number[]} 項目 id → 列(0 始まり)
 * @throws {Error} 幅の上限に収まらない場合
 */
function solveCoordinates(items, order, nodes, edges, maxColumns) {
    const size = items.spans.length;
    const left = size;
    const right = size + 1;
    const gaps = [];
    const seen = new Set();
    const rowCount = nodes.length;
    for (let row = 0; row < rowCount; row += 1) {
        const present = order.filter(id => items.spans[id].fromRow <= row && row <= items.spans[id].toRow);
        for (let i = 0; i + 1 < present.length; i += 1) {
            const key = present[i] + '|' + present[i + 1];
            if (!seen.has(key)) {
                seen.add(key);
                gaps.push({from: present[i], to: present[i + 1], min: 1});
            }
        }
    }
    for (let id = 0; id < size; id += 1) {
        gaps.push({from: left, to: id, min: 0});
        gaps.push({from: id, to: right, min: 0});
    }
    gaps.push({from: right, to: left, min: -(maxColumns - 1)});

    const distances = [];
    const chainToTargetAdded = new Set();
    edges.forEach((edge) => {
        const source = items.nodeItem[edge.fromRow];
        const target = items.nodeItem[edge.toRow];
        const chain = items.chainOfTarget[edge.toRow];
        if (chain === undefined) {
            distances.push({a: source, b: target, weight: BEND_WEIGHT});
            return;
        }
        distances.push({a: source, b: chain, weight: BEND_WEIGHT});
        if (!chainToTargetAdded.has(chain)) {
            chainToTargetAdded.add(chain);
            distances.push({a: chain, b: target, weight: BEND_WEIGHT});
        }
    });
    for (let id = 0; id < size; id += 1) {
        distances.push({a: id, b: left, weight: COMPACT_WEIGHT});
    }

    let x;
    try {
        x = minimizeWeightedDistances({size: size + 2, gaps, distances});
    } catch (error) {
        const required = requiredColumns(items, order, rowCount);
        throw new Error('幹だけで列数の上限を超えます: 必要な列数 ' + required + ' > maxColumns ' + maxColumns + ' (' + error.message + ')');
    }
    return x.slice(0, size);
}

/** 幅の上限を無視したときに必要な列数(間隔制約の最長経路 + 1)を求める。例外のメッセージ用 */
function requiredColumns(items, order, rowCount) {
    const position = {};
    order.forEach((id, index) => {
        position[id] = index;
    });
    const minX = new Array(items.spans.length).fill(0);
    // order の並びは間隔制約の向き(左 → 右)と一致するので、その順に最長経路を伸ばせばよい
    order.forEach((id) => {
        for (let row = items.spans[id].fromRow; row <= items.spans[id].toRow && row < rowCount; row += 1) {
            order.forEach((other) => {
                if (position[other] < position[id] && items.spans[other].fromRow <= row && row <= items.spans[other].toRow) {
                    minX[id] = Math.max(minX[id], minX[other] + 1);
                }
            });
        }
    });
    return Math.max(...minX) + 1;
}
