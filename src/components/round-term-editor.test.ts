import { describe, it, expect } from "vitest";
import type { FieldDef, FormulaTerm } from "@wedly/ui-shared";
import { roundTermIssue, chainKind, applyTermPatch } from "./round-term-rules";

const col = (k: string): FormulaTerm => ({ op: "+", unit: "column", columnKey: k, value: 0 });
const mulCol = (k: string): FormulaTerm => ({ op: "*", unit: "column", columnKey: k, value: 0 });
const pct = (v: number): FormulaTerm => ({ op: "*", unit: "percent", value: v });
const pct첫항 = (v: number): FormulaTerm => ({ op: "+", unit: "percent", value: v });
const round = (v: unknown): FormulaTerm => ({ op: "round", unit: "number", value: v } as FormulaTerm);
const 묶음 = (inner: FormulaTerm[], op: "+" | "*" = "+"): FormulaTerm => ({ op, unit: "group", terms: inner });

const fields = [
  { key: "환급액", label: "환급액", type: "number" },
  { key: "수수료율", label: "수수료율", type: "percent" },
  { key: "수수료", label: "수수료", type: "formula", formulaResult: "number" },
  { key: "달성률", label: "달성률", type: "formula", formulaResult: "percent" },
] as unknown as FieldDef[];

describe("반올림 항이 계산 안 되는 자리에 있는지 검사", () => {
  it("반올림을 안 쓰는 기존 수식은 통과한다", () => {
    expect(roundTermIssue([col("환급액"), pct(30)], fields)).toBeNull();
    expect(roundTermIssue([], fields)).toBeNull();
    expect(roundTermIssue(undefined, fields)).toBeNull();
  });

  it("정상 반올림(천원 단위)은 통과한다", () => {
    expect(roundTermIssue([col("환급액"), round(1000)], fields)).toBeNull();
    expect(roundTermIssue([col("환급액"), pct(30), round(1000), pct(110)], fields)).toBeNull();
    expect(roundTermIssue([col("수수료"), round(1000)], fields)).toBeNull();
  });

  it("맨 위 항목이 반올림이면 막는다", () => {
    expect(roundTermIssue([round(1000)], fields)).toContain("맨 위 항목");
    expect(roundTermIssue([round(1000), col("환급액")], fields)).toContain("맨 위 항목");
  });

  it("반올림 단위가 0·음수·소수·빈값이면 막는다", () => {
    expect(roundTermIssue([col("환급액"), round(0)], fields)).toContain("1 이상의 정수");
    expect(roundTermIssue([col("환급액"), round(-1000)], fields)).toContain("1 이상의 정수");
    expect(roundTermIssue([col("환급액"), round(1000.5)], fields)).toContain("1 이상의 정수");
    expect(roundTermIssue([col("환급액"), round(undefined)], fields)).toContain("1 이상의 정수");
    expect(roundTermIssue([col("환급액"), round("1000")], fields)).toContain("1 이상의 정수");
  });

  it("묶음(괄호) 안쪽도 같은 규칙으로 본다", () => {
    expect(roundTermIssue([묶음([col("환급액"), round(1000)])], fields)).toBeNull();
    expect(roundTermIssue([묶음([round(1000)])], fields)).toContain("묶음(괄호) 안");
    expect(roundTermIssue([묶음([col("환급액"), round(0)])], fields)).toContain("묶음(괄호) 안");
  });

  it("결과가 퍼센트인 수식에 반올림이 남아 있으면 막는다", () => {
    expect(roundTermIssue([col("환급액"), round(1000)], fields, "percent")).toContain("퍼센트");
    expect(roundTermIssue([묶음([col("환급액"), round(1000)])], fields, "percent")).toContain("퍼센트");
  });

  it("결과 형식이 원(숫자)이거나 안 넘어오면 예전처럼 본다", () => {
    expect(roundTermIssue([col("환급액"), round(1000)], fields, "number")).toBeNull();
    expect(roundTermIssue([col("환급액"), round(1000)], fields, undefined)).toBeNull();
    expect(roundTermIssue([col("환급액"), pct(30)], fields, "percent")).toBeNull();
  });
});

