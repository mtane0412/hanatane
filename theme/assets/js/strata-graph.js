/**
 * Hyperstrata 引用グラフビュー
 *
 * scripts/hyperstrata-sync.mjs が生成する assets/graph.json(公開記事の slug / タイトル / URL / 公開日 / 引用先)を
 * fetch で読み取り、SVG でグラフを描画する。外部ライブラリには依存しない。描画先は 2 種類ある。
 * graph.json の URL はテンプレートが data-strata-graph-url({{asset "graph.json"}})で渡す。
 * 本文の表示を優先するため、初期化は requestIdleCallback で遅らせ、fetch は低優先度で行う。
 *
 * 1. custom-strata.hbs([data-strata]): 固定ページ用。縦軸を時間(公開日)としたアーク図(新しい記事が上)。
 *    年ごとの帯を地層として塗り分け、引用の線は古い層へ伸びる根として左に膨らむ弧で描く
 * 3. partials/strata-timeline.hbs([data-strata-timeline]): トップページの地層タイムライン。記事カードはテンプレートが
 *    HTML で出力し、JS は各行の位置を計測して背後に SVG(月ごとの地層の帯、左のガターの種と根)を重ねる。
 *    表示中に無い古い記事への引用はガターの端でフェードする 1 本の束にまとめ、本数をラベルで示す。
 *    見た目(帯・種・根)は固定ペインと同じ CSS クラスを使う。
 *    末尾の [data-strata-more] が画面に入ると、ghost_head が出力する link[rel=next] の URL(/page/N/)を fetch して
 *    次ページの行を継ぎ足し、SVG を描き直す(無限スクロール)。次ページが無くなったら [data-strata-more] を外す
 * 2. partials/strata-pane.hbs([data-strata-pane]): 記事ページ左側の固定ペイン。新しい記事が上、
 *    月ごとの区切り線付き。記事ごとに列(col)を持ち、引用チェーンが同じ列を継いで 1 本の幹になり、
 *    複数の引用で枝分かれ、複数からの被引用で合流する git のブランチ図のように描く(本家 Hyperstrata と同じ方式)。
 *    現在の記事(data-current-slug)とその引用チェーン(2 ホップ)を強調し、無関係なものは暗くする。
 *    引用の無い孤立した記事でも、現在記事であれば強調する。
 *    data-current-slug が空の場合は中立モード(強調も暗転もなし)で描く。
 *    見た目は「地層(strata)の中を種と根が伸びる」イメージ: 月ごとの帯を地層として塗り分け(古いほど深く濃い)、
 *    境界は波線、記事は種(楕円)、現在記事は芽吹いた種、引用の線は古い層へ伸びる根として描く。
 *    種にマウスを乗せると HTML のツールチップでタイトルと公開日を表示する
 *
 * - ノード: 記事。クリックで記事ページへ遷移する(支援技術向けの名前は aria-label で与える)
 * - エッジ: 引用関係(引用元 → 引用先)。著者が本文リンクで作る人間の層(graph.json の refs、kind: 'human')と、
 *   Hyperstrata の注釈(posts/strata/)から scripts/hyperstrata-sync.mjs が合成する機械の層
 *   (graph.json の inferredRefs、kind: 'inferred')の 2 種類があり、CSS(is-inferred)で破線にして区別する。
 *   機械の層は記事ペイン・タイムラインの列(col)割り当てには参加させず(幹の形は人間の引用だけで決める)、
 *   確定した座標の上に重ねて描く。2 ホップの強調(computeEmphasis)には両方を渡す
 * - graph.json の取得や内容の検証に失敗した場合は console.error に出力し、グラフは描画しない
 *
 * レイアウト計算(buildLayout / buildPaneLayout / buildTimelineLayout / placeTimelineAxis / assignColumns / computeEmphasis / buildStrataBands / strataBoundaryPath)、
 * 無限スクロールで継ぎ足す行の選別(selectNewTimelineRows)と
 * graph.json の検証(parseGraph)は DOM に依存しない純粋関数として window.HyperstrataGraph に公開し、
 * scripts/strata-graph.test.mjs から検証する。
 */
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    /**
     * 記事一覧からグラフのレイアウト(ノード座標・エッジ・年の区切り)を計算する。
     *
     * 新しい記事を上(地表)、古い記事を下(深い層)に置く。y 座標は最新記事からの経過日数 × pixelsPerDay を
     * 基本とし、隣接ノードとの間隔が minGap を下回る場合は minGap まで押し下げる
     * (同日公開の記事が重ならないようにするため)。yearMarks は年ごとの地層の上端(その年で最も新しいノードの位置)。
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, refs: string[], inferredRefs?: Array<{slug: string, type: string}>, icon?: string|null}>} posts
     * @param {{minGap: number, pixelsPerDay: number}} options
     * @returns {{nodes: object[], edges: object[], yearMarks: object[], height: number}}
     */
    function buildLayout(posts, options) {
        const sorted = posts
            .map(function (post) {
                const time = Date.parse(post.publishedAt);
                if (Number.isNaN(time)) {
                    throw new Error('公開日を解釈できません: ' + post.slug + ' (' + post.publishedAt + ')');
                }
                return Object.assign({}, post, {time: time});
            })
            .sort(function (a, b) {
                return b.time - a.time;
            });

        if (sorted.length === 0) {
            return {nodes: [], edges: [], yearMarks: [], height: 0};
        }

        const nodes = [];
        const yearMarks = [];
        const newestTime = sorted[0].time;
        let previousY = -Infinity;
        let previousYear = null;

        sorted.forEach(function (post) {
            const scaledY = ((newestTime - post.time) / MS_PER_DAY) * options.pixelsPerDay;
            const y = Math.max(scaledY, previousY + options.minGap);
            const year = new Date(post.time).getFullYear();
            if (year !== previousYear) {
                yearMarks.push({year: year, y: y});
                previousYear = year;
            }
            nodes.push({slug: post.slug, title: post.title, url: post.url, publishedAt: post.publishedAt, y: y, icon: post.icon || null});
            previousY = y;
        });

        const slugs = new Set(nodes.map(function (node) {
            return node.slug;
        }));
        // 人間の引用(refs)と機械の推定(inferredRefs)の両方からエッジを作る。
        // 同じ組(from, to)を両方が指す場合は、人間の引用を優先し重複エッジを作らない
        // (人間の引用を先に処理してから機械の推定を処理する)。
        const edges = [];
        const edgeKeys = new Set();
        const pushEdge = function (from, to, kind) {
            if (!slugs.has(to) || to === from) {
                return;
            }
            const key = from + '|' + to;
            if (edgeKeys.has(key)) {
                return;
            }
            edgeKeys.add(key);
            edges.push({from: from, to: to, kind: kind});
        };
        sorted.forEach(function (post) {
            post.refs.forEach(function (ref) {
                pushEdge(post.slug, ref, 'human');
            });
            (post.inferredRefs || []).forEach(function (relation) {
                pushEdge(post.slug, relation.slug, 'inferred');
            });
        });

        return {nodes: nodes, edges: edges, yearMarks: yearMarks, height: previousY};
    }

    /**
     * graph.json の内容を検証し、記事配列を取り出す。
     *
     * 必須項目(slug / title / url / publishedAt / refs)が欠けたデータは、描画途中で分かりにくく壊れるより
     * ここで例外にして早期に失敗させる。inferredRefs(Hyperstrata の注釈から合成した機械の層)は
     * 省略可能な項目として扱い、無い場合(旧形式の graph.json)でも壊れないようにする(後方互換)。
     *
     * @param {unknown} data graph.json をパースした値
     * @returns {Array<{slug: string, title: string, url: string, publishedAt: string, refs: string[], inferredRefs?: Array<{slug: string, type: string}>}>}
     */
    function parseGraph(data) {
        if (!data || !Array.isArray(data.posts)) {
            throw new Error('graph.json に posts 配列がありません');
        }
        const stringFields = ['slug', 'title', 'url', 'publishedAt'];
        data.posts.forEach(function (post, index) {
            stringFields.forEach(function (field) {
                if (typeof post[field] !== 'string') {
                    throw new Error('graph.json の posts[' + index + '] に ' + field + ' がありません');
                }
            });
            if (!Array.isArray(post.refs)) {
                throw new Error('graph.json の posts[' + index + '] に refs 配列がありません');
            }
            if (post.inferredRefs !== undefined) {
                if (!Array.isArray(post.inferredRefs)) {
                    throw new Error('graph.json の posts[' + index + '] の inferredRefs は配列である必要があります');
                }
                post.inferredRefs.forEach(function (relation, relationIndex) {
                    if (!relation || typeof relation.slug !== 'string' || typeof relation.type !== 'string') {
                        throw new Error('graph.json の posts[' + index + '].inferredRefs[' + relationIndex + '] に slug/type がありません');
                    }
                });
            }
        });
        return data.posts;
    }

    /**
     * graph.json を低優先度で取得して記事配列を返す。
     *
     * @param {string} url テンプレートが data-strata-graph-url で渡す graph.json の URL
     * @returns {Promise<Array<object>>}
     */
    function loadGraph(url) {
        if (!url) {
            return Promise.reject(new Error('data-strata-graph-url が設定されていません'));
        }
        return fetch(url, {priority: 'low'}).then(function (response) {
            if (!response.ok) {
                throw new Error('graph.json の取得に失敗しました: ' + response.status + ' ' + url);
            }
            return response.json();
        }).then(parseGraph);
    }

    function createElement(name, attributes) {
        const element = document.createElementNS(SVG_NS, name);
        Object.keys(attributes).forEach(function (key) {
            element.setAttribute(key, attributes[key]);
        });
        return element;
    }

    /** 表示用にタイトルを一定文字数で切り詰める(全文は aria-label に持たせる) */
    function truncate(text, maxLength) {
        return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
    }

    /**
     * assignBandIcons の配置結果を、地層に埋まった題材アイコンの層として <g> にまとめる。
     * 装飾のため aria-hidden にし、クリック等を奪わないよう pointer-events は CSS(.gh-strata-band-icons)で消す。
     * window.HyperstrataIcons(assets/js/strata-icons.js)が未知の icon には null を返すため、その場合は何も足さない。
     *
     * @param {Array<{icon: string, x: number, y: number, angle: number}>} placements
     * @param {number} size アイコンの一辺(px)
     * @returns {SVGGElement}
     */
    function buildBandIconGroup(placements, size) {
        const group = createElement('g', {class: 'gh-strata-band-icons', 'aria-hidden': 'true'});
        placements.forEach(function (placement) {
            const icon = window.HyperstrataIcons.createElement(placement.icon, {
                x: placement.x - size / 2,
                y: placement.y - size / 2,
                width: size,
                height: size,
                transform: 'rotate(' + placement.angle + ' ' + placement.x + ' ' + placement.y + ')'
            });
            if (icon) {
                group.appendChild(icon);
            }
        });
        return group;
    }

    /**
     * レイアウトを SVG として描画する。
     *
     * @param {ReturnType<typeof buildLayout>} layout
     * ペインと同じ「地層の中を種と根が伸びる」デザイン: 年ごとの帯を地層として塗り分け(古い年ほど深く濃い)、
     * 境界は波線、記事は種(楕円)、引用の線は古い層へ伸びる根(左に膨らむ弧)として描く。
     *
     * @param {{axisX: number, paddingTop: number, paddingBottom: number, width: number, maxArcWidth: number, nodeRadius: number, yearGap: number, maxDepthShade: number, titleMaxLength: number, label: string}} options
     * @returns {SVGSVGElement}
     */
    function renderSvg(layout, options) {
        const height = layout.height + options.paddingTop + options.paddingBottom;
        const svg = createElement('svg', {
            class: 'gh-strata-svg',
            viewBox: '0 0 ' + options.width + ' ' + height,
            width: options.width,
            height: height,
            'aria-label': options.label
        });
        const nodeY = {};
        layout.nodes.forEach(function (node) {
            nodeY[node.slug] = node.y + options.paddingTop;
        });

        // 地層の帯(年ごと)。境界はその年で最も新しいノードの上に、年ラベルを挟める余白(yearGap)を空けて置く
        const yearMarks = layout.yearMarks.map(function (mark) {
            return {label: String(mark.year), y: mark.y + options.paddingTop - options.yearGap};
        });
        const bands = buildStrataBands(yearMarks, height);
        const bandGroup = createElement('g', {class: 'gh-strata-strata'});
        bands.forEach(function (band) {
            bandGroup.appendChild(createElement('rect', {
                class: 'gh-strata-stratum',
                x: 0, y: band.top, width: options.width, height: band.bottom - band.top,
                'data-depth': String(Math.min(band.depth, options.maxDepthShade))
            }));
        });
        svg.appendChild(bandGroup);

        // 帯の中に埋まった題材アイコン(記事の icon)をランダムな位置に散らす(#26)。
        // ノード(種)とエッジ(引用元 → 引用先の弧)は axisX の左右(axisX - maxArcWidth 〜 axisX + nodeRadius)に
        // 描かれるため、avoid でその範囲を避ける。アイコンは placement.x を中心に一辺 iconSize で描かれるため、
        // 半分(iconSize / 2)ぶん avoid を広げて、アイコンの端まで含めて重ならないようにする。
        // 多すぎると目立つため帯ごとに最大 3 個までに絞る
        const iconSize = 18;
        const iconNodes = layout.nodes.map(function (node) {
            return {slug: node.slug, icon: node.icon, y: nodeY[node.slug]};
        });
        svg.appendChild(buildBandIconGroup(
            assignBandIcons(bands, iconNodes, {
                xMin: 12,
                xMax: options.width - 12,
                marginY: 14,
                avoid: {
                    min: options.axisX - options.maxArcWidth - iconSize / 2,
                    max: options.axisX + options.nodeRadius + iconSize / 2
                },
                maxPerBand: 3
            }),
            iconSize
        ));

        // 地層の境界線(波線)と年ラベル。ラベルは時間軸のすぐ右・境界線の下(その年の帯の内側)に置く
        // (右端に寄せると狭い画面で横スクロールしないと見えなくなるため)
        const yearGroup = createElement('g', {class: 'gh-strata-years'});
        yearMarks.forEach(function (mark, index) {
            yearGroup.appendChild(createElement('path', {
                class: 'gh-strata-year-line',
                d: strataBoundaryPath(mark.y, options.width, {amplitude: 3, wavelength: 48, phase: index})
            }));
            const label = createElement('text', {
                class: 'gh-strata-year',
                x: options.axisX + options.nodeRadius * 2 + 4,
                y: mark.y + 14
            });
            label.textContent = mark.label;
            yearGroup.appendChild(label);
        });
        svg.appendChild(yearGroup);

        // 時間軸(地表から深部へ下りる細い線)
        svg.appendChild(createElement('line', {
            class: 'gh-strata-axis',
            x1: options.axisX, y1: options.paddingTop - options.nodeRadius * 2,
            x2: options.axisX, y2: height - options.paddingBottom + options.nodeRadius * 2
        }));

        // エッジ(引用元 → 引用先)。新しい記事から古い層へ伸びる根として、時間軸の左側に楕円弧で描く
        const edgeGroup = createElement('g', {class: 'gh-strata-edges'});
        layout.edges.forEach(function (edge) {
            const fromY = nodeY[edge.from];
            const toY = nodeY[edge.to];
            const ry = Math.abs(fromY - toY) / 2;
            const rx = Math.min(ry, options.maxArcWidth);
            // 引用元(新しい記事)から引用先(古い記事)へ、左に膨らむ弧を描く
            const sweep = fromY > toY ? 1 : 0;
            const path = createElement('path', {
                class: 'gh-strata-edge' + (edge.kind === 'inferred' ? ' is-inferred' : ''),
                d: 'M ' + options.axisX + ' ' + fromY + ' A ' + rx + ' ' + ry + ' 0 0 ' + sweep + ' ' + options.axisX + ' ' + toY,
                'data-from': edge.from,
                'data-to': edge.to
            });
            edgeGroup.appendChild(path);
        });
        svg.appendChild(edgeGroup);

        // ノード(記事)。<a> で包み、クリックで記事ページへ遷移する
        const nodeGroup = createElement('g', {class: 'gh-strata-nodes'});
        layout.nodes.forEach(function (node) {
            const y = nodeY[node.slug];
            const anchor = createElement('a', {class: 'gh-strata-node', href: node.url, 'data-slug': node.slug, 'aria-label': node.title});
            // 記事は「種」の形(縦長の楕円)で描く
            anchor.appendChild(createElement('ellipse', {
                class: 'gh-strata-dot',
                cx: options.axisX, cy: y, rx: options.nodeRadius, ry: options.nodeRadius * 1.3
            }));
            const title = createElement('text', {
                class: 'gh-strata-title',
                x: options.axisX + options.nodeRadius * 2 + 4,
                y: y + 4
            });
            title.textContent = truncate(node.title, options.titleMaxLength);
            anchor.appendChild(title);
            anchor.addEventListener('mouseenter', function () {
                highlight(svg, node.slug, true);
            });
            anchor.addEventListener('mouseleave', function () {
                highlight(svg, node.slug, false);
            });
            nodeGroup.appendChild(anchor);
        });
        svg.appendChild(nodeGroup);
        return svg;
    }

    /** ノードにマウスを乗せたとき、関係するエッジを強調する */
    function highlight(svg, slug, on) {
        svg.classList.toggle('is-highlighting', on);
        Array.from(svg.querySelectorAll('.gh-strata-edge')).forEach(function (edge) {
            const related = edge.dataset.from === slug || edge.dataset.to === slug;
            edge.classList.toggle('is-active', on && related);
        });
    }

    /**
     * 記事ごとに列(col)を割り当てる(git のブランチ図方式)。列は 0 を中心とした符号付き整数で、
     * 必要になった順に 0, +1, -1, +2, -2, … と外側へ広げる。
     *
     * 新しい記事(row 0)から順に処理し、次の規則で決める。
     * - 列が未定の記事(まだ誰にも引用されていない起点・孤立記事)は、その行で空いている 0 に最も近い列に置く
     * - 記事が引用する相手を近い(新しい)順に見て、列が未定なら引用元の列を継がせる(幹が続く)。
     *   途中の行がすでに別の幹に使われていれば、引用元の列に最も近い空き列に置く(枝分かれ)
     * - 引用先がすでに列を持っていれば何もしない(その幹へ合流する線になる)
     * 幹の区間(引用元の次の行から引用先の行まで)は列の占有として記録し、他の記事や幹が重ならないようにする。
     *
     * @param {Array<{slug: string, row: number}>} nodes 行順(新しい順)のノード
     * @param {Array<{fromRow: number, toRow: number}>} edges fromRow < toRow のエッジ
     * @returns {{cols: number[], minCol: number, maxCol: number}} cols はノードと同じ順の列番号。ノードが無ければ 0..0
     */
    function assignColumns(nodes, edges) {
        const indexOfRow = {};
        nodes.forEach(function (node, index) {
            indexOfRow[node.row] = index;
        });
        const cols = nodes.map(function () {
            return null;
        });
        /** 列番号 → 占有している行区間(両端を含む)の配列 */
        const reserved = {};
        const isFree = function (col, fromRow, toRow) {
            return (reserved[col] || []).every(function (range) {
                return toRow < range.fromRow || range.toRow < fromRow;
            });
        };
        const reserve = function (col, fromRow, toRow) {
            (reserved[col] = reserved[col] || []).push({fromRow: fromRow, toRow: toRow});
        };
        /** center から外側へ向かって、行区間が空いている最初の列を返す */
        const nearestFree = function (center, fromRow, toRow) {
            for (let offset = 0; ; offset += 1) {
                const candidates = offset === 0 ? [center] : [center + offset, center - offset];
                for (let i = 0; i < candidates.length; i += 1) {
                    if (isFree(candidates[i], fromRow, toRow)) {
                        return candidates[i];
                    }
                }
            }
        };
        const outgoing = nodes.map(function () {
            return [];
        });
        edges.forEach(function (edge) {
            outgoing[indexOfRow[edge.fromRow]].push(edge);
        });

        nodes.forEach(function (node, index) {
            if (cols[index] === null) {
                cols[index] = nearestFree(0, node.row, node.row);
                reserve(cols[index], node.row, node.row);
            }
            const col = cols[index];
            outgoing[index].slice().sort(function (a, b) {
                return a.toRow - b.toRow;
            }).forEach(function (edge) {
                const targetIndex = indexOfRow[edge.toRow];
                if (cols[targetIndex] !== null) {
                    return;
                }
                const targetCol = nearestFree(col, node.row + 1, edge.toRow);
                cols[targetIndex] = targetCol;
                reserve(targetCol, node.row + 1, edge.toRow);
            });
        });

        const minCol = cols.reduce(function (min, col) {
            return Math.min(min, col);
        }, 0);
        const maxCol = cols.reduce(function (max, col) {
            return Math.max(max, col);
        }, 0);
        return {cols: cols, minCol: minCol, maxCol: maxCol};
    }

    /** 公開日(ローカル時刻)から月ラベル(YYYY-MM)を作る */
    function monthLabel(time) {
        const date = new Date(time);
        const month = date.getMonth() + 1;
        return date.getFullYear() + '-' + (month < 10 ? '0' : '') + month;
    }

    /**
     * 固定ペイン用のレイアウトを計算する。新しい記事を上(row 0)に並べ、行間は一定(rowHeight)、
     * 月が変わる位置に区切り(monthMarks)を置いて monthGap ぶん余白を空ける。
     *
     * 列(col)の割り当て(assignColumns)は人間の引用(refs)だけで決める。Hyperstrata の注釈から
     * 合成した推定エッジ(inferredRefs)は幹の形に影響させず、確定した行(row)の上に kind: 'inferred'
     * として重ねて描く。
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, refs: string[], inferredRefs?: Array<{slug: string, type: string}>, icon?: string|null}>} posts
     * @param {{rowHeight: number, monthGap: number, paddingTop: number, paddingBottom: number}} options
     * @returns {{nodes: object[], edges: object[], monthMarks: object[], minCol: number, maxCol: number, height: number}}
     *   nodes は col(列番号)、edges は fromCol / toCol(両端の列番号)と kind('human' | 'inferred')を持つ
     */
    function buildPaneLayout(posts, options) {
        const sorted = posts
            .map(function (post) {
                const time = Date.parse(post.publishedAt);
                if (Number.isNaN(time)) {
                    throw new Error('公開日を解釈できません: ' + post.slug + ' (' + post.publishedAt + ')');
                }
                return Object.assign({}, post, {time: time});
            })
            .sort(function (a, b) {
                return b.time - a.time;
            });

        if (sorted.length === 0) {
            return {nodes: [], edges: [], monthMarks: [], minCol: 0, maxCol: 0, height: 0};
        }

        const nodes = [];
        const monthMarks = [];
        const rowOf = {};
        let previousMonth = null;
        let y = options.paddingTop;

        sorted.forEach(function (post, row) {
            const month = monthLabel(post.time);
            if (month !== previousMonth) {
                // 区切りは月の最初のノードの上に置く
                monthMarks.push({label: month, y: y + options.monthGap / 2});
                y += options.monthGap;
                previousMonth = month;
            }
            y += row === 0 ? 0 : options.rowHeight;
            nodes.push({slug: post.slug, title: post.title, url: post.url, publishedAt: post.publishedAt, row: row, y: y, icon: post.icon || null});
            rowOf[post.slug] = row;
        });

        const rawEdges = [];
        sorted.forEach(function (post) {
            post.refs.forEach(function (ref) {
                if (Object.prototype.hasOwnProperty.call(rowOf, ref) && ref !== post.slug) {
                    const fromRow = rowOf[post.slug];
                    const toRow = rowOf[ref];
                    // 引用元は引用先より新しい(上にある)はずだが、同時刻などで逆転した場合も上→下に揃える
                    rawEdges.push({
                        from: post.slug,
                        to: ref,
                        fromRow: Math.min(fromRow, toRow),
                        toRow: Math.max(fromRow, toRow)
                    });
                }
            });
        });
        // 列(col)は人間の引用だけで決める(幹の形が推定エッジで揺れないようにするため)
        const columns = assignColumns(nodes, rawEdges);
        nodes.forEach(function (node, index) {
            node.col = columns.cols[index];
        });
        const edges = rawEdges.map(function (edge) {
            return Object.assign({}, edge, {kind: 'human', fromCol: columns.cols[edge.fromRow], toCol: columns.cols[edge.toRow]});
        });

        // 推定エッジ(inferredRefs)は列の割り当てが終わったあとに、確定した行の座標の上へ重ねて追加する。
        // 人間の引用と同じ組(from, to)を指す場合は人間の引用を優先し、inferredRefs 自体の重複も 1 本にまとめる
        const edgeKeys = new Set(rawEdges.map(function (edge) {
            return edge.from + '|' + edge.to;
        }));
        sorted.forEach(function (post) {
            (post.inferredRefs || []).forEach(function (relation) {
                const ref = relation.slug;
                if (!Object.prototype.hasOwnProperty.call(rowOf, ref) || ref === post.slug) {
                    return;
                }
                const key = post.slug + '|' + ref;
                if (edgeKeys.has(key)) {
                    return;
                }
                edgeKeys.add(key);
                const fromRow = Math.min(rowOf[post.slug], rowOf[ref]);
                const toRow = Math.max(rowOf[post.slug], rowOf[ref]);
                edges.push({
                    from: post.slug,
                    to: ref,
                    fromRow: fromRow,
                    toRow: toRow,
                    kind: 'inferred',
                    fromCol: columns.cols[fromRow],
                    toCol: columns.cols[toRow]
                });
            });
        });

        const lanes = assignDetourLanes(nodes, edges);
        return {
            nodes: nodes,
            edges: edges,
            monthMarks: monthMarks,
            minCol: Math.min(columns.minCol, lanes.minCol),
            maxCol: Math.max(columns.maxCol, lanes.maxCol),
            height: y + options.paddingBottom
        };
    }

    /**
     * エッジが途中の行のノードの上を通らないように、迂回する列(viaCol)を割り当てる。
     *
     * paneEdgePath はエッジを「上のノードから 1 行ぶんの S 字で引用先の列(toCol)へ移り、そのまま縦に下る」形で描くため、
     * 縦の区間(toCol の fromRow + 1 .. toRow - 1)に別のノードがあると線が種の上を通ってしまう。
     * 列(col)の割り当て(assignColumns)は人間の引用だけで決めるので、これは主に推定エッジ(inferredRefs)で起きる。
     * そうしたエッジには、途中の行にノードが無く、直進するエッジの縦の区間(人間の幹)とも重ならない列を
     * toCol に近い順に探して viaCol として持たせる。迂回エッジ同士は同じ列を共有してよい(列を分けると幅が広がりすぎる)。paneEdgePath は viaCol があれば上で viaCol へ移り、
     * 下で toCol へ戻る。迂回しないエッジには viaCol を付けない(edges は破壊的に更新する)。
     *
     * @param {Array<{row: number, col: number}>} nodes
     * @param {Array<{fromRow: number, toRow: number, fromCol: number, toCol: number, kind: string, viaCol?: number}>} edges
     * @returns {{minCol: number, maxCol: number}} 迂回に使った列の範囲(無ければ 0..0)
     */
    function assignDetourLanes(nodes, edges) {
        /** 列番号 → その列にノードがある行の集合 */
        const nodeRows = {};
        nodes.forEach(function (node) {
            (nodeRows[node.col] = nodeRows[node.col] || new Set()).add(node.row);
        });
        /** 列番号 → 線の縦の区間(両端を含む)の配列 */
        const laneRanges = {};
        const overlaps = function (col, fromRow, toRow) {
            return (laneRanges[col] || []).some(function (range) {
                return fromRow <= range.toRow && range.fromRow <= toRow;
            });
        };
        const hasNode = function (col, fromRow, toRow) {
            return Array.from(nodeRows[col] || []).some(function (row) {
                return fromRow <= row && row <= toRow;
            });
        };
        const reserveLane = function (col, fromRow, toRow) {
            (laneRanges[col] = laneRanges[col] || []).push({fromRow: fromRow, toRow: toRow});
        };

        // 直進できるエッジの縦の区間を先に占有させ、迂回エッジが幹の上に乗らないようにする。
        // 人間の引用を先に処理し、推定エッジは残った列を使う
        const needsDetour = [];
        edges.slice().sort(function (a, b) {
            return (a.kind === 'inferred' ? 1 : 0) - (b.kind === 'inferred' ? 1 : 0);
        }).forEach(function (edge) {
            const interiorFrom = edge.fromRow + 1;
            const interiorTo = edge.toRow - 1;
            if (interiorFrom > interiorTo || !hasNode(edge.toCol, interiorFrom, interiorTo)) {
                reserveLane(edge.toCol, interiorFrom, edge.toRow);
                return;
            }
            needsDetour.push(edge);
        });

        let minCol = 0;
        let maxCol = 0;
        needsDetour.forEach(function (edge) {
            const interiorFrom = edge.fromRow + 1;
            const interiorTo = edge.toRow - 1;
            for (let offset = 1; ; offset += 1) {
                const candidates = [edge.toCol + offset, edge.toCol - offset];
                const found = candidates.filter(function (col) {
                    return !hasNode(col, interiorFrom, interiorTo) && !overlaps(col, interiorFrom, interiorTo);
                })[0];
                if (found !== undefined) {
                    // 迂回エッジ同士は同じ列を共有してよい(別の列にするとペインの幅が広がりすぎるため)
                    edge.viaCol = found;
                    minCol = Math.min(minCol, found);
                    maxCol = Math.max(maxCol, found);
                    break;
                }
            }
        });
        return {minCol: minCol, maxCol: maxCol};
    }

    /**
     * トップページの地層タイムライン(partials/strata-timeline.hbs)向けのレイアウトを計算する。
     *
     * 行(記事カード)はテンプレートが公開日の降順で出力し、JS が DOM から計測した位置(top / bottom / y)を渡す。
     * ここでは行の位置は動かさず、連続する同じ月の行を地層の帯(bands)にまとめ、graph.json の引用関係のうち
     * 表示中の行どうしのものをエッジ(edges)にし、表示中に無い記事への引用は行ごとの本数(offPage)として数える。
     * 列(col)は固定ペインと同じ assignColumns で決め、引用チェーンが 1 本の幹として同じ列を継ぐようにする。
     * ただし assignColumns は分岐を +1(右)側から使うため、ここでは列の符号を反転して分岐を左(ガターの余白側)へ出す。
     * 幹(列 0)の右は記事カードの文字なので、根が文字に重ならないようにするため。
     * graph.json に無い行(同期前の新しい記事)は引用の無い孤立した記事として扱う。
     * 列(col)は人間の引用(refs)だけで決め、Hyperstrata の注釈から合成した推定エッジ(inferredRefs)は
     * 列確定後に kind: 'inferred' として重ねて追加する。offPage(ページ外への束)も人間の引用のみ数える。
     *
     * @param {Array<{slug: string, month: string, top: number, bottom: number, y: number}>} rows 表示順(新しい順)の行
     * @param {Array<{slug: string, refs: string[], inferredRefs?: Array<{slug: string, type: string}>, icon?: string|null}>} posts graph.json の記事一覧
     * @returns {{bands: object[], nodes: object[], edges: object[], offPage: object[]}}
     */
    function buildTimelineLayout(rows, posts) {
        const refsOf = {};
        const inferredRefsOf = {};
        const iconOf = {};
        posts.forEach(function (post) {
            refsOf[post.slug] = post.refs;
            inferredRefsOf[post.slug] = post.inferredRefs || [];
            iconOf[post.slug] = post.icon || null;
        });
        const rowOf = {};
        rows.forEach(function (row, index) {
            rowOf[row.slug] = index;
        });

        const bands = [];
        rows.forEach(function (row) {
            const last = bands[bands.length - 1];
            if (last && last.label === row.month) {
                last.bottom = row.bottom;
            } else {
                bands.push({label: row.month, top: row.top, bottom: row.bottom, depth: bands.length});
            }
        });

        const nodes = rows.map(function (row, index) {
            return {slug: row.slug, row: index, y: row.y, icon: iconOf[row.slug] || null};
        });
        const rawEdges = [];
        const offPage = [];
        rows.forEach(function (row, index) {
            let outside = 0;
            (refsOf[row.slug] || []).forEach(function (ref) {
                if (ref === row.slug) {
                    return;
                }
                if (!Object.prototype.hasOwnProperty.call(rowOf, ref)) {
                    outside += 1;
                    return;
                }
                const target = rowOf[ref];
                // 引用元は引用先より新しい(上にある)はずだが、同時刻などで逆転した場合も上→下に揃える
                rawEdges.push({from: row.slug, to: ref, fromRow: Math.min(index, target), toRow: Math.max(index, target)});
            });
            if (outside > 0) {
                offPage.push({slug: row.slug, row: index, count: outside});
            }
        });
        // 分岐を左へ出すため列の符号を反転する(-0 を避けるため 0 はそのまま)
        const cols = assignColumns(nodes, rawEdges).cols.map(function (col) {
            return col === 0 ? 0 : -col;
        });
        nodes.forEach(function (node, index) {
            node.col = cols[index];
        });
        const edges = rawEdges.map(function (edge) {
            return Object.assign({}, edge, {kind: 'human', fromCol: cols[edge.fromRow], toCol: cols[edge.toRow]});
        });

        // 推定エッジ(inferredRefs)は列の割り当てが終わったあとに重ねて追加する。
        // offPage(ページ外への束)は人間の引用のみを数えているため、ここでは対象外にする。
        // 人間の引用と同じ組(from, to)を指す場合は人間の引用を優先し、inferredRefs 自体の重複も 1 本にまとめる
        const edgeKeys = new Set(rawEdges.map(function (edge) {
            return edge.from + '|' + edge.to;
        }));
        rows.forEach(function (row, index) {
            (inferredRefsOf[row.slug] || []).forEach(function (relation) {
                const ref = relation.slug;
                if (ref === row.slug || !Object.prototype.hasOwnProperty.call(rowOf, ref)) {
                    return;
                }
                const key = row.slug + '|' + ref;
                if (edgeKeys.has(key)) {
                    return;
                }
                edgeKeys.add(key);
                const target = rowOf[ref];
                const fromRow = Math.min(index, target);
                const toRow = Math.max(index, target);
                edges.push({from: row.slug, to: ref, fromRow: fromRow, toRow: toRow, kind: 'inferred', fromCol: cols[fromRow], toCol: cols[toRow]});
            });
        });

        return {bands: bands, nodes: nodes, edges: edges, offPage: offPage};
    }

    /**
     * タイムラインの軸(列 0)の x 座標と列幅を決める。
     *
     * 軸はガターの右端(laneRight、記事カードの文字のすぐ左)に固定し、次ページを継ぎ足して左の枝が増えても
     * 種の位置が跳ねないようにする。正の列(右の枝)がある場合だけ、右端の列が laneRight に収まるよう軸を左へずらす。
     * 列の総数が laneLeft(月ラベルの右端)〜laneRight に収まらない場合は列幅を縮めて収める。
     *
     * @param {{minCol: number, maxCol: number, laneLeft: number, laneRight: number, laneWidth: number}} options
     * @returns {{axisX: number, laneWidth: number}}
     */
    function placeTimelineAxis(options) {
        const span = options.maxCol - options.minCol;
        const available = options.laneRight - options.laneLeft;
        const laneWidth = span > 0 ? Math.min(options.laneWidth, available / span) : options.laneWidth;
        return {axisX: options.laneRight - options.maxCol * laneWidth, laneWidth: laneWidth};
    }

    /**
     * 無限スクロールで取得した次ページの行のうち、タイムラインに継ぎ足す行の添字を返す。
     *
     * 取得の合間に記事が公開されるとページ境界がずれ、表示済みの記事が次ページの先頭に再び現れる。
     * 同じ slug の行が 2 つあると buildTimelineLayout の slug → 行の対応が壊れるため、表示済みの slug と
     * 次ページ内で既に採用した slug は除外する。
     *
     * @param {string[]} existingSlugs 表示済みの行の slug
     * @param {string[]} incomingSlugs 次ページの行の slug(表示順)
     * @returns {number[]} 継ぎ足す行の添字(incomingSlugs 上の位置、昇順)
     */
    function selectNewTimelineRows(existingSlugs, incomingSlugs) {
        const seen = new Set(existingSlugs);
        const indexes = [];
        incomingSlugs.forEach(function (slug, index) {
            if (seen.has(slug)) {
                return;
            }
            seen.add(slug);
            indexes.push(index);
        });
        return indexes;
    }

    /**
     * 現在の記事から引用の向きを問わず maxHops ホップ以内にあるノード・エッジの距離を求める。
     *
     * 現在記事の存在はノード一覧で判定する。引用が一本も無い孤立した記事でも、ノードとして存在すれば
     * 距離 0(現在記事)として強調され、他のノード・エッジはすべて暗くなる。
     *
     * @param {Array<{slug: string}>} nodes グラフ上の全ノード
     * @param {Array<{from: string, to: string}>} edges
     * @param {string} currentSlug
     * @param {number} maxHops
     * @returns {{neutral: boolean, nodes: Object<string, number>, edges: Array<number|null>}} nodes は到達したノードの距離、
     *   edges は入力順のエッジ距離(両端ノードの近いほうの距離 + 1。到達しない場合は -1)。
     *   currentSlug が空(トップページなど現在記事が無い場合)は中立モード(neutral: true)となり、
     *   nodes は空、edges はすべて null で、何も強調せず何も暗くしない
     */
    function computeEmphasis(nodes, edges, currentSlug, maxHops) {
        if (!currentSlug) {
            return {
                neutral: true,
                nodes: {},
                edges: edges.map(function () {
                    return null;
                })
            };
        }
        const neighbors = {};
        const known = nodes.some(function (node) {
            return node.slug === currentSlug;
        });
        edges.forEach(function (edge) {
            (neighbors[edge.from] = neighbors[edge.from] || []).push(edge.to);
            (neighbors[edge.to] = neighbors[edge.to] || []).push(edge.from);
        });
        const distance = {};
        if (known) {
            distance[currentSlug] = 0;
            const queue = [currentSlug];
            while (queue.length > 0) {
                const slug = queue.shift();
                if (distance[slug] >= maxHops) {
                    continue;
                }
                (neighbors[slug] || []).forEach(function (next) {
                    if (!Object.prototype.hasOwnProperty.call(distance, next)) {
                        distance[next] = distance[slug] + 1;
                        queue.push(next);
                    }
                });
            }
        }
        const edgeDistances = edges.map(function (edge) {
            const candidates = [edge.from, edge.to].filter(function (slug) {
                return Object.prototype.hasOwnProperty.call(distance, slug);
            }).map(function (slug) {
                return distance[slug] + 1;
            });
            if (candidates.length === 0) {
                return -1;
            }
            const value = Math.min.apply(null, candidates);
            return value > maxHops ? -1 : value;
        });
        return {neutral: false, nodes: distance, edges: edgeDistances};
    }

    /** 列番号を SVG の x 座標に変換する(列 0 が axisX) */
    function columnX(col, options) {
        return options.axisX + col * options.laneWidth;
    }

    /**
     * ペイン用エッジのパスを作る。両端が同じ列なら幹として直線で結ぶ。列が違う場合は、上のノードから
     * 1 行ぶんの S 字で相手の列へ移り、そのまま縦に下って下のノードへ届く(git のブランチ図の枝分かれ・合流の見た目)。
     * viaCol(assignDetourLanes が付ける迂回列)があれば、上で viaCol へ S 字で移って縦に下り、下で 1 行ぶんの S 字で
     * 相手の列へ戻ってから下のノードへ届く。
     * ノード座標は nodeY(slug → y)から引き、fromRow < toRow に揃えてあるため fromCol が上、toCol が下になる。
     */
    function paneEdgePath(edge, nodeY, options) {
        const xTop = columnX(edge.fromCol, options);
        const xBottom = columnX(edge.toCol, options);
        const xLane = edge.viaCol === undefined ? xBottom : columnX(edge.viaCol, options);
        const top = Math.min(nodeY[edge.from], nodeY[edge.to]);
        const bottom = Math.max(nodeY[edge.from], nodeY[edge.to]);
        if (xTop === xLane && xLane === xBottom) {
            return 'M ' + xTop + ' ' + top + ' L ' + xTop + ' ' + bottom;
        }
        const bend = options.rowHeight;
        // 制御点を縦方向の中間に置き、行き過ぎのない滑らかな S 字で相手の列へ移る
        const half = bend / 2;
        let path = 'M ' + xTop + ' ' + top;
        if (xTop !== xLane) {
            path += ' C ' + xTop + ' ' + (top + half) + ' ' + xLane + ' ' + (top + half) + ' ' + xLane + ' ' + (top + bend);
        }
        if (xLane === xBottom) {
            return path + ' L ' + xBottom + ' ' + bottom;
        }
        return path +
            ' L ' + xLane + ' ' + (bottom - bend) +
            ' C ' + xLane + ' ' + (bottom - half) + ' ' + xBottom + ' ' + (bottom - half) + ' ' + xBottom + ' ' + bottom;
    }

    /**
     * 月の区切り(monthMarks)の間を「地層」の帯として切り出す。上の帯ほど新しく(浅く)、
     * 下の帯ほど古い(深い)。depth は上から 0, 1, 2, … と増え、CSS で深さに応じた色の濃さに使う。
     *
     * @param {Array<{label: string, y: number}>} monthMarks 上から順に並んだ月の区切り
     * @param {number} height SVG 全体の高さ(最後の帯の下端)
     * @returns {Array<{label: string, top: number, bottom: number, depth: number}>}
     */
    function buildStrataBands(monthMarks, height) {
        return monthMarks.map(function (mark, index) {
            const next = monthMarks[index + 1];
            return {
                label: mark.label,
                top: mark.y,
                bottom: next ? next.y : height,
                depth: index
            };
        });
    }

    /** 文字列から 32bit の決定的なハッシュ値を作る(FNV-1a)。slug ごとの乱数の種にする */
    function hashSeed(text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    /** 決定的な疑似乱数生成器(mulberry32)。同じ seed からは常に同じ数列を返す */
    function mulberry32(seed) {
        let state = seed >>> 0;
        return function () {
            state = (state + 0x6D2B79F5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** アイコンの回転角度の範囲(度)。埋蔵物のように傾ける。真逆さまにはしない */
    const ICON_ANGLE_RANGE = 30;

    /**
     * [xMin, xMax] の中から avoid(ノード・エッジの描画領域)を避けて x 座標を 1 つ選ぶ。
     * avoid が範囲の片側・両側に隙間を残す場合はその隙間だけから選び、隙間が無ければ諦めて全体から選ぶ。
     *
     * @param {() => number} random 0以上1未満の決定的な乱数生成関数
     * @param {number} xMin
     * @param {number} xMax
     * @param {{min: number, max: number}|null|undefined} avoid
     * @returns {number}
     */
    function pickIconX(random, xMin, xMax, avoid) {
        const width = Math.max(0, xMax - xMin);
        if (!avoid) {
            return xMin + random() * width;
        }
        const leftEdge = Math.max(xMin, Math.min(avoid.min, xMax));
        const leftWidth = Math.max(0, leftEdge - xMin);
        const rightEdge = Math.min(xMax, Math.max(avoid.max, xMin));
        const rightWidth = Math.max(0, xMax - rightEdge);
        const total = leftWidth + rightWidth;
        if (total <= 0) {
            return xMin + random() * width;
        }
        const picked = random() * total;
        return picked < leftWidth ? xMin + picked : rightEdge + (picked - leftWidth);
    }

    /**
     * 帯(地層)ごとに、icon(題材アイコン)を持つノードをその帯の中のランダムな位置・角度に散らして配置する。
     * 「地層の中に埋まっている」見た目にするための飾りで、ノード自身の座標(種の位置)とは無関係に置く。
     *
     * 位置・角度は slug から決定的に計算する(Math.random は使わない)ため、無限スクロールや画面リサイズで
     * 描き直しても同じ記事のアイコンは同じ位置・角度のまま跳ねない。
     *
     * @param {Array<{top: number, bottom: number}>} bands 上から順に並んだ帯(重ならない前提。最後の帯だけ bottom を含む)
     * @param {Array<{slug: string, y: number, icon?: string|null}>} nodes
     * @param {{xMin: number, xMax: number, marginY: number, avoid?: {min: number, max: number}|null, maxPerBand?: number}} options
     *   x は [xMin, xMax] の範囲(avoid を渡すとその内側を避ける)、y は帯の上下から marginY を除いた範囲に収める。
     *   maxPerBand を渡すと、1つの帯に置くアイコン数をその上限までに絞る(多すぎて目立つのを防ぐ)。
     *   絞り込みは候補ノードそれぞれの slug から決定的に計算した値で選ぶため、他の候補の有無に左右されない
     * @returns {Array<{slug: string, icon: string, x: number, y: number, angle: number}>}
     */
    function assignBandIcons(bands, nodes, options) {
        const placements = [];
        bands.forEach(function (band, index) {
            const isLast = index === bands.length - 1;
            let candidates = nodes.filter(function (node) {
                if (!node.icon) {
                    return false;
                }
                return isLast ?
                    (node.y >= band.top && node.y <= band.bottom) :
                    (node.y >= band.top && node.y < band.bottom);
            });
            if (typeof options.maxPerBand === 'number' && candidates.length > options.maxPerBand) {
                candidates = candidates.slice().sort(function (a, b) {
                    // slug から決定的に計算した優先度で並べ替え、上位だけを残す
                    return mulberry32(hashSeed(a.slug))() - mulberry32(hashSeed(b.slug))();
                }).slice(0, options.maxPerBand);
            }
            candidates.forEach(function (node) {
                const random = mulberry32(hashSeed(node.slug));
                const minY = band.top + options.marginY;
                const maxY = Math.max(minY, band.bottom - options.marginY);
                placements.push({
                    slug: node.slug,
                    icon: node.icon,
                    x: pickIconX(random, options.xMin, options.xMax, options.avoid),
                    y: minY + random() * (maxY - minY),
                    angle: -ICON_ANGLE_RANGE + random() * ICON_ANGLE_RANGE * 2
                });
            });
        });
        return placements;
    }

    /**
     * ノード配列が使っている列(col)の最小値・最大値を返す。
     * assignBandIcons の avoid にノード・エッジの占有範囲を渡すために使う。
     *
     * @param {Array<{col: number}>} nodes
     * @returns {{min: number, max: number}|null} ノードが無ければ null
     */
    function columnExtent(nodes) {
        if (nodes.length === 0) {
            return null;
        }
        return nodes.reduce(function (range, node) {
            return {min: Math.min(range.min, node.col), max: Math.max(range.max, node.col)};
        }, {min: nodes[0].col, max: nodes[0].col});
    }

    /**
     * 地層の境界線を、まっすぐな直線ではなく緩やかにうねる波線のパスとして作る。
     * 二次ベジェ曲線を wavelength ごとに上下交互に膨らませて繋ぐ。
     * phase(0 以上の整数)で膨らみの向きをずらし、隣り合う境界線が同じ形にならないようにする。
     *
     * @param {number} y 境界線の基準となる y 座標
     * @param {number} width 線の右端(x)
     * @param {{amplitude: number, wavelength: number, phase?: number}} options
     * @returns {string} SVG path の d 属性
     */
    function strataBoundaryPath(y, width, options) {
        const phase = options.phase || 0;
        let d = 'M 0 ' + y;
        let x = 0;
        let index = 0;
        while (x < width) {
            const nextX = Math.min(x + options.wavelength, width);
            const direction = (index + phase) % 2 === 0 ? -1 : 1;
            const controlX = x + (nextX - x) / 2;
            d += ' Q ' + controlX + ' ' + (y + direction * options.amplitude) + ' ' + nextX + ' ' + y;
            x = nextX;
            index += 1;
        }
        return d;
    }

    /** 距離に応じた強調クラス名を返す(0: 現在記事、1: 直接の引用、2: 2 ホップ、-1: 無関係、null: 中立モードで強調なし) */
    function emphasisClass(distance) {
        if (distance === null) {
            return '';
        }
        if (distance < 0) {
            return ' is-dim';
        }
        return ' is-level-' + distance;
    }

    /**
     * 現在記事の種から伸びる「芽」(茎と双葉)のパスを作る。baseY は種の上端、size は芽の高さ。
     *
     * @param {number} x 茎の x 座標
     * @param {number} baseY 芽の付け根の y 座標
     * @param {number} size 芽の高さ(px)
     * @returns {string} SVG path の d 属性
     */
    function sproutPath(x, baseY, size) {
        const topY = baseY - size;
        const leaf = size * 0.55;
        return 'M ' + x + ' ' + baseY + ' L ' + x + ' ' + topY +
            ' M ' + x + ' ' + (topY + leaf * 0.6) +
            ' Q ' + (x - leaf) + ' ' + (topY + leaf * 0.5) + ' ' + (x - leaf * 0.9) + ' ' + (topY - leaf * 0.35) +
            ' Q ' + (x - leaf * 0.2) + ' ' + (topY - leaf * 0.1) + ' ' + x + ' ' + (topY + leaf * 0.6) +
            ' M ' + x + ' ' + (topY + leaf * 0.2) +
            ' Q ' + (x + leaf) + ' ' + (topY + leaf * 0.1) + ' ' + (x + leaf * 0.9) + ' ' + (topY - leaf * 0.75) +
            ' Q ' + (x + leaf * 0.2) + ' ' + (topY - leaf * 0.5) + ' ' + x + ' ' + (topY + leaf * 0.2);
    }

    /**
     * 固定ペイン用のレイアウトを SVG として描画する。
     *
     * @param {ReturnType<typeof buildPaneLayout>} layout
     * @param {ReturnType<typeof computeEmphasis>} emphasis
     * @param {{axisX: number, laneWidth: number, rowHeight: number, width: number, nodeRadius: number, maxDepthShade: number, bleed: number, label: string, dateLocale: string}} options
     *   axisX は列 0 の x 座標、laneWidth は列の間隔(px)。maxDepthShade は地層の色の濃さの段階数の上限(CSS の data-depth と一致させる)、bleed は地層をペイン端まで届かせるための左右のはみ出し幅(px)
     */
    function renderPaneSvg(layout, emphasis, options) {
        const svg = createElement('svg', {
            class: 'gh-strata-pane-svg',
            viewBox: '0 0 ' + options.width + ' ' + layout.height,
            width: options.width,
            height: layout.height,
            'aria-label': options.label
        });
        const nodeY = {};
        layout.nodes.forEach(function (node) {
            nodeY[node.slug] = node.y;
        });

        // 地層の帯。月ごとの区切りの間を塗り分け、深い(古い)層ほど濃くする(色は CSS の data-depth で決める)。
        // SVG はペイン中央に置かれるため、帯と境界線は bleed ぶん左右にはみ出させてペインの端まで届かせる
        // (SVG は overflow: visible、ペインのスクロール領域が overflow-x: hidden で切り取る)
        const bleedWidth = options.width + options.bleed * 2;
        const paneBands = buildStrataBands(layout.monthMarks, layout.height);
        const bandGroup = createElement('g', {class: 'gh-strata-pane-strata', transform: 'translate(' + (-options.bleed) + ' 0)'});
        paneBands.forEach(function (band) {
            bandGroup.appendChild(createElement('rect', {
                class: 'gh-strata-pane-stratum',
                x: 0, y: band.top, width: bleedWidth, height: band.bottom - band.top,
                'data-depth': String(Math.min(band.depth, options.maxDepthShade))
            }));
        });
        svg.appendChild(bandGroup);

        // 帯の中に埋まった題材アイコン(記事の icon)をランダムな位置に散らす(#26)。
        // 表示幅(bleed していない範囲)に収め、ペインのスクロール領域からはみ出さないようにする。
        // ノード(種)と幹・根(エッジ)が使う列(col)の範囲は avoid で避ける。アイコンは placement.x を中心に
        // 一辺 paneIconSize で描かれるため、半分(paneIconSize / 2)ぶん avoid を広げてアイコンの端まで重ならないようにする。
        // 多すぎると目立つため帯ごとに最大 3 個までに絞る
        const paneIconSize = 14;
        // 列の範囲は layout.minCol / maxCol を使い、迂回した根(viaCol)の列も避ける
        const paneAvoid = {
            min: columnX(layout.minCol, options) - options.nodeRadius - paneIconSize / 2,
            max: columnX(layout.maxCol, options) + options.nodeRadius + paneIconSize / 2
        };
        svg.appendChild(buildBandIconGroup(
            assignBandIcons(paneBands, layout.nodes, {
                xMin: 12,
                xMax: options.width - 12,
                marginY: 10,
                avoid: paneAvoid,
                maxPerBand: 3
            }),
            paneIconSize
        ));

        // 地層の境界線(緩やかな波線)とラベル。ラベルは境界線の下(その月の帯の内側)に置き、右端に寄せる
        const monthGroup = createElement('g', {class: 'gh-strata-pane-months'});
        layout.monthMarks.forEach(function (mark, index) {
            monthGroup.appendChild(createElement('path', {
                class: 'gh-strata-pane-month-line',
                transform: 'translate(' + (-options.bleed) + ' 0)',
                d: strataBoundaryPath(mark.y, bleedWidth, {amplitude: 2.5, wavelength: 36, phase: index})
            }));
            const label = createElement('text', {
                class: 'gh-strata-pane-month-label',
                x: options.width - 8,
                y: mark.y + 14
            });
            label.textContent = mark.label;
            monthGroup.appendChild(label);
        });
        svg.appendChild(monthGroup);

        // エッジ。強調するものが上に重なるように、無関係 → 遠い → 近い の順で追加する
        const edgeGroup = createElement('g', {class: 'gh-strata-pane-edges'});
        layout.edges.map(function (edge, index) {
            return {edge: edge, distance: emphasis.edges[index]};
        }).sort(function (a, b) {
            const rank = function (distance) {
                return distance === null || distance < 0 ? Infinity : distance;
            };
            return rank(b.distance) - rank(a.distance);
        }).forEach(function (item) {
            edgeGroup.appendChild(createElement('path', {
                class: 'gh-strata-pane-edge' + emphasisClass(item.distance) + (item.edge.kind === 'inferred' ? ' is-inferred' : ''),
                d: paneEdgePath(item.edge, nodeY, options),
                'data-from': item.edge.from,
                'data-to': item.edge.to
            }));
        });
        svg.appendChild(edgeGroup);

        // ノード。<a> で包み、<title> でタイトルと公開日をツールチップ表示する
        const nodeGroup = createElement('g', {class: 'gh-strata-pane-nodes'});
        layout.nodes.forEach(function (node) {
            // 中立モード(トップページ)では全ノードを標準色で描き、現在記事の輪も付けない
            const distance = emphasis.neutral ? null :
                (Object.prototype.hasOwnProperty.call(emphasis.nodes, node.slug) ? emphasis.nodes[node.slug] : -1);
            const anchor = createElement('a', {
                class: 'gh-strata-pane-node' + emphasisClass(distance),
                href: node.url,
                'data-slug': node.slug
            });
            if (distance === 0) {
                anchor.setAttribute('aria-current', 'page');
            }
            // ツールチップは HTML 側(showTooltip)で出すため、支援技術向けの名前は aria-label で与える
            const dateText = new Date(node.publishedAt).toLocaleDateString(options.dateLocale);
            anchor.setAttribute('aria-label', node.title + ' (' + dateText + ')');
            anchor.setAttribute('data-title', node.title);
            anchor.setAttribute('data-date', dateText);
            const x = columnX(node.col, options);
            if (distance === 0) {
                // 現在の記事は「芽吹いた種」として、輪と芽(茎と双葉)をつける
                anchor.appendChild(createElement('circle', {
                    class: 'gh-strata-pane-ring',
                    cx: x, cy: node.y, r: options.nodeRadius + 4
                }));
                anchor.appendChild(createElement('path', {
                    class: 'gh-strata-pane-sprout',
                    d: sproutPath(x, node.y - options.nodeRadius - 4, options.nodeRadius * 2.5)
                }));
            }
            // ノードは「種」の形(縦長の楕円)で描く
            anchor.appendChild(createElement('ellipse', {
                class: 'gh-strata-pane-dot',
                cx: x, cy: node.y, rx: options.nodeRadius, ry: options.nodeRadius * 1.3
            }));
            nodeGroup.appendChild(anchor);
        });
        svg.appendChild(nodeGroup);
        return svg;
    }

    /**
     * ノード(種)にマウスを乗せた・フォーカスしたときに、記事のタイトルと公開日を HTML のツールチップで表示する。
     * SVG の <title> は表示までの遅延が長く狭いペインでは読みづらいため、ペイン内に絶対配置した要素を使う。
     * ツールチップはペインの座標系(fixed)に対して置くため、スクロール領域に切り取られない。
     */
    function setupTooltip(pane, svg) {
        const tooltip = document.createElement('div');
        tooltip.className = 'gh-strata-pane-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.hidden = true;
        const title = document.createElement('span');
        title.className = 'gh-strata-pane-tooltip-title';
        const date = document.createElement('span');
        date.className = 'gh-strata-pane-tooltip-date';
        tooltip.appendChild(title);
        tooltip.appendChild(date);
        pane.appendChild(tooltip);

        const show = function (anchor) {
            title.textContent = anchor.getAttribute('data-title');
            date.textContent = anchor.getAttribute('data-date');
            const dot = anchor.querySelector('.gh-strata-pane-dot');
            const dotRect = dot.getBoundingClientRect();
            const paneRect = pane.getBoundingClientRect();
            tooltip.hidden = false;
            tooltip.style.left = (dotRect.right - paneRect.left + 10) + 'px';
            // ツールチップの縦中央を種に合わせる(表示後に高さが確定するので hidden 解除後に計算する)
            const top = dotRect.top + dotRect.height / 2 - paneRect.top - tooltip.offsetHeight / 2;
            tooltip.style.top = Math.max(4, Math.min(top, paneRect.height - tooltip.offsetHeight - 4)) + 'px';
        };
        const hide = function () {
            tooltip.hidden = true;
        };
        Array.from(svg.querySelectorAll('.gh-strata-pane-node')).forEach(function (anchor) {
            anchor.addEventListener('mouseenter', function () {
                show(anchor);
            });
            anchor.addEventListener('focus', function () {
                show(anchor);
            });
            anchor.addEventListener('mouseleave', hide);
            anchor.addEventListener('blur', hide);
        });
        // スクロール中は位置がずれるので隠す
        pane.querySelector('[data-strata-scroll]').addEventListener('scroll', hide, {passive: true});
    }

    /** ペインの開閉(狭い画面向け)。aria-expanded と is-open クラスを同期する */
    function setupPaneToggle(pane) {
        const toggle = pane.querySelector('[data-strata-toggle]');
        if (!toggle) {
            return;
        }
        toggle.addEventListener('click', function () {
            const open = !pane.classList.contains('is-open');
            pane.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
        });
    }

    /** 記事ページ左側の固定ペインを初期化する(data-current-slug が空なら中立モードで描く) */
    function initPane() {
        const pane = document.querySelector('[data-strata-pane]');
        if (!pane) {
            return;
        }
        setupPaneToggle(pane);
        loadGraph(pane.dataset.strataGraphUrl).then(function (posts) {
            renderPane(pane, posts);
        }).catch(function (error) {
            console.error('[Hyperstrata] 引用グラフペインを描画できません:', error);
        });
    }

    /** 取得した記事配列からペインの SVG を描画してスクロール領域に挿入する */
    function renderPane(pane, posts) {
        if (posts.length === 0) {
            return;
        }
        const rowHeight = 26;
        const layout = buildPaneLayout(posts, {rowHeight: rowHeight, monthGap: 30, paddingTop: 24, paddingBottom: 48});
        const emphasis = computeEmphasis(layout.nodes, layout.edges, pane.dataset.currentSlug || '', 2);
        const laneWidth = 12;
        const padding = 24;
        // 列 0 を中心に左右へ広がるため、最も左の列が padding の位置に来るように列 0 の x を決める
        const svg = renderPaneSvg(layout, emphasis, {
            axisX: padding - layout.minCol * laneWidth,
            laneWidth: laneWidth,
            rowHeight: rowHeight,
            width: padding + (layout.maxCol - layout.minCol + 1) * laneWidth + 72,
            nodeRadius: 4,
            maxDepthShade: 6,
            bleed: 400,
            label: pane.dataset.strataLabel || '',
            dateLocale: document.documentElement.lang || undefined
        });
        const scroll = pane.querySelector('[data-strata-scroll]');
        scroll.appendChild(svg);
        pane.classList.add('is-rendered');
        setupTooltip(pane, svg);

        // 現在の記事がペインの中央に来るようにスクロールしておく
        const current = layout.nodes.filter(function (node) {
            return node.slug === pane.dataset.currentSlug;
        })[0];
        if (current) {
            scroll.scrollTop = Math.max(0, current.y - scroll.clientHeight / 2);
        }
    }

    /**
     * タイムラインの各行(記事カード)の位置を DOM から計測する。座標は行リスト(list)の上端を 0 とする。
     * 種の y はタイトルの 1 行目の中心に合わせる(タイトルが複数行に折り返しても種が上にずれないようにするため)。
     *
     * @param {HTMLElement} list [data-strata-rows]
     * @returns {Array<{slug: string, month: string, top: number, bottom: number, y: number}>}
     */
    function measureTimelineRows(list) {
        const listTop = list.getBoundingClientRect().top;
        return Array.from(list.querySelectorAll('[data-strata-row]')).map(function (row) {
            const rect = row.getBoundingClientRect();
            const title = row.querySelector('[data-strata-row-title]');
            const titleRect = title.getBoundingClientRect();
            const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
            const firstLine = Number.isNaN(lineHeight) ? titleRect.height : Math.min(lineHeight, titleRect.height);
            return {
                slug: row.dataset.slug,
                month: row.dataset.month,
                top: rect.top - listTop,
                bottom: rect.bottom - listTop,
                y: titleRect.top - listTop + firstLine / 2
            };
        });
    }

    /**
     * タイムラインのレイアウトを SVG として描画する。行リストの背後に重ねるため、大きさは行リストと同じにする。
     *
     * @param {ReturnType<typeof buildTimelineLayout>} layout
     * @param {{width: number, height: number, labelWidth: number, axisX: number, laneWidth: number, bend: number, nodeRadius: number, maxDepthShade: number, bleed: number, label: string, offPageLabel: string, compact: boolean}} options
     *   labelWidth は月ラベル列の幅、axisX は列 0 の x 座標、bend は根が隣の列へ移るときの縦の長さ(px)、
     *   bleed は地層を画面の端まで届かせるための左右のはみ出し幅(px)、compact は狭い画面向け(月ラベルを帯の左上に小さく置く)
     */
    function renderTimelineSvg(layout, options) {
        const svg = createElement('svg', {
            class: 'gh-strata-timeline-svg',
            viewBox: '0 0 ' + options.width + ' ' + options.height,
            width: options.width,
            height: options.height,
            'aria-label': options.label
        });
        const fadeId = 'gh-strata-timeline-fade';
        const defs = createElement('defs', {});
        const gradient = createElement('linearGradient', {id: fadeId, x1: '0', y1: '0', x2: '0', y2: '1'});
        gradient.appendChild(createElement('stop', {offset: '0', class: 'gh-strata-timeline-fade-start'}));
        gradient.appendChild(createElement('stop', {offset: '1', class: 'gh-strata-timeline-fade-end'}));
        defs.appendChild(gradient);
        svg.appendChild(defs);

        // 地層の帯と境界線(見た目は固定ペインと同じクラスを使う)。画面の端まで届かせるため bleed ぶん左右にはみ出させる
        const bleedWidth = options.width + options.bleed * 2;
        const bandGroup = createElement('g', {class: 'gh-strata-timeline-strata', transform: 'translate(' + (-options.bleed) + ' 0)'});
        layout.bands.forEach(function (band, index) {
            bandGroup.appendChild(createElement('rect', {
                class: 'gh-strata-pane-stratum',
                x: 0, y: band.top, width: bleedWidth, height: band.bottom - band.top,
                'data-depth': String(Math.min(band.depth, options.maxDepthShade))
            }));
            bandGroup.appendChild(createElement('path', {
                class: 'gh-strata-pane-month-line',
                d: strataBoundaryPath(band.top, bleedWidth, {amplitude: 3, wavelength: 48, phase: index})
            }));
        });
        svg.appendChild(bandGroup);

        const laneOptions = {axisX: options.axisX, laneWidth: options.laneWidth, rowHeight: options.bend};

        // 帯の中に埋まった題材アイコン(記事の icon)をランダムな位置に散らす(#26)。
        // labelWidth より右(記事カードの表示領域)に収め、月ラベルに重ならないようにする。
        // compact(狭い画面)では月ラベルが帯の左上(x: 4, y: band.top + 14)に乗るため、
        // 上端の marginY を広げてその位置にアイコンが被らないようにする。
        // ノード(種)・幹・根(エッジ)・ページ外への束が使う列(col)の範囲は avoid で避ける。アイコンは
        // placement.x を中心に一辺 timelineIconSize で描かれるため、半分(timelineIconSize / 2)ぶん avoid を
        // 広げてアイコンの端まで重ならないようにする。多すぎると目立つため帯ごとに最大 3 個までに絞る
        const timelineIconSize = options.compact ? 14 : 16;
        const timelineColumns = columnExtent(layout.nodes);
        const timelineMinCol = timelineColumns && (layout.offPage.length > 0 ? timelineColumns.min - 1 : timelineColumns.min);
        const timelineAvoid = timelineColumns && {
            min: columnX(timelineMinCol, laneOptions) - options.nodeRadius - timelineIconSize / 2,
            max: columnX(timelineColumns.max, laneOptions) + options.nodeRadius + timelineIconSize / 2
        };
        svg.appendChild(buildBandIconGroup(
            assignBandIcons(layout.bands, layout.nodes, {
                xMin: options.labelWidth + 8,
                xMax: options.width - 8,
                marginY: options.compact ? 26 : 10,
                avoid: timelineAvoid,
                maxPerBand: 3
            }),
            timelineIconSize
        ));

        // 月ラベル。通常は月ラベル列の右端に寄せ、狭い画面では帯の左上に小さく置く
        const labelGroup = createElement('g', {class: 'gh-strata-timeline-months'});
        layout.bands.forEach(function (band) {
            const label = createElement('text', options.compact ?
                {class: 'gh-strata-timeline-month-label is-compact', x: 4, y: band.top + 14} :
                {class: 'gh-strata-timeline-month-label', x: options.labelWidth - 12, y: band.top + 24});
            label.textContent = band.label.replace('-', '.');
            labelGroup.appendChild(label);
        });
        svg.appendChild(labelGroup);

        const nodeY = {};
        layout.nodes.forEach(function (node) {
            nodeY[node.slug] = node.y;
        });

        // 主軸(列 0)。最初の種から最後の種まで薄い線で結ぶ
        if (layout.nodes.length > 0) {
            svg.appendChild(createElement('line', {
                class: 'gh-strata-timeline-axis',
                x1: options.axisX, y1: layout.nodes[0].y,
                x2: options.axisX, y2: layout.nodes[layout.nodes.length - 1].y
            }));
        }

        // 根(表示中の行どうしの引用線)
        const edgeGroup = createElement('g', {class: 'gh-strata-timeline-edges'});
        layout.edges.forEach(function (edge) {
            edgeGroup.appendChild(createElement('path', {
                class: 'gh-strata-pane-edge' + (edge.kind === 'inferred' ? ' is-inferred' : ''),
                d: paneEdgePath(edge, nodeY, laneOptions)
            }));
        });
        svg.appendChild(edgeGroup);

        // ページ外(表示中に無い古い記事)への根。使われている列の左隣(記事カードの文字と反対側)を 1 本の束として
        // 下端までフェードさせ、本数をラベルで示す。この列は renderTimeline が placeTimelineAxis の minCol に含めて確保する
        if (layout.offPage.length > 0) {
            const minCol = layout.nodes.reduce(function (min, node) {
                return Math.min(min, node.col);
            }, 0);
            const offX = columnX(minCol - 1, laneOptions);
            const offGroup = createElement('g', {class: 'gh-strata-timeline-offpage'});
            layout.offPage.forEach(function (item) {
                const node = layout.nodes[item.row];
                const fromX = columnX(node.col, laneOptions);
                const half = options.bend / 2;
                offGroup.appendChild(createElement('path', {
                    class: 'gh-strata-timeline-offpage-edge',
                    stroke: 'url(#' + fadeId + ')',
                    d: 'M ' + fromX + ' ' + node.y +
                        ' C ' + fromX + ' ' + (node.y + half) + ' ' + offX + ' ' + (node.y + half) + ' ' + offX + ' ' + (node.y + options.bend) +
                        ' L ' + offX + ' ' + options.height
                }));
            });
            const total = layout.offPage.reduce(function (sum, item) {
                return sum + item.count;
            }, 0);
            const label = createElement('text', {
                class: 'gh-strata-timeline-offpage-label',
                x: offX - 10,
                y: options.height - 6,
                'text-anchor': 'end'
            });
            label.textContent = options.offPageLabel.replace('%', String(total));
            offGroup.appendChild(label);
            svg.appendChild(offGroup);
        }

        // 種(記事)。カードのタイトル 1 行目に合わせて置く
        const nodeGroup = createElement('g', {class: 'gh-strata-timeline-nodes'});
        layout.nodes.forEach(function (node) {
            nodeGroup.appendChild(createElement('ellipse', {
                class: 'gh-strata-pane-dot',
                cx: columnX(node.col, laneOptions), cy: node.y,
                rx: options.nodeRadius, ry: options.nodeRadius * 1.3
            }));
        });
        svg.appendChild(nodeGroup);
        return svg;
    }

    /**
     * トップページの地層タイムラインを初期化する。
     * 画面幅が変わると行の位置も変わるため、リサイズのたびに描き直す。無限スクロールで行が増えたときも描き直す。
     * 無限スクロールは graph.json の取得とは独立に動かし、graph.json が読めなくても記事一覧の継ぎ足しは続ける
     */
    function initTimeline() {
        const container = document.querySelector('[data-strata-timeline]');
        if (!container) {
            return;
        }
        let posts = null;
        const redraw = function () {
            if (posts !== null) {
                renderTimeline(container, posts);
            }
        };
        loadGraph(container.dataset.strataGraphUrl).then(function (loaded) {
            posts = loaded;
            redraw();
            let pending = null;
            window.addEventListener('resize', function () {
                if (pending !== null) {
                    cancelAnimationFrame(pending);
                }
                pending = requestAnimationFrame(function () {
                    pending = null;
                    redraw();
                });
            });
        }).catch(function (error) {
            console.error('[Hyperstrata] 地層タイムラインを描画できません:', error);
        });
        initTimelinePager(container, redraw);
    }

    /** [data-strata-more] が画面下端からこの距離(px)に近づいたら次ページを読み始める */
    const PAGER_MARGIN = 400;

    /**
     * タイムラインの無限スクロールを初期化する。
     *
     * 末尾の [data-strata-more](JavaScript 無効時は次ページへのリンク)が画面に近づいたら次ページを継ぎ足す。
     * 継ぎ足してもなお [data-strata-more] が画面内に残る場合(行が少ない・画面が高い)は続けて次ページを読む。
     * 次ページが無くなる、または取得に失敗したら監視をやめ、[data-strata-more] を外す
     * (失敗時にリンクを残しても同じ URL で失敗するだけのため。原因は console.error に出す)。
     *
     * @param {HTMLElement} container [data-strata-timeline]
     * @param {() => void} onAppend 行を継ぎ足した後に SVG を描き直すコールバック
     */
    function initTimelinePager(container, onAppend) {
        const sentinel = container.querySelector('[data-strata-more]');
        if (!sentinel) {
            return;
        }
        if (!document.querySelector('link[rel=next]')) {
            sentinel.remove();
            return;
        }
        const list = container.querySelector('[data-strata-rows]');
        const isNear = function () {
            return sentinel.getBoundingClientRect().top <= window.innerHeight + PAGER_MARGIN;
        };
        let loading = false;
        const finish = function () {
            observer.disconnect();
            sentinel.remove();
        };
        const observer = new IntersectionObserver(function (entries) {
            if (loading || !entries.some(function (entry) {
                return entry.isIntersecting;
            })) {
                return;
            }
            loading = true;
            const loadWhileNear = function () {
                if (!isNear() || !document.querySelector('link[rel=next]')) {
                    return Promise.resolve();
                }
                return loadNextTimelinePage(list).then(function () {
                    onAppend();
                    return loadWhileNear();
                });
            };
            loadWhileNear().then(function () {
                if (!document.querySelector('link[rel=next]')) {
                    finish();
                }
            }).catch(function (error) {
                console.error('[Hyperstrata] 次のページを読み込めません:', error);
                finish();
            }).then(function () {
                loading = false;
            });
        }, {rootMargin: PAGER_MARGIN + 'px 0px'});
        observer.observe(sentinel);
    }

    /**
     * link[rel=next] の URL を fetch し、次ページのタイムラインの行を行リストの末尾に継ぎ足す。
     * link[rel=next] は取得したページの link[rel=next] に付け替え、次ページが無ければ外す。
     *
     * @param {HTMLElement} list [data-strata-rows]
     * @returns {Promise<void>}
     */
    function loadNextTimelinePage(list) {
        const link = document.querySelector('link[rel=next]');
        return fetch(link.href).then(function (response) {
            if (!response.ok) {
                throw new Error('次のページの取得に失敗しました: ' + response.status + ' ' + link.href);
            }
            return response.text();
        }).then(function (html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const incoming = Array.from(doc.querySelectorAll('[data-strata-rows] > [data-strata-row]'));
            if (incoming.length === 0) {
                throw new Error('次のページにタイムラインの行がありません: ' + link.href);
            }
            const existingSlugs = Array.from(list.querySelectorAll('[data-strata-row]')).map(function (row) {
                return row.dataset.slug;
            });
            const incomingSlugs = incoming.map(function (row) {
                return row.dataset.slug;
            });
            const fragment = document.createDocumentFragment();
            selectNewTimelineRows(existingSlugs, incomingSlugs).forEach(function (index) {
                fragment.appendChild(document.importNode(incoming[index], true));
            });
            list.appendChild(fragment);

            const nextLink = doc.querySelector('link[rel=next]');
            if (nextLink && nextLink.href) {
                link.href = nextLink.href;
            } else {
                link.remove();
            }
        });
    }

    /** 行の位置を計測してタイムラインの SVG を描画し、行リストの背後に差し込む(既に描いてあれば描き直す) */
    function renderTimeline(container, posts) {
        const list = container.querySelector('[data-strata-rows]');
        const previous = list.querySelector('.gh-strata-timeline-svg');
        if (previous) {
            previous.remove();
        }
        const rows = measureTimelineRows(list);
        if (rows.length === 0) {
            return;
        }
        const layout = buildTimelineLayout(rows, posts);
        const compact = list.clientWidth < 600;
        const styles = getComputedStyle(list);
        const labelWidth = compact ? 0 : parseFloat(styles.getPropertyValue('--strata-timeline-label-width'));
        const gutter = parseFloat(styles.getPropertyValue('--strata-timeline-gutter'));
        if (Number.isNaN(labelWidth) || Number.isNaN(gutter)) {
            throw new Error('--strata-timeline-label-width / --strata-timeline-gutter を CSS から読み取れません');
        }
        const cols = layout.nodes.map(function (node) {
            return node.col;
        });
        // 軸は記事カードの文字のすぐ左に固定し、枝は月ラベルとの間(左)へ広げる。ページ外への根の束はさらに左隣の列を使う
        const axis = placeTimelineAxis({
            minCol: Math.min.apply(null, cols.concat([0])) - (layout.offPage.length > 0 ? 1 : 0),
            maxCol: Math.max.apply(null, cols.concat([0])),
            laneLeft: labelWidth + (compact ? 8 : 12),
            laneRight: gutter - (compact ? 20 : 36),
            laneWidth: compact ? 12 : 16
        });
        const svg = renderTimelineSvg(layout, {
            width: list.clientWidth,
            height: list.clientHeight,
            labelWidth: labelWidth,
            axisX: axis.axisX,
            laneWidth: axis.laneWidth,
            bend: 40,
            nodeRadius: compact ? 4 : 5,
            maxDepthShade: 6,
            bleed: 2000,
            label: container.dataset.strataLabel || '',
            offPageLabel: container.dataset.strataOffpageLabel || '+%',
            compact: compact
        });
        list.insertBefore(svg, list.firstChild);
        container.classList.add('is-rendered');
    }

    /** custom-strata.hbs の固定ページ用グラフを初期化する */
    function init() {
        const container = document.querySelector('[data-strata]');
        if (!container) {
            return;
        }
        loadGraph(container.dataset.strataGraphUrl).then(function (posts) {
            renderPage(container, posts);
        }).catch(function (error) {
            console.error('[Hyperstrata] 引用グラフを描画できません:', error);
        });
    }

    /** 取得した記事配列から固定ページ用の SVG を描画してコンテナに挿入する */
    function renderPage(container, posts) {
        if (posts.length === 0) {
            return;
        }
        const layout = buildLayout(posts, {minGap: 44, pixelsPerDay: 1.5});
        const svg = renderSvg(layout, {
            axisX: 180,
            width: 720,
            paddingTop: 40,
            paddingBottom: 24,
            maxArcWidth: 160,
            nodeRadius: 6,
            yearGap: 34,
            maxDepthShade: 6,
            titleMaxLength: 32,
            label: container.dataset.strataLabel || ''
        });
        const figure = document.createElement('div');
        figure.className = 'gh-strata-graph';
        figure.appendChild(svg);
        container.appendChild(figure);
        container.classList.add('is-rendered');
    }

    window.HyperstrataGraph = {
        buildLayout: buildLayout,
        buildPaneLayout: buildPaneLayout,
        buildTimelineLayout: buildTimelineLayout,
        selectNewTimelineRows: selectNewTimelineRows,
        placeTimelineAxis: placeTimelineAxis,
        assignColumns: assignColumns,
        computeEmphasis: computeEmphasis,
        buildStrataBands: buildStrataBands,
        strataBoundaryPath: strataBoundaryPath,
        assignBandIcons: assignBandIcons,
        columnExtent: columnExtent,
        paneEdgePath: paneEdgePath,
        parseGraph: parseGraph
    };

    if (typeof document !== 'undefined') {
        // 本文の表示を優先するため、ブラウザが手隙になってから初期化する(未対応ブラウザは setTimeout で代替)
        const start = function () {
            const schedule = window.requestIdleCallback || function (callback) {
                setTimeout(callback, 0);
            };
            schedule(function () {
                init();
                initPane();
                initTimeline();
            });
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    }
})();
