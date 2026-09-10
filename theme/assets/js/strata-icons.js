/**
 * Hyperstrata の題材アイコン(posts/src/strata.ts の TOPIC_ICONS と対応)
 *
 * strata-annotation.js(記事末尾の関係一覧)と strata-graph.js(地層グラフの帯へのランダム配置)の
 * 両方から使う共通アイコン定義。<svg viewBox="0 0 24 24"> の子要素だけを文字列で持ち、
 * 色は currentColor で呼び出し側に委ねる。未知の icon(古い graph.json や将来追加分)は
 * createElement が null を返し、呼び出し側は何も描画しない。
 */
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const ICONS = {
        cat: '<path d="M7 3 8.6 7.4 12 5.6l3.4 1.8L17 3l.9 6.1a6 6 0 1 1-11.8 0L7 3Z"/><circle cx="9.6" cy="13" r="1" style="fill:var(--background-color,#fff)"/><circle cx="14.4" cy="13" r="1" style="fill:var(--background-color,#fff)"/>',
        house: '<path d="M12 3 21 11h-2.5v9h-13v-9H3L12 3Z"/><rect x="10" y="15" width="4" height="5" style="fill:var(--background-color,#fff)"/>',
        hunting: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.2" style="fill:var(--background-color,#fff)"/><circle cx="12" cy="12" r="3.2"/>',
        game: '<rect x="3" y="9" width="18" height="9" rx="4"/><rect x="7" y="11.5" width="4" height="1.6" style="fill:var(--background-color,#fff)"/><rect x="8.2" y="10.3" width="1.6" height="4" style="fill:var(--background-color,#fff)"/><circle cx="16" cy="12" r="1.1" style="fill:var(--background-color,#fff)"/><circle cx="18.2" cy="14.2" r="1.1" style="fill:var(--background-color,#fff)"/>',
        tech: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        travel: '<path d="M3 13.5 21 5l-8.5 18-2-7.5L3 13.5Z"/>',
        journal: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><rect x="7" y="7" width="10" height="1.6" style="fill:var(--background-color,#fff)"/><rect x="7" y="10.7" width="10" height="1.6" style="fill:var(--background-color,#fff)"/><rect x="7" y="14.4" width="7" height="1.6" style="fill:var(--background-color,#fff)"/>',
        event: '<rect x="6" y="2" width="2.2" height="5.5" rx="1.1"/><rect x="15.8" y="2" width="2.2" height="5.5" rx="1.1"/><rect x="3" y="5" width="18" height="16" rx="1.5"/><rect x="3" y="9" width="18" height="2" style="fill:var(--background-color,#fff)"/><circle cx="12" cy="15" r="1.6" style="fill:var(--background-color,#fff)"/>'
    };

    /**
     * icon 種別の中身(<svg> の子要素の HTML 文字列)を返す。未知の icon や null/空文字なら null。
     *
     * @param {string|null|undefined} icon
     * @returns {string|null}
     */
    function markup(icon) {
        return (icon && Object.prototype.hasOwnProperty.call(ICONS, icon)) ? ICONS[icon] : null;
    }

    /**
     * icon 種別を <svg viewBox="0 0 24 24"> 要素として作る。未知の icon や null/空文字なら null を返す。
     *
     * @param {string|null|undefined} icon
     * @param {Object<string, string|number>} [attributes] svg 要素に設定する属性(viewBox は省略時 "0 0 24 24")
     * @returns {SVGSVGElement|null}
     */
    function createElement(icon, attributes) {
        const content = markup(icon);
        if (!content) {
            return null;
        }
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        // SVG のデフォルト fill は黒(currentColor ではない)なので、呼び出し側の CSS(color)が効くようにしておく。
        // ここで先に設定してから attributes を上書きするため、呼び出し側で fill を渡せば上書きできる
        svg.setAttribute('fill', 'currentColor');
        Object.keys(attributes || {}).forEach(function (key) {
            svg.setAttribute(key, attributes[key]);
        });
        svg.innerHTML = content;
        return svg;
    }

    if (typeof window !== 'undefined') {
        window.HyperstrataIcons = {
            ICONS: ICONS,
            markup: markup,
            createElement: createElement
        };
    }
})();
