import { describe, it, expect } from "vitest";
import { parseTiers, type FieldDef, type TierData } from "@wedly/ui-shared";
import {
  parseTiersKeepEmpty,
  parseSettlementTiers,
  isUnsavedFirstTierDraft,
  isExplicitEmptyTierList,
  loadSettlementTiers,
  afterLastTierRemoved,
  lastTierDeleteWarning,
} from "./settlement-first-tier";

const fields: FieldDef[] = [
  { key: "계약금", label: "계약금", type: "number" },
  { key: "계약일", label: "계약일", type: "date" },
  { key: "담당컨설턴트", label: "담당 컨설턴트", type: "text" },
];

function withoutId(tier: TierData): Omit<TierData, "id"> {
  const { id: _id, ...rest } = tier;
  void _id;
  return rest;
}

describe("parseTiersKeepEmpty — 빈 목록은 그대로(다른 탭)", () => {
  it("명시적 빈 배열·JSON 배열은 빈 목록", () => {
    expect(parseTiersKeepEmpty("[]", fields)).toEqual([]);
    expect(parseTiersKeepEmpty([], fields)).toEqual([]);
    expect(isExplicitEmptyTierList("[]")).toBe(true);
    expect(isExplicitEmptyTierList([])).toBe(true);
  });

  it("없거나 빈 글자는 공용 parseTiers 와 같은 모양의 빈 차수 1개", () => {
    expect(parseTiersKeepEmpty(null, fields)).toHaveLength(1);
    expect(withoutId(parseTiersKeepEmpty(null, fields)[0])).toEqual(withoutId(parseTiers(null, fields)[0]));
    expect(parseTiersKeepEmpty(undefined, fields)).toHaveLength(1);
    expect(parseTiersKeepEmpty("", fields)).toHaveLength(1);
    expect(parseTiersKeepEmpty("   ", fields)).toHaveLength(1);
  });
});

describe("parseSettlementTiers — ensureFirstTier 가 켜지면 빈 목록도 첫 칸", () => {
  it("빈 배열·JSON 배열은 공용 parseTiers(null) 과 같은 빈 차수 1개", () => {
    const fromNull = parseTiers(null, fields);
    expect(fromNull).toHaveLength(1);
    for (const raw of [[], "[]"] as const) {
      const got = parseSettlementTiers(raw, fields, true);
      expect(got).toHaveLength(1);
      expect(withoutId(got[0])).toEqual(withoutId(fromNull[0]));
      expect(typeof got[0].id).toBe("string");
      expect(got[0].id.length).toBeGreaterThan(0);
    }
  });

  it("null 도 공용 parseTiers(null) 과 같은 빈 차수 1개", () => {
    const got = parseSettlementTiers(null, fields, true);
    const shared = parseTiers(null, fields);
    expect(got).toHaveLength(1);
    expect(shared).toHaveLength(1);
    expect(withoutId(got[0])).toEqual(withoutId(shared[0]));
  });

  it("꺼두면 명시적 빈 목록은 그대로 빈 목록(정산·환불 유지)", () => {
    expect(parseSettlementTiers([], fields, false)).toEqual([]);
    expect(parseSettlementTiers("[]", fields, false)).toEqual([]);
    expect(parseSettlementTiers([], fields)).toEqual([]);
  });

  it("값이 있는 목록은 id·값을 그대로 두고 공용 parseTiers 와 같다", () => {
    const raw: TierData[] = [
      { id: "tier-1-1785721457223-ad97", label: "1차 계약", 계약금: 2200000, 계약일: "2026-08-03", 담당컨설턴트: "손문기" },
      { id: "tier-1-1785893645338-xdka", label: "2차 계약", 계약금: 100, 계약일: "2026-08-05", 담당컨설턴트: "이아영" },
      { id: "keep-third", label: "3차 계약", 계약금: 3, 계약일: "2026-08-25", 담당컨설턴트: "" },
    ];
    const extra = [{ ...raw[0], extraKey: "parser-must-not-widen" }];
    const on = parseSettlementTiers(raw, fields, true);
    const off = parseSettlementTiers(raw, fields, false);
    const shared = parseTiers(raw, fields);
    expect(on.map((t) => t.id)).toEqual(["tier-1-1785721457223-ad97", "tier-1-1785893645338-xdka", "keep-third"]);
    expect(on.map((t) => t.계약금)).toEqual([2200000, 100, 3]);
    expect(on).toEqual(shared);
    expect(off).toEqual(shared);
    expect(parseSettlementTiers(extra, fields, true)).toEqual(parseTiers(extra, fields));
    expect(parseSettlementTiers(JSON.stringify(raw), fields, true).map((t) => t.id)).toEqual(raw.map((t) => t.id));
  });
});

