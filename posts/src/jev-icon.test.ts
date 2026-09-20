/**
 * src/jev-icon.ts（Jev の choice から icon の候補を作る処理）のテスト
 */
import { describe, expect, it } from "vitest";
import { NO_ICON_LABEL } from "./jev-eval";
import {
	checkJevIconTarget,
	ICON_CONTESTED_THRESHOLD,
	suggestIcon,
} from "./jev-icon";
import type { PublishedPost } from "./strata";

function 記事(visibility: PublishedPost["visibility"]): PublishedPost {
	return {
		slug: "welcome-cat",
		title: "猫を迎えた",
		status: "published",
		visibility,
		published_at: "2024-05-01T00:00:00.000Z",
	};
}

describe("checkJevIconTarget", () => {
	it("公開記事は Jev に判定させてよい", () => {
		expect(() => checkJevIconTarget(記事("public"))).not.toThrow();
	});

	it("限定記事の本文は外部の API に送らないので、エラーにする", () => {
		expect(() => checkJevIconTarget(記事("members"))).toThrow(
			"限定記事の本文は外部の API に送れません",
		);
		expect(() => checkJevIconTarget(記事("paid"))).toThrow(
			"限定記事の本文は外部の API に送れません",
		);
	});
});

describe("suggestIcon", () => {
	it("候補を確率の高い順に並べ、「該当なし」は icon: null にする", () => {
		const suggestion = suggestIcon({
			confidence: 0.92,
			probabilities: {
				house: 0.03,
				cat: 0.93,
				[NO_ICON_LABEL]: 0.04,
			},
		});
		expect(suggestion.candidates).toEqual([
			{ icon: "cat", probability: 0.93 },
			{ icon: null, probability: 0.04 },
			{ icon: "house", probability: 0.03 },
		]);
		expect(suggestion.contested).toBe(false);
	});

	it("確信度がしきい値未満なら、拮抗している（icon の省略も検討する）と知らせる", () => {
		const suggestion = suggestIcon({
			confidence: ICON_CONTESTED_THRESHOLD - 0.01,
			probabilities: { journal: 0.6, house: 0.4 },
		});
		expect(suggestion.contested).toBe(true);
	});

	it("確信度がしきい値ちょうどなら、拮抗とはみなさない", () => {
		const suggestion = suggestIcon({
			confidence: ICON_CONTESTED_THRESHOLD,
			probabilities: { journal: 0.75, house: 0.25 },
		});
		expect(suggestion.contested).toBe(false);
	});

	it("icon の種別にも「該当なし」にも無い選択肢が返ってきたら、エラーにする", () => {
		expect(() =>
			suggestIcon({ confidence: 0.9, probabilities: { cooking: 0.9 } }),
		).toThrow("cooking");
	});
});
