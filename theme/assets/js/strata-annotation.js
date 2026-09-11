/**
 * Hyperstrata 注釈(記事末尾の発掘記録と関連記事: 過去記事との関係)ビュー
 *
 * scripts/hyperstrata-sync.mjs が assets/graph.json に合成する summary(要約)・annotator(発掘者)・
 * annotatedAt(発掘日)・inferredRefs(関係先・種類・理由)を fetch で読み取り、post.hbs の
 * gh-citations(References / Cited by)の直後にある [data-strata-annotation] セクションへ描画する。
 *   - Excavation record(発掘記録): 現在記事の summary を <details> の折りたたみで出し、末尾に
 *                    発掘者名と発掘日を添える(考古学の発掘記録のように「研究者がいつ読んで何と要約したか」を掲示する)
 *   - Related posts: 現在記事の inferredRefs(現在記事から過去記事への関係)
 *   - Later posts:   現在記事を inferredRefs に持つ後の記事(逆引き。人間の層の Cited by に相当し、
 *                    古い記事を読んでいる人に「後の記事で更新(updates)・再訪(revisits)された」と知らせる)
 * 記事本文(immutable)は書き換えず、研究者の札を上に置く形で後の層との関係を見せる。
 * URL はテンプレートが data-strata-graph-url({{asset "graph.json"}})で渡す。
 * 本文の表示を優先するため、初期化は requestIdleCallback で遅らせ、fetch は低優先度で行う
 * (assets/js/strata-graph.js と同じ方針。graph.json は同一 URL のため 2 回目の fetch は
 * ブラウザの HTTP キャッシュから返る)。
 *
 * - posts/strata/private/(限定記事の注釈)は summary と reason が sops で暗号化されており、
 *   hyperstrata-sync.mjs は復号しないため、graph.json では summary と inferredRefs[].reason が null になる。
 *   その場合、発掘記録は出さず(record: null)、関係は種類・タイトル・URL だけの一覧として表示する
 * - 発掘記録も関係も無いグループは非表示のままにし、すべて無い記事(注釈が無い/機械の層が無い/
 *   後の記事から参照されていない)ではセクションごと非表示のままにする
 * - graph.json の取得や内容の検証に失敗した場合は console.error に出力し、何も表示しない
 * - 現在記事の情報選択(buildAnnotationView)は DOM に依存しない純粋関数として
 *   window.HyperstrataAnnotation に公開し、scripts/strata-annotation.test.mjs から検証する
 * - graph.json の題材アイコン(icon)は地層グラフ(assets/js/strata-graph.js)に埋める遊びの
 *   イラストであり、関連記事欄はリンク集なので表示しない
 */
