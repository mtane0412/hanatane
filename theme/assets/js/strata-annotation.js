/**
 * Hyperstrata 注釈(記事末尾の要約・過去記事との関係)ビュー
 *
 * scripts/hyperstrata-sync.mjs が assets/graph.json に合成する summary(記事の要約)と
 * inferredRefs[].reason(関係の理由)を fetch で読み取り、partials/post.hbs の gh-citations
 * (References / Cited by)の直後にある [data-strata-annotation] セクションへ描画する。
 * URL はテンプレートが data-strata-graph-url({{asset "graph.json"}})で渡す。
 * 本文の表示を優先するため、初期化は requestIdleCallback で遅らせ、fetch は低優先度で行う
 * (assets/js/strata-graph.js と同じ方針。graph.json は同一 URL のため 2 回目の fetch は
 * ブラウザの HTTP キャッシュから返る)。
 *
 * - posts/strata/private/(限定記事の注釈)は summary と reason が sops で暗号化されており、
 *   hyperstrata-sync.mjs は復号しないため、graph.json ではその記事の summary は null、
 *   inferredRefs[].reason も null になる。その場合はタイトル・URL だけの関係一覧として表示する
 * - summary も関係も無い記事(注釈が無い/機械の層が無い)ではセクションごと非表示のままにする
 * - graph.json の取得や内容の検証に失敗した場合は console.error に出力し、何も表示しない
 * - 現在記事の情報選択(buildAnnotationView)は DOM に依存しない純粋関数として
 *   window.HyperstrataAnnotation に公開し、scripts/strata-annotation.test.mjs から検証する
 * - 関係先の題材アイコンは assets/js/strata-icons.js(window.HyperstrataIcons)を使う。
 *   gulp が assets/js/*.js を連結するため読み込み順を気にする必要はない(参照は描画時にのみ発生する)
 */
(function () {
    /** 関係の種類(posts/strata/ の type)の表示ラベル。既知の種類以外は type をそのまま表示する */
    const TYPE_LABELS = {
        continues: 'Continues',
        revisits: 'Revisits',
        updates: 'Updates'
    };

    /**
     * graph.json の記事配列から、現在記事の要約と関係先(記事情報付き)を組み立てる。
     *
     * @param {Array<{slug: string, title: string, url: string, publishedAt: string, inferredRefs?: Array<{slug: string, type: string, reason: string|null}>, summary?: string|null, icon?: string|null}>} posts
     * @param {string} currentSlug 現在表示中の記事の slug
     * @returns {{summary: string|null, relations: Array<{type: string, reason: string|null, slug: string, title: string, url: string, publishedAt: string, icon: string|null}>}}
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
            return {summary: null, relations: []};
        }
        const relations = (current.inferredRefs || [])
            .map(function (ref) {
                const target = postBySlug[ref.slug];
                if (!target) {
                    return null;
                }
                return {
                    type: ref.type,
                    reason: ref.reason || null,
                    slug: target.slug,
                    title: target.title,
                    url: target.url,
                    publishedAt: target.publishedAt,
                    icon: target.icon || null
                };
            })
            .filter(function (relation) {
                return relation !== null;
            });
        return {summary: current.summary || null, relations: relations};
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
     * 題材アイコン(strata-icons.js の window.HyperstrataIcons)を <svg> 要素として作る。
     * 未知の icon や null なら null を返す。
     *
     * @param {string|null} icon
     * @returns {SVGSVGElement|null}
     */
    function createIconElement(icon) {
        return window.HyperstrataIcons.createElement(icon, {
            'aria-hidden': 'true',
            class: 'gh-strata-annotation-icon'
        });
    }

    /**
     * 関係一覧の1件を <li> として描画する。
     *
     * @param {{type: string, reason: string|null, slug: string, title: string, url: string, icon: string|null}} relation
     * @param {HTMLUListElement} list
     */
    function renderRelation(relation, list) {
        const item = document.createElement('li');
        item.className = 'gh-strata-annotation-item';

        const icon = createIconElement(relation.icon);
        if (icon) {
            item.appendChild(icon);
        }

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
     * [data-strata-annotation] セクションへ要約・関係一覧を描画する。中身が無ければ非表示のままにする。
     *
     * @param {HTMLElement} section
     * @param {{summary: string|null, relations: Array<object>}} view
     */
    function render(section, view) {
        if (!view.summary && view.relations.length === 0) {
            return;
        }
        const summaryElement = section.querySelector('[data-strata-annotation-summary]');
        if (view.summary && summaryElement) {
            summaryElement.textContent = view.summary;
        }
        const list = section.querySelector('[data-strata-annotation-list]');
        if (list) {
            view.relations.forEach(function (relation) {
                renderRelation(relation, list);
            });
        }
        section.hidden = false;
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