// 두 번째 검토가 잡은 구멍 — 저장 검증을 통과한 채 금액이 0원이 되던 세 가지.
// 계산기가 퍼센트를 0~1 비율로 바꿔 계산하므로, 반올림 직전 값이 비율이면
// 1,000원 단위로 반올림하는 순간 0 이 되고 그 뒤 곱셈까지 전부 0 이 된다.
describe("반올림 앞의 값이 비율이면 막는다 (0원이 되던 구멍)", () => {
  it("A: 묶음 안에서 퍼센트만 있고 반올림 — 실제로 0원이 되던 경우", () => {
    const f = [col("환급액"), 묶음([pct첫항(30), round(1000)], "*")];
    expect(roundTermIssue(f, fields)).toContain("비율");
  });

  it("B: 묶음 안에서 퍼센트 칸을 참조하고 반올림", () => {
    const f = [col("환급액"), 묶음([col("수수료율"), round(1000)], "*")];
    expect(roundTermIssue(f, fields)).toContain("비율");
  });

  it("C: 묶음 없이 평면 수식에서 첫 항이 퍼센트여도 같다", () => {
    const f = [pct첫항(30), round(1000), mulCol("환급액")];
    expect(roundTermIssue(f, fields)).toContain("비율");
  });

  it("퍼센트로 나오는 계산 칸을 참조해도 막는다", () => {
    expect(roundTermIssue([col("달성률"), round(1000)], fields)).toContain("비율");
  });

  it("금액에 비율을 곱한 뒤라면 통과한다 (실제 총 수수료 수식)", () => {
    const f = [col("환급액"), pct(30), round(1000), pct(110)];
    expect(roundTermIssue(f, fields)).toBeNull();
  });
});

// 첫 검토가 반려한 사유(반올림으로 바꿨다 되돌리면 참조 칸이 지워져 300만원이 0원)를
// 화면 모양이 아니라 '규칙'으로 못 박는다. 나중에 누가 연산 선택지를 도로 열어도 안 뚫린다.
describe("반올림 항은 반올림 단위 말고는 못 바꾼다", () => {
  const 반올림항 = round(1000);

  it("연산을 곱하기로 바꾸려 해도 그대로다", () => {
    expect(applyTermPatch(반올림항, { op: "*" }, "환급액")).toEqual(반올림항);
  });
  it("단위를 '다른 칸'으로 바꾸려 해도 그대로다 — 여기가 300만원이 0원 되던 길이었다", () => {
    expect(applyTermPatch(반올림항, { unit: "column" }, "환급액")).toEqual(반올림항);
    expect(applyTermPatch(반올림항, { unit: "percent" }, "환급액")).toEqual(반올림항);
  });
  it("참조 칸을 심으려 해도 그대로다", () => {
    expect(applyTermPatch(반올림항, { columnKey: "환급액" }, "환급액")).toEqual(반올림항);
  });
  it("반올림 단위만 바뀐다 (연산·단위는 늘 반올림·숫자로 고정)", () => {
    expect(applyTermPatch(반올림항, { value: 10000 })).toEqual({ op: "round", unit: "number", value: 10000 });
    expect(applyTermPatch({ op: "round", unit: "column", columnKey: "환급액", value: 1000 } as FormulaTerm, { value: 500 }))
      .toEqual({ op: "round", unit: "number", columnKey: "환급액", value: 500 });
  });

  it("반올림이 아닌 항은 예전 규칙 그대로다", () => {
    // '다른 칸'으로 바꾸면 기본 칸이 심긴다
    expect(applyTermPatch({ op: "+", unit: "number", value: 5 }, { unit: "column" }, "환급액"))
      .toEqual({ op: "+", unit: "column", value: 5, columnKey: "환급액" });
    // 숫자·퍼센트로 바꾸면 참조 칸을 지운다
    expect(applyTermPatch(col("환급액"), { unit: "number" }, "환급액"))
      .toEqual({ op: "+", unit: "number", value: 0 });
    // 연산만 바꾸면 나머지는 그대로
    expect(applyTermPatch(col("환급액"), { op: "*" }, "환급액"))
      .toEqual({ op: "*", unit: "column", columnKey: "환급액", value: 0 });
  });
});

describe("누적값이 금액인지 비율인지 따지기", () => {
  it("퍼센트만 있으면 비율", () => {
    expect(chainKind([pct첫항(30)], fields)).toBe("ratio");
    expect(chainKind([col("수수료율")], fields)).toBe("ratio");
    expect(chainKind([col("달성률")], fields)).toBe("ratio");
  });
  it("금액이 한 번이라도 끼면 금액", () => {
    expect(chainKind([col("환급액"), pct(30)], fields)).toBe("money");
    expect(chainKind([pct첫항(30), mulCol("환급액")], fields)).toBe("money");
    expect(chainKind([col("수수료")], fields)).toBe("money");
  });
  it("나누기는 왼쪽 성격을 유지한다 (금액 ÷ 1.1 은 금액)", () => {
    expect(chainKind([col("환급액"), { op: "/", unit: "number", value: 1.1 }], fields)).toBe("money");
  });
  it("묶음 안쪽까지 따져서 본다", () => {
    expect(chainKind([묶음([pct첫항(30)])], fields)).toBe("ratio");
    expect(chainKind([묶음([col("환급액"), pct(30)])], fields)).toBe("money");
  });
  it("모르는 칸은 금액으로 봐서 공연히 막지 않는다", () => {
    expect(chainKind([col("없는칸")], fields)).toBe("money");
    expect(roundTermIssue([col("없는칸"), round(1000)], fields)).toBeNull();
  });
  it("칸 목록을 안 넘겨도 터지지 않는다", () => {
    expect(roundTermIssue([col("환급액"), round(1000)])).toBeNull();
  });
});
