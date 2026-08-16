import { describe, it, expect } from "vitest";
import { buildCondTargets } from "./cond-targets-helpers";

describe("buildCondTargets", () => {
  const fields = [{ key: "계약금", label: "계약금" }, { key: "수수료", label: "수수료" }];
  const basic = [{ key: "사업장주소지", label: "사업장주소지" }];

  it("정산/기본정보 두 그룹 헤더로 구성", () => {
    const out = buildCondTargets(fields, "수수료", basic);
    expect(out.map((o) => o.value)).toEqual(["__hdr_settle", "계약금", "__hdr_basic", "사업장주소지"]);
    expect(out.filter((o) => o.isHeader).map((o) => o.label)).toEqual(["정산 정보", "기본정보"]);
  });

  it("기본정보 비면 그 헤더 없음", () => {
    const out = buildCondTargets(fields, null, []);
    expect(out.some((o) => o.value === "__hdr_basic")).toBe(false);
    expect(out.filter((o) => !o.isHeader).map((o) => o.value)).toEqual(["계약금", "수수료"]);
  });
});
