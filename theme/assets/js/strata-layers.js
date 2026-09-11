/**
 * Hyperstrata 上の層・下の層(本文下の他記事へのリンク)ビュー(#42)
 *
 * partials/strata-layers.hbs は直上・直下の記事と人間の引用(#ref-<slug> タグ)を JavaScript 無しで
 * 「Layers above(後の記事)」「Layers below(前の記事)」の 2 グループに描画する。
 * このスクリプトはそれを次の順で仕上げる。
 *   1. サーバーが描画した行を読み取り、同じ slug の行(直下の記事が引用先でもある等)を 1 行に統合し、
 *      現在記事に近い順に並べ替え、各行に経過日数(N days later / earlier)を書き込む
 *   2. scripts/hyperstrata-sync.mjs が assets/graph.json に合成する研究者の注釈を fetch し、
 *      - 発掘記録(Excavation record): 現在記事の summary を <details> の折りたたみで出し、発掘者(annotator)と
 *        発掘日(annotatedAt)を添える
 *      - 現在記事の inferredRefs(過去記事との関係)を下の層に、現在記事を inferredRefs に持つ後の記事を上の層に、
 *        関係の種類(continues / revisits / updates)のバッジと理由(reason)付きで足す(既存の行があれば統合する)
 * 記事本文(immutable)は書き換えず、研究者の札を上に置く形で前後の層との関係を見せる。
 *
 * - 手順 1 は graph.json に依存しないため同期的に行い、graph.json の取得や検証に失敗しても
 *   統合・並べ替え・経過日数は残る(失敗は console.error に出力する)
 * - posts/strata/private/(限定記事の注釈)は summary と reason が sops で暗号化されており graph.json では null に
 *   なるため、発掘記録は出さず、関係は種類・タイトル・URL だけの行として足す
 * - 本文の表示を優先するため graph.json の fetch は requestIdleCallback で遅らせ低優先度で行う
 *   (assets/js/strata-graph.js と同じ URL のため 2 回目の fetch はブラウザの HTTP キャッシュから返る)
 * - 表示データの組み立て(buildLayersView)と経過日数(formatGap)は DOM に依存しない純粋関数として
 *   window.HyperstrataLayers に公開し、scripts/strata-layers.test.mjs から検証する
 * - graph.json の題材アイコン(icon)は地層グラフの遊びのイラストであり、リンク集には出さない
 */
