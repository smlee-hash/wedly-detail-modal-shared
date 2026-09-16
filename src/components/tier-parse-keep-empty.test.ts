import { describe, it, expect } from "vitest";

/**
 * 독립 리뷰 F4 — 마지막 차수를 지우면 빈 차수가 되살아나던 문제.
 *
 * 공용 parseTiers 가 빈 배열을 「처음 쓰는 회사」로 보고 빈 차수 1개를 만들어 주는데,
 * 삭제 직후에도 그 길로 들어가 지운 자리에 빈 카드가 다시 떴다. 저장값은 이미 `[]` 라
 * 서버 쓰기도 건너뛰어 **아무리 지워도 되살아났다.**
 *
 * 여기서는 SettlementInfoTab 의 `parseTiersKeepEmpty` 와 **같은 판정 규칙**을 못 박는다
 * (그 파일은 화면 부품이라 이 시험 환경에서 통째로 못 불러온다 — 규칙만 복제해 고정).
 */
type TierData = Record<string, unknown>;

/** 공용 parseTiers 를 본뜬 것 — 빈 배열이면 빈 차수 1개를 만들어 준다. */
function parseTiersLike(raw: unknown): TierData[] {
  if (!raw) return [{ id: "tier-1-0", label: "1차 정산" }];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return [{ id: "tier-1-0", label: "1차 정산" }]; }
  }
  if (!Array.isArray(arr) || arr.length === 0) return [{ id: "tier-1-0", label: "1차 정산" }];
  return arr as TierData[];
}

/** SettlementInfoTab 의 parseTiersKeepEmpty 와 같은 규칙. */
function parseTiersKeepEmpty(raw: unknown): TierData[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return parseTiersLike(raw);
    try { arr = JSON.parse(t); } catch { return parseTiersLike(raw); }
  }
  if (Array.isArray(arr) && arr.length === 0) return [];
  return parseTiersLike(raw);
}

describe("parseTiersKeepEmpty — 「빈 목록」과 「아직 없음」을 가른다", () => {
  it("★F4: 마지막 차수를 지운 뒤(`[]`)에는 빈 차수를 만들어 주지 않는다", () => {
    expect(parseTiersKeepEmpty("[]")).toEqual([]);
    expect(parseTiersKeepEmpty([])).toEqual([]);
    // 예전 동작과 대조 — 이것이 되살아남의 정체였다.
    expect(parseTiersLike("[]")).toHaveLength(1);
  });

  it("값이 아예 없는 회사는 지금처럼 빈 차수 1개로 시작한다(기존 동작 보존)", () => {
    expect(parseTiersKeepEmpty(null)).toHaveLength(1);
    expect(parseTiersKeepEmpty(undefined)).toHaveLength(1);
    expect(parseTiersKeepEmpty("")).toHaveLength(1);
    expect(parseTiersKeepEmpty("   ")).toHaveLength(1);
  });

  it("깨진 글자는 옛 길 그대로(빈 차수 1개) — 자료를 잃었다고 단정하지 않는다", () => {
    expect(parseTiersKeepEmpty("{깨짐")).toHaveLength(1);
  });

  it("값이 있는 목록은 그대로 돌려준다", () => {
    expect(parseTiersKeepEmpty('[{"id":"a"},{"id":"b"}]').map((t) => t.id)).toEqual(["a", "b"]);
  });
});
