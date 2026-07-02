import { describe, it, expect } from "vitest";
import { displayOrderNewestFirst } from "./tier-render-order";

describe("displayOrderNewestFirst — 최신 차수(배열 뒤)가 먼저, 원래 idx 유지", () => {
  it("역순으로 나열하되 원래 인덱스를 함께 준다", () => {
    const tiers = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const out = displayOrderNewestFirst(tiers);
    expect(out.map((x) => x.tier.id)).toEqual(["c", "b", "a"]);
    expect(out.map((x) => x.idx)).toEqual([2, 1, 0]); // 라벨은 원래 번호(1차=a=idx0)
  });
  it("빈 배열은 빈 배열", () => expect(displayOrderNewestFirst([])).toEqual([]));
  it("1개는 그대로", () => {
    const out = displayOrderNewestFirst([{ id: "x" }]);
    expect(out).toEqual([{ tier: { id: "x" }, idx: 0 }]);
  });
  it("원본 배열은 변형하지 않는다(번호 기준 보존)", () => {
    const tiers = [{ id: "a" }, { id: "b" }];
    displayOrderNewestFirst(tiers);
    expect(tiers.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
