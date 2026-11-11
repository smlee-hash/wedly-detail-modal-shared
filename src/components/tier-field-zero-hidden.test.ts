import { describe, expect, it } from "vitest";
import {
  isShownNonZeroValue,
  tierFieldHiddenByZeroValue,
  tierFieldHiddenWhenZero,
  zeroHiddenFieldValue,
} from "./tier-field-zero-hidden";
import { visibleTierLayout } from "./tier-field-hidden";
import { LEGACY_FEE_CONTEXT, type FeeTierContext } from "./fee-tier-display";
import type { FieldDef, TierData } from "@wedly/ui-shared";

const OLCADEMY = { key: "[올카데미]_계약금_수수료", label: "[올카데미] 계약금 수수료", type: "formula" } as FieldDef;
const CONSULTANT = { key: "[컨설턴트]_수수료", label: "[컨설턴트] 계약금 수수료", type: "formula" } as FieldDef;

describe("값이 0이 아닐 때만 보이는 칸 — 칸 고르기", () => {
  it("올카데미 계약금 수수료 칸은 기본으로 이 규칙을 받는다", () => {
    expect(tierFieldHiddenWhenZero(OLCADEMY)).toBe(true);
  });

  it("올카데미 환불 수수료 칸도 계약금과 같은 규칙을 받는다", () => {
    const refund = { key: "[올카데미]_환불_수수료", label: "[올카데미] 환불 수수료", type: "text" } as FieldDef;
    expect(tierFieldHiddenWhenZero(refund)).toBe(true);
    expect(tierFieldHiddenByZeroValue(refund, "0")).toBe(true);
    expect(tierFieldHiddenByZeroValue(refund, null)).toBe(true);
    expect(tierFieldHiddenByZeroValue(refund, "-200,000")).toBe(false);
    expect(tierFieldHiddenByZeroValue(refund, -200000)).toBe(false);
  });

  it("다른 칸은 값이 0이어도 이 규칙을 받지 않는다", () => {
    expect(tierFieldHiddenWhenZero(CONSULTANT)).toBe(false);
    expect(tierFieldHiddenWhenZero({ key: "계약금", type: "number" })).toBe(false);
  });

  it("칸 정의에 hideWhenZero 가 정확히 true 이면 다른 칸도 이 규칙을 받는다", () => {
    expect(tierFieldHiddenWhenZero({ key: "새칸", hideWhenZero: true })).toBe(true);
    expect(tierFieldHiddenWhenZero({ key: "새칸", hideWhenZero: "true" })).toBe(false);
    expect(tierFieldHiddenWhenZero({ key: "새칸", hideWhenZero: 1 })).toBe(false);
  });

  it("칸이 아닌 값은 규칙을 받지 않는다", () => {
    expect(tierFieldHiddenWhenZero(null)).toBe(false);
    expect(tierFieldHiddenWhenZero(undefined)).toBe(false);
    expect(tierFieldHiddenWhenZero("[올카데미]_계약금_수수료")).toBe(false);
  });
});

describe("값이 0이 아닌 숫자인지", () => {
  it.each([
    [0, false], [null, false], [undefined, false], ["", false], ["  ", false], ["0", false], ["0원", false],
    ["0,000", false], [Number.NaN, false], [Number.POSITIVE_INFINITY, false],
    [{ kind: "basis", reason: "계약 차수 확인 필요" }, false], ["확인 필요", false],
    [50000, true], [-1000, true], ["50,000", true], ["50000원", true], [0.5, true],
  ])("값 %j → 보임 %s", (value, shown) => {
    expect(isShownNonZeroValue(value)).toBe(shown);
  });

  it("규칙을 받는 칸은 0원이면 감추고 5만원이면 보인다", () => {
    expect(tierFieldHiddenByZeroValue(OLCADEMY, 0)).toBe(true);
    expect(tierFieldHiddenByZeroValue(OLCADEMY, null)).toBe(true);
    expect(tierFieldHiddenByZeroValue(OLCADEMY, 50000)).toBe(false);
  });

  it("규칙을 받지 않는 칸은 값이 0이어도 감추지 않는다", () => {
    expect(tierFieldHiddenByZeroValue(CONSULTANT, 0)).toBe(false);
    expect(tierFieldHiddenByZeroValue(CONSULTANT, null)).toBe(false);
  });
});

