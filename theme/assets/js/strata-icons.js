/**
 * Hyperstrata の題材アイコン(posts/src/strata.ts の TOPIC_ICONS と対応)
 *
 * strata-graph.js(地層グラフの帯へのランダム配置)から使うアイコン定義
 * (本文下のリンク集 strata-layers.js には出さない)。<svg viewBox="0 0 24 24"> の子要素だけを文字列で持ち、
 * 色は currentColor で呼び出し側に委ねる。未知の icon(古い graph.json や将来追加分)は
 * createElement が null を返し、呼び出し側は何も描画しない。
 *
 * 背景色(var(--background-color))での穴あけ・白抜きは使わず、単色のシルエットだけで形を表現する。
 * 地層に埋まった発掘物のような見た目にするための方針(白い切り抜きがあると埋蔵物らしさが薄れるため)
 */
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const ICONS = {
        cat: '<path d="M7 3 8.6 7.4 12 5.6l3.4 1.8L17 3l.9 6.1a6 6 0 1 1-11.8 0L7 3Z"/>',
        house: '<path d="M12 3 21 11h-2.5v9h-13v-9H3L12 3Z"/><rect x="15.2" y="4.5" width="2" height="4"/>',
        // ライフルのシルエット: 銃身(長い横棒)・台尻(斜めの棒)・トリガーガード(輪)を組む
        hunting: '<rect x="8" y="9.2" width="14" height="2.2" rx="0.5"/><rect x="2" y="10.3" width="9" height="2.6" rx="0.4" transform="rotate(18 6.5 11.6)"/><rect x="10" y="13" width="1.1" height="2"/><path d="M9.4 13.6a1.6 1.6 0 1 0 3.2 0" fill="none" stroke="currentColor" stroke-width="1.3"/>',
        game: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/>',
        // 歯車のシルエット: 中心の丸(本体)+短く太い歯(8方向)。放射状の細い線(太陽に見える)を避ける
        tech: '<circle cx="12" cy="12" r="5.4"/><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.7 5.7l1.8 1.8M16.5 16.5l1.8 1.8M18.3 5.7l-1.8 1.8M7.5 16.5l-1.8 1.8" stroke="currentColor" stroke-width="3.4" stroke-linecap="square"/>',
        travel: '<path d="M3 13.5 21 5l-8.5 18-2-7.5L3 13.5Z"/>',
        // ノート(journal)のシルエット: 本体の矩形+左側にはみ出す螺旋綴じの丸(すべて単色の実体で、穴は開けない)
        journal: '<rect x="6" y="3" width="13" height="18" rx="1.5"/><circle cx="4" cy="7" r="1.3"/><circle cx="4" cy="12" r="1.3"/><circle cx="4" cy="17" r="1.3"/>',
        // カレンダー(event)のシルエット: 本体の矩形+上端にはみ出す綴じ具の突起(すべて単色の実体で、穴は開けない)
        event: '<rect x="3" y="6" width="18" height="15" rx="1.5"/><rect x="6" y="2" width="2.4" height="6" rx="1.2"/><rect x="15.6" y="2" width="2.4" height="6" rx="1.2"/>'
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