(function () {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    /** バッジの表示順(直上直下 → 引用 → 注釈の種類)。既知でないバッジは末尾に元の順で置く */
    const BADGE_ORDER = ['adjacent', 'cites', 'cited-by', 'continues', 'revisits', 'updates'];

    /** 注釈の種類の表示ラベル(テンプレートの data-label-* が無い場合の既定) */
    const BADGE_LABELS = {
        continues: 'Continues',
        revisits: 'Revisits',
        updates: 'Updates'
    };

    /**
     * 現在記事と相手の公開日時から経過日数の文言を作る。
     * 相手が新しければ later、古ければ earlier の文言を使い、1 日のときは単数形(oneLater / oneEarlier)を使う。
     * 日数は assets/js/strata-graph.js の不整合面(hiatus)と同じく四捨五入する。
     *
     * @param {string} currentIso 現在記事の公開日時(ISO 8601)
     * @param {string} otherIso 相手の公開日時(ISO 8601)
     * @param {{later: string, earlier: string, oneLater: string, oneEarlier: string}} labels 文言(% を日数に置き換える)
     * @returns {string|null} 文言。日時が解釈できなければ null
     */
    function formatGap(currentIso, otherIso, labels) {
        const current = Date.parse(currentIso);
        const other = Date.parse(otherIso);
        if (Number.isNaN(current) || Number.isNaN(other)) {
            return null;
        }
        const diff = other - current;
        const days = Math.round(Math.abs(diff) / MS_PER_DAY);
        if (days === 1) {
            return diff >= 0 ? labels.oneLater : labels.oneEarlier;
        }
        const label = diff >= 0 ? labels.later : labels.earlier;
        return label.replace('%', String(days));
    }

    /**
     * バッジを BADGE_ORDER の順に並べ、重複を除く。
     *
     * @param {string[]} badges
     * @returns {string[]}
     */
    function sortBadges(badges) {
        const unique = badges.filter(function (badge, index) {
            return badges.indexOf(badge) === index;
        });
        return unique.sort(function (a, b) {
            const ia = BADGE_ORDER.indexOf(a);
            const ib = BADGE_ORDER.indexOf(b);
            return (ia < 0 ? BADGE_ORDER.length : ia) - (ib < 0 ? BADGE_ORDER.length : ib);
        });
    }

    /**
     * 1 つのグループ(上の層または下の層)に行を追加する。同じ slug の行があればバッジと理由を統合する。
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, badges: string[], reason: string|null}>} rows
     * @param {{slug: string, title: string, url: string, publishedAt: string, badges: string[], reason?: string|null}} row
     */
    function mergeRow(rows, row) {
        const existing = rows.find(function (candidate) {
            return candidate.slug === row.slug;
        });
        if (existing) {
            existing.badges = existing.badges.concat(row.badges);
            existing.reason = existing.reason || row.reason || null;
            return;
        }
        rows.push({
            slug: row.slug,
            title: row.title,
            url: row.url,
            publishedAt: row.publishedAt,
            badges: row.badges.slice(),
            reason: row.reason || null
        });
    }

    /**
     * 注釈の関係 1 件を行の形にする。
     *
     * @param {{type: string, reason?: string|null}} ref inferredRefs の 1 要素
     * @param {{slug: string, title: string, url: string, publishedAt: string}} post 行にする記事
     * @returns {{slug: string, title: string, url: string, publishedAt: string, badges: string[], reason: string|null}}
     */
    function toRow(ref, post) {
        return {
            slug: post.slug,
            title: post.title,
            url: post.url,
            publishedAt: post.publishedAt,
            badges: [ref.type],
            reason: ref.reason || null
        };
    }

    /**
     * サーバーが描画した行と graph.json の注釈から、発掘記録と上の層・下の層の表示データを組み立てる。
     *
     * - record: 現在記事の summary・annotator・annotatedAt。summary が無い記事(注釈が無い、または
     *   posts/strata/private/ 由来で暗号化されている)は null にして発掘記録を出さない
     * - above: サーバー項目の above に、現在記事を inferredRefs に持つ後の記事を統合し、公開日の昇順(現在記事に近い順)に並べる
     * - below: サーバー項目の below に、現在記事の inferredRefs の関係先を統合し、公開日の降順(現在記事に近い順)に並べる
     * - 関係先が posts に無い関係は無視し、currentSlug が posts に無ければサーバー項目だけを返す
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, inferredRefs?: Array<{slug: string, type: string, reason: string|null}>, summary?: string|null, annotator?: string|null, annotatedAt?: string|null}>} posts graph.json の記事配列
     * @param {string} currentSlug 現在表示中の記事の slug
     * @param {{above: Array<object>, below: Array<object>}} serverItems サーバーが描画した行(slug・title・url・publishedAt・badges)
     * @returns {{record: {summary: string, annotator: string|null, annotatedAt: string|null}|null, above: Array<object>, below: Array<object>}}
     */
    function buildLayersView(posts, currentSlug, serverItems) {
        if (!Array.isArray(posts)) {
            throw new Error('posts は配列である必要があります');
        }
        const above = [];
        const below = [];
        (serverItems.above || []).forEach(function (row) {
            mergeRow(above, row);
        });
        (serverItems.below || []).forEach(function (row) {
            mergeRow(below, row);
        });

        const postBySlug = {};
        posts.forEach(function (post) {
            postBySlug[post.slug] = post;
        });
        const current = currentSlug ? postBySlug[currentSlug] : null;
        let record = null;
        if (current) {
            record = current.summary ? {
                summary: current.summary,
                annotator: current.annotator || null,
                annotatedAt: current.annotatedAt || null
            } : null;
            (current.inferredRefs || []).forEach(function (ref) {
                const target = postBySlug[ref.slug];
                if (target) {
                    mergeRow(below, toRow(ref, target));
                }
            });
            posts.forEach(function (post) {
                (post.inferredRefs || []).forEach(function (ref) {
                    if (ref.slug === currentSlug) {
                        mergeRow(above, toRow(ref, post));
                    }
                });
            });
        }

        const byPublished = function (direction) {
            return function (a, b) {
                return a.publishedAt < b.publishedAt ? -direction : (a.publishedAt > b.publishedAt ? direction : 0);
            };
        };
        above.sort(byPublished(1));
        below.sort(byPublished(-1));
        [above, below].forEach(function (rows) {
            rows.forEach(function (row) {
                row.badges = sortBadges(row.badges);
            });
        });
        return {record: record, above: above, below: below};
    }

    /**
     * graph.json を低優先度で取得して記事配列を返す。
     *
     * @param {string} url data-strata-graph-url で渡される graph.json の URL
     * @returns {Promise<Array<object>>}
     */
    function loadPosts(url) {
        if (!url) {
            return Promise.reject(new Error('data-strata-graph-url が設定されていません'));
        }
        return fetch(url, {priority: 'low'}).then(function (response) {
            if (!response.ok) {
                throw new Error('graph.json の取得に失敗しました: ' + response.status + ' ' + url);
            }
            return response.json();
        }).then(function (data) {
            if (!data || !Array.isArray(data.posts)) {
                throw new Error('graph.json に posts 配列がありません');
            }
            return data.posts;
        });
    }

    /**
     * グループの <ul> からサーバーが描画した行を読み取る。
     *
     * @param {HTMLUListElement} list
     * @returns {Array<{slug: string, title: string, url: string, publishedAt: string, badges: string[]}>}
     */
    function readRows(list) {
        return Array.prototype.map.call(list.querySelectorAll('li[data-slug]'), function (item) {
            const link = item.querySelector('a');
            const time = item.querySelector('time');
            return {
                slug: item.dataset.slug,
                title: link ? link.textContent : '',
                url: link ? link.getAttribute('href') : '',
                publishedAt: time ? time.getAttribute('datetime') : '',
                badges: Array.prototype.map.call(item.querySelectorAll('[data-strata-badge]'), function (badge) {
                    return badge.dataset.strataBadge;
                })
            };
        });
    }

    /**
     * バッジの表示ラベルを返す。adjacent はグループ(上の層 / 下の層)で文言が変わる。
     *
     * @param {DOMStringMap} labels セクションの data-label-*
     * @param {string} badge
     * @param {'above'|'below'} group
     * @returns {string}
     */
    function badgeLabel(labels, badge, group) {
        if (badge === 'adjacent') {
            return (group === 'above' ? labels.labelAdjacentAbove : labels.labelAdjacentBelow) || badge;
        }
        const key = 'label' + badge.split('-').map(function (part) {
            return part.charAt(0).toUpperCase() + part.slice(1);
        }).join('');
        return labels[key] || BADGE_LABELS[badge] || badge;
    }

    /**
     * 1 行を <li> として描画する。
     *
     * @param {{slug: string, title: string, url: string, publishedAt: string, badges: string[], reason: string|null}} row
     * @param {HTMLElement} section
     * @param {'above'|'below'} group
     * @returns {HTMLLIElement}
     */
    function renderRow(row, section, group) {
        const labels = section.dataset;
        const item = document.createElement('li');
        item.className = 'gh-strata-layer';
        item.dataset.slug = row.slug;

        const badges = document.createElement('span');
        badges.className = 'gh-strata-layer-badges';
        row.badges.forEach(function (badge) {
            const span = document.createElement('span');
            span.className = 'gh-strata-badge';
            span.dataset.strataBadge = badge;
            span.textContent = badgeLabel(labels, badge, group);
            badges.appendChild(span);
        });
        item.appendChild(badges);

        const link = document.createElement('a');
        link.className = 'gh-strata-layer-title';
        link.href = row.url;
        link.textContent = row.title;
        item.appendChild(link);

        const meta = document.createElement('span');
        meta.className = 'gh-strata-layer-meta';
        const time = document.createElement('time');
        time.setAttribute('datetime', row.publishedAt);
        time.textContent = new Date(row.publishedAt).toLocaleDateString(document.documentElement.lang || undefined);
        meta.appendChild(time);
        const gap = document.createElement('span');
        gap.setAttribute('data-strata-layer-gap', '');
        const gapText = formatGap(labels.currentPublished, row.publishedAt, {
            later: labels.labelLater || '',
            earlier: labels.labelEarlier || '',
            oneLater: labels.labelOneLater || '',
            oneEarlier: labels.labelOneEarlier || ''
        });
        if (gapText !== null) {
            gap.textContent = gapText;
        }
        meta.appendChild(gap);
        item.appendChild(meta);

        if (row.reason) {
            const reason = document.createElement('span');
            reason.className = 'gh-strata-layer-reason';
            reason.textContent = row.reason;
            item.appendChild(reason);
        }
        return item;
    }

    /**
     * 発掘記録([data-strata-record] の <details>)へ要約と発掘者・発掘日を描画し、表示する。
     * 発掘日は <time datetime> に ISO 8601 を入れ、表示はページの言語(html の lang)の日付書式にする。
     *
     * @param {HTMLElement} section
     * @param {{summary: string, annotator: string|null, annotatedAt: string|null}|null} record
     */
    function renderRecord(section, record) {
        const details = section.querySelector('[data-strata-record]');
        if (!details || !record) {
            return;
        }
        const summary = details.querySelector('[data-strata-record-summary]');
        const meta = details.querySelector('[data-strata-record-meta]');
        if (!summary || !meta) {
            return;
        }
        summary.textContent = record.summary;
        meta.textContent = '';
        if (record.annotator) {
            const annotator = document.createElement('span');
            annotator.className = 'gh-strata-record-annotator';
            annotator.textContent = (meta.dataset.labelAnnotator ? meta.dataset.labelAnnotator + ' ' : '') + record.annotator;
            meta.appendChild(annotator);
        }
        if (record.annotatedAt) {
            const time = document.createElement('time');
            time.className = 'gh-strata-record-date';
            time.setAttribute('datetime', record.annotatedAt);
            time.textContent = new Date(record.annotatedAt).toLocaleDateString(document.documentElement.lang || undefined);
            meta.appendChild(time);
        }
        details.hidden = false;
    }

    /**
     * セクションへ発掘記録と上の層・下の層を描画する(各グループの <ul> は作り直す)。
     * 行が無いグループ/セクションは CSS(:has)が隠す。
     *
     * @param {HTMLElement} section
     * @param {{record: object|null, above: Array<object>, below: Array<object>}} view
     */
    function render(section, view) {
        renderRecord(section, view.record);
        ['above', 'below'].forEach(function (group) {
            const list = section.querySelector('[data-strata-layers-group="' + group + '"] [data-strata-layers-list]');
            if (!list) {
                return;
            }
            list.textContent = '';
            view[group].forEach(function (row) {
                list.appendChild(renderRow(row, section, group));
            });
        });
    }

    /**
     * セクションからサーバーが描画した行を読み取る。
     *
     * @param {HTMLElement} section
     * @returns {{above: Array<object>, below: Array<object>}}
     */
    function readServerItems(section) {
        const items = {above: [], below: []};
        ['above', 'below'].forEach(function (group) {
            const list = section.querySelector('[data-strata-layers-group="' + group + '"] [data-strata-layers-list]');
            if (list) {
                items[group] = readRows(list);
            }
        });
        return items;
    }

    function init() {
        const section = document.querySelector('[data-strata-layers]');
        if (!section) {
            return;
        }
        const currentSlug = section.dataset.currentSlug || '';
        const serverItems = readServerItems(section);
        // 手順 1: graph.json を待たずに統合・並べ替え・経過日数を反映する
        render(section, buildLayersView([], currentSlug, serverItems));
        const schedule = window.requestIdleCallback || function (callback) {
            return window.setTimeout(callback, 1);
        };
        // 手順 2: 研究者の注釈を足す
        schedule(function () {
            loadPosts(section.dataset.strataGraphUrl).then(function (posts) {
                render(section, buildLayersView(posts, currentSlug, serverItems));
            }).catch(function (error) {
                console.error('[strata-layers] ' + error.message);
            });
        });
    }

    if (typeof window !== 'undefined') {
        window.HyperstrataLayers = {
            buildLayersView: buildLayersView,
            formatGap: formatGap
        };
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();
