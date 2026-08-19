import { describe, it, expect } from "vitest";
import { typeChangeNeedsSave } from "./type-change-save";

describe("typeChangeNeedsSave — 칸 종류 바꾸기 확인 시 저장할지", () => {
  it("수식(formula)은 종류가 같아도 저장한다 (식 내용이 바뀌었을 수 있음)", () => {
    expect(typeChangeNeedsSave("formula", "formula")).toBe(true);
    expect(typeChangeNeedsSave("text", "formula")).toBe(true);
  });

  it("선택(select)은 종류가 같아도 저장한다 (보기 목록이 바뀌었을 수 있음)", () => {
    expect(typeChangeNeedsSave("select", "select")).toBe(true);
    expect(typeChangeNeedsSave("text", "select")).toBe(true);
  });

  it("수식·선택이 아니면 종류가 같을 때 저장하지 않는다", () => {
    expect(typeChangeNeedsSave("text", "text")).toBe(false);
    expect(typeChangeNeedsSave("number", "number")).toBe(false);
    expect(typeChangeNeedsSave("date", "date")).toBe(false);
    expect(typeChangeNeedsSave("percent", "percent")).toBe(false);
  });

  it("수식·선택이 아니면 종류가 바뀌었을 때만 저장한다", () => {
    expect(typeChangeNeedsSave("text", "number")).toBe(true);
    expect(typeChangeNeedsSave("number", "date")).toBe(true);
    expect(typeChangeNeedsSave("select", "text")).toBe(true);
    expect(typeChangeNeedsSave("formula", "text")).toBe(true);
  });
});
