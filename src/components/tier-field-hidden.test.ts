import { describe, it, expect } from "vitest";
import { tierFieldHidden, carryFieldHidden, visibleTierLayout } from "./tier-field-hidden";

function numbered(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `f${i + 1}` }));
}

describe("tierFieldHidden — 차수 카드 칸만 화면에서 감추기", () => {
  it("표시가 없으면 감추지 않는다 (지금까지와 같은 동작)", () => {
    expect(tierFieldHidden({ key: "계약금", label: "계약금", type: "number" })).toBe(false);
  });

  it("hidden:true 면 감춘다", () => {
    expect(tierFieldHidden({ key: "계약일", hidden: true })).toBe(true);
  });

  it("hidden 가 참 같은 값이어도 true 가 아니면 감추지 않는다 (실수로 감추는 것 방지)", () => {
    expect(tierFieldHidden({ key: "x", hidden: false })).toBe(false);
    expect(tierFieldHidden({ key: "x", hidden: "true" })).toBe(false);
    expect(tierFieldHidden({ key: "x", hidden: 1 })).toBe(false);
    expect(tierFieldHidden({ key: "x", hidden: null })).toBe(false);
    expect(tierFieldHidden({ key: "x", hidden: undefined })).toBe(false);
    expect(tierFieldHidden({ key: "x", hidden: "숨김" })).toBe(false);
  });

  it("칸 정의가 없거나 이상해도 터지지 않는다", () => {
    expect(tierFieldHidden(null)).toBe(false);
    expect(tierFieldHidden(undefined)).toBe(false);
    expect(tierFieldHidden("계약일")).toBe(false);
  });
});

describe("carryFieldHidden — 칸 정의를 다시 만들 때 숨김이 사라지지 않게", () => {
  it("숨긴 칸의 표시를 새 정의로 옮긴다 (타입 변경 시나리오)", () => {
    const before = { key: "계약일", label: "계약일", type: "date", hidden: true };
    const rebuilt = { key: before.key, label: before.label, type: "text" };
    expect(carryFieldHidden(before, rebuilt)).toEqual({
      key: "계약일", label: "계약일", type: "text", hidden: true,
    });
  });

  it("숨기지 않은 칸에는 hidden 키를 붙이지 않는다 (기존 동작 그대로)", () => {
    const rebuilt = { key: "계약금", label: "계약금", type: "number" };
    const out = carryFieldHidden({ key: "계약금", label: "계약금", type: "text" }, rebuilt);
    expect(out).toEqual({ key: "계약금", label: "계약금", type: "number" });
    expect("hidden" in out).toBe(false);
  });

  it("옮긴 뒤에는 tierFieldHidden 이 다시 숨김으로 판정한다 (왕복)", () => {
    const rebuilt = carryFieldHidden({ key: "x", hidden: true }, { key: "x", type: "text" });
    expect(tierFieldHidden(rebuilt)).toBe(true);
  });
});