describe("loadSettlementTiers — 열기는 저장 값을 만들지 않는다", () => {
  it("빈 목록·null 을 첫 칸으로 보여 줘도 persist 필드가 없고 초안이다", () => {
    for (const raw of [null, [], "[]", ""] as const) {
      const loaded = loadSettlementTiers(raw, fields, true);
      expect(loaded.tiers).toHaveLength(1);
      expect(loaded.isDraft).toBe(true);
      expect("persist" in loaded).toBe(false);
      expect(JSON.stringify(loaded.tiers)).not.toBe("[]");
    }
  });

  it("꺼두면 빈 목록 열기는 빈 화면·초안 아님", () => {
    const loaded = loadSettlementTiers([], fields, false);
    expect(loaded.tiers).toEqual([]);
    expect(loaded.isDraft).toBe(false);
  });
});

describe("isUnsavedFirstTierDraft — 저장 안 한 초안만", () => {
  it("없거나 빈 목록은 초안(삭제·뱃지 숨김 대상)", () => {
    expect(isUnsavedFirstTierDraft(null, true)).toBe(true);
    expect(isUnsavedFirstTierDraft(undefined, true)).toBe(true);
    expect(isUnsavedFirstTierDraft("", true)).toBe(true);
    expect(isUnsavedFirstTierDraft([], true)).toBe(true);
    expect(isUnsavedFirstTierDraft("[]", true)).toBe(true);
  });

  it("저장된 빈 차수 객체는 초안이 아니다(삭제 가능)", () => {
    const savedEmpty = [{ id: "tier-1-0", label: "1차 계약", 계약금: null, 계약일: "", 담당컨설턴트: "" }];
    expect(isUnsavedFirstTierDraft(savedEmpty, true)).toBe(false);
    expect(isUnsavedFirstTierDraft(JSON.stringify(savedEmpty), true)).toBe(false);
    expect(parseSettlementTiers(savedEmpty, fields, true)[0].id).toBe("tier-1-0");
  });

  it("꺼두면 항상 초안이 아니다", () => {
    expect(isUnsavedFirstTierDraft([], false)).toBe(false);
    expect(isUnsavedFirstTierDraft(null, false)).toBe(false);
  });
});

describe("afterLastTierRemoved — 마지막 저장 차수 삭제", () => {
  it("켜두면 저장은 [] 한 번, 화면은 새 빈 초안", () => {
    const remaining: TierData[] = [];
    const result = afterLastTierRemoved(remaining, fields, true);
    expect(result.persist).toEqual([]);
    expect(JSON.stringify(result.persist)).toBe("[]");
    expect(result.display).toHaveLength(1);
    expect(result.isDraft).toBe(true);
    expect(withoutId(result.display[0])).toEqual(withoutId(parseTiers(null, fields)[0]));
    expect(JSON.stringify(result.display)).not.toBe("[]");
  });

  it("꺼두면 빈 목록을 그대로 저장·표시(되살리지 않음)", () => {
    const result = afterLastTierRemoved([], fields, false);
    expect(result.persist).toEqual([]);
    expect(result.display).toEqual([]);
    expect(result.isDraft).toBe(false);
  });

  it("남은 차수는 id·값을 그대로 둔다", () => {
    const remaining: TierData[] = [
      { id: "keep-me", label: "1차 계약", 계약금: 2200000, 계약일: "2026-08-03", 담당컨설턴트: "손문기" },
      { id: "keep-two", label: "2차 계약", 계약금: 50, 계약일: "", 담당컨설턴트: "" },
    ];
    const result = afterLastTierRemoved(remaining, fields, true);
    expect(result.persist).toBe(remaining);
    expect(result.display).toBe(remaining);
    expect(result.display.map((t) => t.id)).toEqual(["keep-me", "keep-two"]);
    expect(result.display[0].계약금).toBe(2200000);
    expect(result.isDraft).toBe(false);
  });
});

describe("lastTierDeleteWarning — 마지막 차수 문구", () => {
  it("켜두면 빈 첫 입력칸이 남는다고 적고, 끄면 기존 「추가」 안내", () => {
    expect(lastTierDeleteWarning(true)).toContain("빈 첫 입력칸이 다시 나타납니다");
    expect(lastTierDeleteWarning(true)).not.toContain("「추가」");
    expect(lastTierDeleteWarning(false)).toContain("아래 「추가」로 다시 만들 수 있습니다");
    expect(lastTierDeleteWarning()).toBe(
      "이 회사의 마지막 차수입니다. 지워도 회사 자료는 남고 아래 「추가」로 다시 만들 수 있습니다. ",
    );
  });
});
