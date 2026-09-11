/**
 * Hyperstrata 直上・直下の層(前後の記事)の経過日数
 *
 * partials/strata-neighbors.hbs は前後の記事のタイトル・URL・公開日を JavaScript 無しで出す(#33)。
 * このスクリプトはその補足として、現在記事(data-current-published)と各記事(<time datetime>)の
 * 公開日時から経過日数を計算し、[data-strata-neighbor-gap] に「N 日後」(上の層) /「N 日前」(下の層)を
 * 書き込む。文言はテンプレートが data-label-later / data-label-earlier({{t}} の訳)で渡し、% を日数に置き換える。
 *
 * - 日時が解釈できない場合は何も書き込まない(公開日の表示だけが残る)
 * - 日数の計算(formatGap)は DOM に依存しない純粋関数として window.HyperstrataNeighbors に公開し、
 *   scripts/strata-neighbors.test.mjs から検証する
 */
(function () {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    /**
     * 現在記事と隣接記事の公開日時から経過日数の文言を作る。
     * 隣接記事が新しければ labels.later、古ければ labels.earlier の % を日数に置き換える。
     * 日数は assets/js/strata-graph.js の不整合面(hiatus)と同じく四捨五入する。
     *
     * @param {string} currentIso 現在記事の公開日時(ISO 8601)
     * @param {string} neighborIso 隣接記事の公開日時(ISO 8601)
     * @param {{later: string, earlier: string}} labels 文言(% を日数に置き換える)
     * @returns {string|null} 文言。日時が解釈できなければ null
     */
    function formatGap(currentIso, neighborIso, labels) {
        const current = Date.parse(currentIso);
        const neighbor = Date.parse(neighborIso);
        if (Number.isNaN(current) || Number.isNaN(neighbor)) {
            return null;
        }
        const diff = neighbor - current;
        const days = Math.round(Math.abs(diff) / MS_PER_DAY);
        const label = diff >= 0 ? labels.later : labels.earlier;
        return label.replace('%', String(days));
    }

    function init() {
        const section = document.querySelector('[data-strata-neighbors]');
        if (!section) {
            return;
        }
        const labels = {
            later: section.dataset.labelLater || '',
            earlier: section.dataset.labelEarlier || ''
        };
        section.querySelectorAll('.gh-strata-neighbor').forEach(function (neighbor) {
            const time = neighbor.querySelector('time');
            const gap = neighbor.querySelector('[data-strata-neighbor-gap]');
            if (!time || !gap) {
                return;
            }
            const text = formatGap(section.dataset.currentPublished, time.getAttribute('datetime'), labels);
            if (text !== null) {
                gap.textContent = text;
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.HyperstrataNeighbors = {
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