describe("visibleTierLayout — 정의는 두고 그릴 목록·배치만 다시 계산", () => {
  it("17칸 [3,3,3,3,2,3] 에서 2·13·14번째를 감추면 [2,3,3,3,3] 이고 14칸 순서는 그대로다", () => {
    const fields = numbered(17).map((f, i) =>
      i === 1 || i === 12 || i === 13 ? { ...f, hidden: true } : f,
    );
    const saved = [3, 3, 3, 3, 2, 3];
    const result = visibleTierLayout(fields, saved, tierFieldHidden);
    expect(result.rowLayout).toEqual([2, 3, 3, 3, 3]);
    expect(result.fields).toHaveLength(14);
    expect(result.fields.map((f) => f.key)).toEqual([
      "f1", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "f15", "f16", "f17",
    ]);
    // 저장된 배치는 그대로 — 화면용 값만 새로 만든다
    expect(saved).toEqual([3, 3, 3, 3, 2, 3]);
  });

  it("줄 묶음을 유지한다 — 3칸씩 다시 채우지 않는다", () => {
    const fields = numbered(6).map((f, i) => (i === 0 ? { ...f, hidden: true } : f));
    expect(visibleTierLayout(fields, [3, 3], tierFieldHidden).rowLayout).toEqual([2, 3]);
  });

  it("한 줄이 통째로 숨으면 그 줄을 만들지 않는다 (빈 줄 금지)", () => {
    const fields = numbered(6).map((f, i) => (i < 3 ? { ...f, hidden: true } : f));
    const result = visibleTierLayout(fields, [3, 3], tierFieldHidden);
    expect(result.rowLayout).toEqual([3]);
    expect(result.fields.map((f) => f.key)).toEqual(["f4", "f5", "f6"]);
  });

  it("숨긴 칸이 하나도 없으면 지금과 완전히 같은 결과다 (회귀 0)", () => {
    const fields = numbered(17);
    const saved = [3, 3, 3, 3, 2, 3];
    const result = visibleTierLayout(fields, saved, () => false);
    expect(result.fields).toEqual(fields);
    expect(result.rowLayout).toEqual(saved);
  });

  it("rowLayout 이 비어 있으면 남은 칸은 한 줄에 1칸씩이다", () => {
    const fields = numbered(4);
    const result = visibleTierLayout(fields, [], () => false);
    expect(result.fields).toEqual(fields);
    expect(result.rowLayout).toEqual([1, 1, 1, 1]);
  });

  it("rowLayout 이 칸 수보다 짧으면 남는 칸은 한 줄에 1칸씩이다", () => {
    const fields = numbered(5);
    const result = visibleTierLayout(fields, [3], () => false);
    expect(result.fields).toEqual(fields);
    expect(result.rowLayout).toEqual([3, 1, 1]);
  });

  it("rowLayout 이 칸 수보다 길면 남는 줄은 만들지 않는다", () => {
    const fields = numbered(3);
    const result = visibleTierLayout(fields, [3, 3, 2], () => false);
    expect(result.fields).toEqual(fields);
    expect(result.rowLayout).toEqual([3]);
  });

  it("1·2·3 밖의 숫자는 한 줄 1칸으로 본다 (마지막 [2] 줄은 칸이 하나뿐이어도 2칸 폭 그대로)", () => {
    const fields = numbered(4);
    const result = visibleTierLayout(fields, [0, 4, 1, 2], () => false);
    expect(result.fields).toEqual(fields);
    // 0·4 → 1칸, 1 → 1칸, 2 → 2칸(칸은 f4 하나뿐이지만 폭은 원래대로 절반).
    expect(result.rowLayout).toEqual([1, 1, 1, 2]);
  });

  it("마지막 줄이 덜 차 있어도 숨김이 없으면 폭이 그대로다 (적대적 리뷰 지적 — 폭이 1/3→1/2 로 바뀌던 것)", () => {
    const fields = numbered(2);
    const result = visibleTierLayout(fields, [3], () => false);
    expect(result.fields).toEqual(fields);
    // 칸은 2개뿐이지만 그 줄은 원래 3칸 폭이었다 — 다시 세면 안 된다.
    expect(result.rowLayout).toEqual([3]);
  });

  it("덜 찬 줄에서 하나를 숨기면 그때는 남은 칸 수로 좁힌다", () => {
    const fields = numbered(2).map((f, i) => (i === 0 ? { ...f, hidden: true } : f));
    const result = visibleTierLayout(fields, [3], tierFieldHidden);
    expect(result.fields.map((f) => f.key)).toEqual(["f2"]);
    expect(result.rowLayout).toEqual([1]);
  });

  it("fields 가 빈 배열이면 빈 결과를 돌려준다", () => {
    expect(visibleTierLayout([], [3, 2], () => false)).toEqual({ fields: [], rowLayout: [] });
  });
});
