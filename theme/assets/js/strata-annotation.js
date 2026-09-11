/**
 * Hyperstrata 注釈(記事末尾の関連記事: 過去記事との関係)ビュー
 *
 * scripts/hyperstrata-sync.mjs が assets/graph.json に合成する inferredRefs(関係先・種類・理由)を
 * fetch で読み取り、post.hbs の gh-citations(References / Cited by)の直後にある
 * [data-strata-annotation] セクションへ 2 つのグループとして描画する。
 *   - Related posts: 現在記事の inferredRefs(現在記事から過去記事への関係)
 *   - Later posts:   現在記事を inferredRefs に持つ後の記事(逆引き。人間の層の Cited by に相当し、
 *                    古い記事を読んでいる人に「後の記事で更新(updates)・再訪(revisits)された」と知らせる)
 * 記事本文(immutable)は書き換えず、研究者の札を上に置く形で後の層との関係を見せる。
 * graph.json には記事の要約(summary)もあるが、関連記事欄は本文の後に置くリンク集であり
 * 要約は冗長なため表示しない(要約はグラフビュー assets/js/strata-graph.js 側の用途)。
 * URL はテンプレートが data-strata-graph-url({{asset "graph.json"}})で渡す。
 * 本文の表示を優先するため、初期化は requestIdleCallback で遅らせ、fetch は低優先度で行う
 * (assets/js/strata-graph.js と同じ方針。graph.json は同一 URL のため 2 回目の fetch は
 * ブラウザの HTTP キャッシュから返る)。
 *
 * - posts/strata/private/(限定記事の注釈)は reason が sops で暗号化されており、
 *   hyperstrata-sync.mjs は復号しないため、graph.json では inferredRefs[].reason が null になる。
 *   その場合は種類・タイトル・URL だけの関係一覧として表示する
 * - 関係が無いグループは非表示のままにし、両方とも無い記事(注釈が無い/機械の層が無い/
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
     * graph.json の記事配列から、現在記事の関係先(relations)と、現在記事を関係先に持つ
     * 後の記事(citedBy)を組み立てる。
     *
     * - relations: 現在記事の inferredRefs を、関係先の記事情報付きで inferredRefs の順に並べる
     * - citedBy: 全記事の inferredRefs を走査し、slug が現在記事のものを逆引きして、
     *   参照している記事の情報付きで公開日の昇順に並べる(人間の層の Cited by と同じ並び)
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, inferredRefs?: Array<{slug: string, type: string, reason: string|null}>}>} posts
     * @param {string} currentSlug 現在表示中の記事の slug
     * @returns {{relations: Array<{type: string, reason: string|null, slug: string, title: string, url: string, publishedAt: string}>, citedBy: Array<{type: string, reason: string|null, slug: string, title: string, url: string, publishedAt: string}>}}
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
            return {relations: [], citedBy: []};
        }
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
        return {relations: relations, citedBy: citedBy};
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
     * [data-strata-annotation] セクションへ関係一覧(Related posts / Later posts)を描画する。
     * どちらのグループにも関係が無ければセクションは非表示のままにする。
     *
     * @param {HTMLElement} section
     * @param {{relations: Array<object>, citedBy: Array<object>}} view
     */
    function render(section, view) {
        const hasRelations = renderGroup(section, 'relations', view.relations);
        const hasCitedBy = renderGroup(section, 'cited-by', view.citedBy);
        if (hasRelations || hasCitedBy) {
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
