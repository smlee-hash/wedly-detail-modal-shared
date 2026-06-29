import { describe, it, expect } from "vitest";
import { tierFieldsEqual } from "./tier-fields-equal";

describe("tierFieldsEqual", () => {
  it("동일 목록은 true", () => {
    const a = [{ key: "a", label: "A", type: "date" }, { key: "b", label: "B", type: "number" }];
    const b = [{ key: "a", label: "A", type: "date" }, { key: "b", label: "B", type: "number" }];
    expect(tierFieldsEqual(a, b)).toBe(true);
  });
  it("라벨이 다르면 false (이름 변경 감지)", () => {
    const a = [{ key: "a", label: "A", type: "date" }];
    const b = [{ key: "a", label: "A2", type: "date" }];
    expect(tierFieldsEqual(a, b)).toBe(false);
  });
  it("칸 추가 감지", () => {
    const a = [{ key: "a", label: "A", type: "date" }];
    const b = [{ key: "a", label: "A", type: "date" }, { key: "c", label: "C", type: "text" }];
    expect(tierFieldsEqual(a, b)).toBe(false);
  });
  it("순서 변경 감지", () => {
    const a = [{ key: "a", label: "A", type: "date" }, { key: "b", label: "B", type: "number" }];
    const b = [{ key: "b", label: "B", type: "number" }, { key: "a", label: "A", type: "date" }];
    expect(tierFieldsEqual(a, b)).toBe(false);
  });
  it("키 순서만 다른 동일 객체는 true (안정 직렬화)", () => {
    const a = [{ key: "a", type: "date", label: "A" }];
    const b = [{ key: "a", label: "A", type: "date" }];
    expect(tierFieldsEqual(a, b)).toBe(true);
  });
  it("중첩 속성(formula/options) 차이도 감지", () => {
    const a = [{ key: "f", label: "F", type: "formula", formula: ["x", "+", "y"] }];
    const b = [{ key: "f", label: "F", type: "formula", formula: ["x", "-", "y"] }];
    expect(tierFieldsEqual(a, b)).toBe(false);
  });
});
