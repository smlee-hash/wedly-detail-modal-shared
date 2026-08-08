import { describe, it, expect } from "vitest";
import { roundTermIssue, chainKind, applyTermPatch } from "./round-term-rules";
import type { FieldDef, FormulaTerm } from "@wedly/ui-shared";

const fields = [
  { key: "환급액", label: "환급액", type: "number" },
  { key: "요율", label: "요율", type: "percent" },
] as unknown as FieldDef[];

const col = (k: string, op: FormulaTerm["op"] = "+"): FormulaTerm =>
  ({ op, unit: "column", value: 0, columnKey: k } as FormulaTerm);
const floorT = (v: number): FormulaTerm => ({ op: "floor", unit: "number", value: v } as FormulaTerm);

describe("내림 항 — 저장 전 검증", () => {
  it("금액 뒤에 붙은 내림은 통과", () => {
    expect(roundTermIssue([col("환급액"), floorT(10000)], fields, "number")).toBeNull();
  });

  it("맨 위 내림은 막는다", () => {
    expect(roundTermIssue([floorT(10000)], fields, "number")).toContain("맨 위");
  });

  it("단위가 0이면 막는다", () => {
    expect(roundTermIssue([col("환급액"), floorT(0)], fields, "number")).toContain("1 이상");
  });

  it("단위가 소수면 막는다", () => {
    expect(roundTermIssue([col("환급액"), floorT(0.5)], fields, "number")).toContain("1 이상");
  });

  it("결과가 퍼센트인 수식에는 막는다", () => {
    expect(roundTermIssue([col("환급액"), floorT(10000)], fields, "percent")).toContain("퍼센트");
  });

  it("내림 앞의 값이 비율이면 막는다 — 0원이 되는 길", () => {
    expect(roundTermIssue([col("요율"), floorT(10000)], fields, "number")).toContain("비율");
  });

  it("묶음(괄호) 안의 잘못된 내림도 잡는다", () => {
    const g = { op: "+", unit: "group", terms: [floorT(10000)] } as unknown as FormulaTerm;
    expect(roundTermIssue([col("환급액"), g], fields, "number")).toContain("묶음");
  });
});

describe("내림 항 — 다른 연산으로 바뀌지 않는다", () => {
  it("연산을 곱하기로 바꾸려 해도 내림 그대로", () => {
    expect(applyTermPatch(floorT(10000), { op: "*" } as Partial<FormulaTerm>)).toEqual(floorT(10000));
  });

  it("컬럼으로 바꾸려 해도 내림 그대로", () => {
    expect(applyTermPatch(floorT(10000), { unit: "column", columnKey: "환급액" })).toEqual(floorT(10000));
  });

  it("내림 단위만 고칠 수 있다", () => {
    expect(applyTermPatch(floorT(10000), { value: 1000 })).toEqual(floorT(1000));
  });
});

describe("내림은 누적값의 성격을 바꾸지 않는다", () => {
  it("금액 → 내림 → 여전히 금액", () => {
    expect(chainKind([col("환급액"), floorT(10000)], fields)).toBe("money");
  });
});