(function () {
    /** 関係の種類(posts/strata/ の type)の表示ラベル。既知の種類以外は type をそのまま表示する */
    const TYPE_LABELS = {
        continues: 'Continues',
        revisits: 'Revisits',
        updates: 'Updates'
    };

    /**
     * 関係 1 件の表示データ(種類・理由と、リンク先記事の情報)を組み立てる。
     * リンク先記事の summary と icon は関連記事欄に表示しないため含めない。
     *
     * @param {{type: string, reason?: string|null}} ref inferredRefs の 1 要素
     * @param {{slug: string, title: string, url: string, publishedAt: string}} post リンク先の記事
     * @returns {{type: string, reason: string|null, slug: string, title: string, url: string, publishedAt: string}}
     */
    function toRelation(ref, post) {
        return {
            type: ref.type,
            reason: ref.reason || null,
            slug: post.slug,
            title: post.title,
            url: post.url,
            publishedAt: post.publishedAt
        };
    }

    /**
     * graph.json の記事配列から、現在記事の発掘記録(record)と関係先(relations)、現在記事を関係先に持つ
     * 後の記事(citedBy)を組み立てる。
     *
     * - record: 現在記事の summary・annotator・annotatedAt。summary が無い記事(注釈が無い、または
     *   posts/strata/private/ 由来で暗号化されている)は null にして発掘記録を出さない。
     *   annotator / annotatedAt が無い旧形式の graph.json では両者を null にする
     * - relations: 現在記事の inferredRefs を、関係先の記事情報付きで inferredRefs の順に並べる
     * - citedBy: 全記事の inferredRefs を走査し、slug が現在記事のものを逆引きして、
     *   参照している記事の情報付きで公開日の昇順に並べる(人間の層の Cited by と同じ並び)
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, inferredRefs?: Array<{slug: string, type: string, reason: string|null}>, summary?: string|null, annotator?: string|null, annotatedAt?: string|null}>} posts
     * @param {string} currentSlug 現在表示中の記事の slug
     * @returns {{record: {summary: string, annotator: string|null, annotatedAt: string|null}|null, relations: Array<{type: string, reason: string|null, slug: string, title: string, url: string, publishedAt: string}>, citedBy: Array<{type: string, reason: string|null, slug: string, title: string, url: string, publishedAt: string}>}}
     */
    function buildAnnotationView(posts, currentSlug) {
        if (!Array.isArray(posts)) {
            throw new Error('posts は配列である必要があります');
        }
        const postBySlug = {};
        posts.forEach(function (post) {
            postBySlug[post.slug] = post;
        });
        const current = currentSlug ? postBySlug[currentSlug] : null;
        if (!current) {
            return {record: null, relations: [], citedBy: []};
        }
        const record = current.summary ? {
            summary: current.summary,
            annotator: current.annotator || null,
            annotatedAt: current.annotatedAt || null
        } : null;
        const relations = (current.inferredRefs || [])
            .map(function (ref) {
                const target = postBySlug[ref.slug];
                return target ? toRelation(ref, target) : null;
            })
            .filter(function (relation) {
                return relation !== null;
            });
        const citedBy = [];
        posts.forEach(function (post) {
            (post.inferredRefs || []).forEach(function (ref) {
                if (ref.slug === currentSlug) {
                    citedBy.push(toRelation(ref, post));
                }
            });
        });
        citedBy.sort(function (a, b) {
            return a.publishedAt < b.publishedAt ? -1 : (a.publishedAt > b.publishedAt ? 1 : 0);
        });
        return {record: record, relations: relations, citedBy: citedBy};
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
     * 関係一覧の1件を <li> として描画する。
     *
     * @param {{type: string, reason: string|null, slug: string, title: string, url: string}} relation
     * @param {HTMLUListElement} list
     */
    function renderRelation(relation, list) {
        const item = document.createElement('li');
        item.className = 'gh-strata-annotation-item';

        const typeLabel = document.createElement('span');
        typeLabel.className = 'gh-strata-annotation-type';
        typeLabel.textContent = list.dataset['label' + relation.type.charAt(0).toUpperCase() + relation.type.slice(1)]
            || TYPE_LABELS[relation.type]
            || relation.type;
        item.appendChild(typeLabel);

        const link = document.createElement('a');
        link.href = relation.url;
        link.textContent = relation.title;
        item.appendChild(link);

        if (relation.reason) {
            const reason = document.createElement('span');
            reason.className = 'gh-strata-annotation-reason';
            reason.textContent = relation.reason;
            item.appendChild(reason);
        }

        list.appendChild(item);
    }

    /**
     * グループ(見出し + 一覧)へ関係一覧を描画し、1 件以上あればグループを表示する。
     *
     * @param {HTMLElement} section
     * @param {string} groupName data-strata-annotation-group の値(relations / cited-by)
     * @param {Array<object>} relations
     * @returns {boolean} 描画した件数が 1 件以上なら true
     */
    function renderGroup(section, groupName, relations) {
        const group = section.querySelector('[data-strata-annotation-group="' + groupName + '"]');
        if (!group || relations.length === 0) {
            return false;
        }
        const list = group.querySelector('[data-strata-annotation-list]');
        if (!list) {
            return false;
        }
        relations.forEach(function (relation) {
            renderRelation(relation, list);
        });
        group.hidden = false;
        return true;
    }

    /**
     * 発掘記録([data-strata-annotation-record] の <details>)へ要約と発掘者・発掘日を描画し、表示する。
     * 発掘日は <time datetime> に ISO 8601 を入れ、表示はページの言語(html の lang)の日付書式にする。
     *
     * @param {HTMLElement} section
     * @param {{summary: string, annotator: string|null, annotatedAt: string|null}|null} record
     * @returns {boolean} 描画したら true
     */
    function renderRecord(section, record) {
        const details = section.querySelector('[data-strata-annotation-record]');
        if (!details || !record) {
            return false;
        }
        const summary = details.querySelector('[data-strata-annotation-summary]');
        const meta = details.querySelector('[data-strata-annotation-meta]');
        if (!summary || !meta) {
            return false;
        }
        summary.textContent = record.summary;
        if (record.annotator) {
            const annotator = document.createElement('span');
            annotator.className = 'gh-strata-annotation-annotator';
            annotator.textContent = (meta.dataset.labelAnnotator ? meta.dataset.labelAnnotator + ' ' : '') + record.annotator;
            meta.appendChild(annotator);
        }
        if (record.annotatedAt) {
            const time = document.createElement('time');
            time.className = 'gh-strata-annotation-date';
            time.setAttribute('datetime', record.annotatedAt);
            time.textContent = new Date(record.annotatedAt).toLocaleDateString(document.documentElement.lang || undefined);
            meta.appendChild(time);
        }
        details.hidden = false;
        return true;
    }

    /**
     * [data-strata-annotation] セクションへ発掘記録と関係一覧(Related posts / Later posts)を描画する。
     * 発掘記録もどちらのグループの関係も無ければセクションは非表示のままにする。
     *
     * @param {HTMLElement} section
     * @param {{record: object|null, relations: Array<object>, citedBy: Array<object>}} view
     */
    function render(section, view) {
        const hasRecord = renderRecord(section, view.record);
        const hasRelations = renderGroup(section, 'relations', view.relations);
        const hasCitedBy = renderGroup(section, 'cited-by', view.citedBy);
        if (hasRecord || hasRelations || hasCitedBy) {
            section.hidden = false;
        }
    }

    function init() {
        const section = document.querySelector('[data-strata-annotation]');
        if (!section) {
            return;
        }
        const currentSlug = section.dataset.currentSlug || '';
        loadPosts(section.dataset.strataGraphUrl).then(function (posts) {
            render(section, buildAnnotationView(posts, currentSlug));
        }).catch(function (error) {
            console.error('[strata-annotation] ' + error.message);
        });
    }

    if (typeof window !== 'undefined') {
        window.HyperstrataAnnotation = {
            buildAnnotationView: buildAnnotationView
        };
    }

    if (typeof document !== 'undefined') {
        const schedule = window.requestIdleCallback || function (callback) {
            return window.setTimeout(callback, 1);
        };
        const start = function () {
            schedule(init);
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
        } else {
            start();
        }
    }
})();
