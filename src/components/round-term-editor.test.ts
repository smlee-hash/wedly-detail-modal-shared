import { describe, it, expect } from "vitest";
import type { FormulaTerm } from "@wedly/ui-shared";
import { roundTermIssue } from "./round-term-rules";

const col = (k: string): FormulaTerm => ({ op: "+", unit: "column", columnKey: k, value: 0 });
const pct = (v: number): FormulaTerm => ({ op: "*", unit: "percent", value: v });
const round = (v: unknown): FormulaTerm => ({ op: "round", unit: "number", value: v } as FormulaTerm);

describe("반올림 항이 계산 안 되는 자리에 있는지 검사", () => {
  it("반올림을 안 쓰는 기존 수식은 통과한다", () => {
    expect(roundTermIssue([col("환급액"), pct(30)])).toBeNull();
    expect(roundTermIssue([])).toBeNull();
    expect(roundTermIssue(undefined)).toBeNull();
  });

  it("정상 반올림(천원 단위)은 통과한다", () => {
    expect(roundTermIssue([col("수수료"), round(1000)])).toBeNull();
    expect(roundTermIssue([col("환급액"), pct(30), round(1000), pct(110)])).toBeNull();
  });

  it("맨 위 항목이 반올림이면 막는다", () => {
    expect(roundTermIssue([round(1000)])).toContain("맨 위 항목");
    expect(roundTermIssue([round(1000), col("환급액")])).toContain("맨 위 항목");
  });

  it("반올림 단위가 0·음수·소수·빈값이면 막는다", () => {
    expect(roundTermIssue([col("수수료"), round(0)])).toContain("1 이상의 정수");
    expect(roundTermIssue([col("수수료"), round(-1000)])).toContain("1 이상의 정수");
    expect(roundTermIssue([col("수수료"), round(1000.5)])).toContain("1 이상의 정수");
    expect(roundTermIssue([col("수수료"), round(undefined)])).toContain("1 이상의 정수");
    expect(roundTermIssue([col("수수료"), round("1000")])).toContain("1 이상의 정수");
  });

  it("묶음(괄호) 안쪽도 같은 규칙으로 본다", () => {
    const 묶음 = (inner: FormulaTerm[]): FormulaTerm => ({ op: "+", unit: "group", terms: inner });
    expect(roundTermIssue([묶음([col("환급액"), round(1000)])])).toBeNull();
    expect(roundTermIssue([묶음([round(1000)])])).toContain("묶음(괄호) 안");
    expect(roundTermIssue([묶음([col("환급액"), round(0)])])).toContain("묶음(괄호) 안");
  });

  // 추가 버튼은 퍼센트 수식에 안 뜨지만, 원 단위로 만든 수식의 결과 형식을 나중에
  // 퍼센트로 바꾸면 반올림 항이 그대로 남아 값이 조용히 0% 가 된다.
  it("결과가 퍼센트인 수식에 반올림이 남아 있으면 막는다", () => {
    expect(roundTermIssue([col("수수료"), round(1000)], "percent")).toContain("퍼센트");
    const 묶음 = (inner: FormulaTerm[]): FormulaTerm => ({ op: "+", unit: "group", terms: inner });
    expect(roundTermIssue([묶음([col("수수료"), round(1000)])], "percent")).toContain("퍼센트");
  });

  it("결과 형식이 원(숫자)이거나 안 넘어오면 예전처럼 본다", () => {
    expect(roundTermIssue([col("수수료"), round(1000)], "number")).toBeNull();
    expect(roundTermIssue([col("수수료"), round(1000)], undefined)).toBeNull();
    // 반올림이 없는 퍼센트 수식은 여전히 통과해야 한다(기존 수식 회귀 방지)
    expect(roundTermIssue([col("환급액"), pct(30)], "percent")).toBeNull();
  });
});
