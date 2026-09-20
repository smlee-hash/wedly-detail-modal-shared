import { describe, it, expect } from "vitest";
import { parseTiers, type FieldDef } from "@wedly/ui-shared";
import { parseTiersKeepEmpty } from "./settlement-first-tier";

/**
 * 독립 리뷰 F4 — 마지막 차수를 지우면 빈 차수가 되살아나던 문제.
 * 생산 헬퍼 `parseTiersKeepEmpty` 를 직접 시험한다(규칙 복제 금지).
 */
const fields: FieldDef[] = [];

describe("parseTiersKeepEmpty — 「빈 목록」과 「아직 없음」을 가른다", () => {
  it("★F4: 마지막 차수를 지운 뒤(`[]`)에는 빈 차수를 만들어 주지 않는다", () => {
    expect(parseTiersKeepEmpty("[]", fields)).toEqual([]);
    expect(parseTiersKeepEmpty([], fields)).toEqual([]);
    expect(parseTiers("[]", fields)).toHaveLength(1);
  });

  it("값이 아예 없는 회사는 지금처럼 빈 차수 1개로 시작한다(기존 동작 보존)", () => {
    expect(parseTiersKeepEmpty(null, fields)).toHaveLength(1);
    expect(parseTiersKeepEmpty(undefined, fields)).toHaveLength(1);
    expect(parseTiersKeepEmpty("", fields)).toHaveLength(1);
    expect(parseTiersKeepEmpty("   ", fields)).toHaveLength(1);
  });

  it("깨진 글자는 옛 길 그대로(빈 차수 1개) — 자료를 잃었다고 단정하지 않는다", () => {
    expect(parseTiersKeepEmpty("{깨짐", fields)).toHaveLength(1);
  });

  it("값이 있는 목록은 그대로 돌려준다", () => {
    expect(parseTiersKeepEmpty('[{"id":"a"},{"id":"b"}]', fields).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
