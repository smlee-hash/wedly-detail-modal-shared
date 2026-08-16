import { describe, it, expect } from "vitest";
import { selectableOptions } from "./custom-select-helpers";

describe("selectableOptions", () => {
  it("헤더는 선택 후보에서 제외", () => {
    const out = selectableOptions([
      { value: "__h_basic", label: "기본정보", isHeader: true },
      { value: "사업장주소지", label: "사업장주소지" },
    ]);
    expect(out.map((o) => o.value)).toEqual(["사업장주소지"]);
  });
  it("헤더 없으면 그대로", () => {
    const out = selectableOptions([{ value: "a", label: "A" }, { value: "b", label: "B" }]);
    expect(out.map((o) => o.value)).toEqual(["a", "b"]);
  });
});