describe("차수 카드에서 칸 값 읽기", () => {
  const fields = [CONSULTANT, OLCADEMY];

  it("규칙을 받지 않는 칸은 값을 계산하지 않고 null 을 돌려준다(기존 화면 계산을 건드리지 않는다)", () => {
    const select = () => { throw new Error("쓰면 안 됨"); };
    const ctx = { serverManaged: false, select, calculatedWithoutOverride: () => null } as unknown as FeeTierContext;
    const tier = { id: "t1", label: "1차" } as TierData;
    expect(zeroHiddenFieldValue(CONSULTANT, tier, fields, ctx)).toBeNull();
  });

  it("서버가 정해 준 값(selected)은 그대로 읽는다", () => {
    const ctx: FeeTierContext = {
      serverManaged: true,
      select: () => ({ state: "selected", managed: true, value: 50000, amount: 50000, source: "automatic", automaticValue: 50000 }),
      calculatedWithoutOverride: () => null,
    };
    expect(zeroHiddenFieldValue(OLCADEMY, { id: "t1", label: "1차" } as TierData, fields, ctx)).toBe(50000);
  });

  it("서버 칸이 풀리지 않았거나 막혔으면 값이 없는 것으로 읽는다", () => {
    const unresolved: FeeTierContext = {
      serverManaged: true,
      select: () => ({ state: "unresolved", message: "받지 못했어요" }),
      calculatedWithoutOverride: () => null,
    };
    expect(zeroHiddenFieldValue(OLCADEMY, { id: "t1", label: "1차" } as TierData, fields, unresolved)).toBeNull();
  });

  it("옛 방식(legacy)에서 수식이 아닌 칸은 차수에 저장된 값을 읽는다", () => {
    const stored = { key: "[올카데미]_계약금_수수료", label: "x", type: "number" } as FieldDef;
    const tier = { id: "t1", label: "1차", "[올카데미]_계약금_수수료": 50000 } as TierData;
    expect(zeroHiddenFieldValue(stored, tier, [stored], LEGACY_FEE_CONTEXT)).toBe(50000);
    expect(zeroHiddenFieldValue(stored, { id: "t2", label: "2차" } as TierData, [stored], LEGACY_FEE_CONTEXT)).toBeNull();
  });
});

describe("차수 카드 배치", () => {
  const fields = [
    { key: "계약금", label: "계약금", type: "number" },
    { key: "[컨설턴트]_수수료", label: "[컨설턴트] 계약금 수수료", type: "formula" },
    { key: "[올카데미]_계약금_수수료", label: "[올카데미] 계약금 수수료", type: "formula" },
    { key: "[위들리]_수수료", label: "[위들리] 계약금 수수료", type: "formula" },
  ] as FieldDef[];

  it("올카데미가 0원인 차수는 그 칸만 빠지고 같은 줄의 칸 수가 줄어든다", () => {
    const shown = visibleTierLayout(fields, [1, 3], (f) => tierFieldHiddenByZeroValue(f, 0));
    expect(shown.fields.map((f) => f.key)).toEqual(["계약금", "[컨설턴트]_수수료", "[위들리]_수수료"]);
    expect(shown.rowLayout).toEqual([1, 2]);
  });

  it("올카데미가 5만원인 차수는 모든 칸이 그대로 보인다", () => {
    const shown = visibleTierLayout(fields, [1, 3], (f) => tierFieldHiddenByZeroValue(f, 50000));
    expect(shown.fields.map((f) => f.key)).toEqual(fields.map((f) => f.key));
    expect(shown.rowLayout).toEqual([1, 3]);
  });
});
