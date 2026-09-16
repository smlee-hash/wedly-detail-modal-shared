import { describe, it, expect } from "vitest";
import {
  mergeTiersAcrossRows,
  splitMergedTiers,
  tierCreatedAtFromId,
  rowCreatedAt,
  tierHasContent,
  filledFieldCount,
  parseTierArray,
} from "./gov-merged-tiers";

const KEY = "계약정보_차수";

/** 운영 실측 자료(（주）세인시스, 2026-09-16 조회)를 그대로 본뜬 줄들. */
const 세인시스 = [
  {
    entryId: "local-1785721451333",
    row: {
      _createdTime: "2026-08-03T01:44:00.000Z",
      [KEY]: JSON.stringify([
        { id: "tier-1-1785721457223-ad97", label: "1차 정산", 계약금: 2200000, 계약일: "2026-08-03", 담당컨설턴트: "손문기" },
      ]),
    },
  },
  {
    entryId: "local-1785893638043",
    row: {
      _createdTime: "2026-08-05T01:33:00.000Z",
      [KEY]: JSON.stringify([
        { id: "tier-1-1785893645338-xdka", label: "1차 정산", 계약금: null, 계약일: "", 담당컨설턴트: "" },
      ]),
    },
  },
  { entryId: "local-1787646283410", row: { _createdTime: "2026-08-25T08:24:00.000Z" } },
];

describe("tierCreatedAtFromId — 차수 id 에 박힌 만든 시각", () => {
  it("운영 자료의 id 에서 시각을 꺼낸다", () => {
    expect(tierCreatedAtFromId("tier-1-1785721457223-ad97")).toBe(1785721457223);
  });
  it("자리 숫자(tier-1-)를 시각으로 오인하지 않는다", () => {
    expect(tierCreatedAtFromId("tier-1-abc")).toBeNull();
  });
  it("시각이 없는 옛 id 는 null", () => {
    expect(tierCreatedAtFromId("t")).toBeNull();
    expect(tierCreatedAtFromId("")).toBeNull();
  });
});

describe("rowCreatedAt — 계약 줄 만든 시각", () => {
  it("ISO 글자를 읽는다", () => {
    expect(rowCreatedAt({ _createdTime: "2026-08-03T01:44:00.000Z" })).toBe(Date.parse("2026-08-03T01:44:00.000Z"));
  });
  it("숫자도 그대로", () => expect(rowCreatedAt({ _createdTime: 1700000000000 })).toBe(1700000000000));
  it("없으면 null", () => expect(rowCreatedAt({})).toBeNull());
});

describe("mergeTiersAcrossRows — 여러 계약 줄의 차수를 한 목록으로", () => {
  it("（주）세인시스: 흩어진 차수 2개를 오래된 것부터 합친다", () => {
    const { tiers, refByTierId } = mergeTiersAcrossRows(세인시스, KEY);
    expect(tiers.map((t) => t.id)).toEqual(["tier-1-1785721457223-ad97", "tier-1-1785893645338-xdka"]);
    // 번호는 배열 자리로 매겨지므로 1차 = 2026-08-03 계약(손문기)이어야 한다.
    expect(tiers[0].담당컨설턴트).toBe("손문기");
    expect(refByTierId.get("tier-1-1785893645338-xdka")?.ownerEntryId).toBe("local-1785893638043");
  });

  it("차수가 없는 계약 줄은 아무것도 더하지 않는다", () => {
    const { tiers } = mergeTiersAcrossRows([세인시스[2]], KEY);
    expect(tiers).toEqual([]);
  });

  it("★같은 차수 id 가 두 줄에 얹혀 와도 한 번만 싣는다(합계 부풀림 방지)", () => {
    const dup = [
      { entryId: "a", row: { [KEY]: [{ id: "t1", 계약금: 1000 }] } },
      { entryId: "b", row: { [KEY]: [{ id: "t1", 계약금: 1000 }] } },
    ];
    const { tiers } = mergeTiersAcrossRows(dup, KEY);
    expect(tiers).toHaveLength(1);
  });

  it("시각을 모르는 옛 차수는 아는 차수보다 앞(오래된 쪽)에 둔다", () => {
    const rows = [
      { entryId: "a", row: { [KEY]: [{ id: "tier-1-1785893645338-x" }] } },
      { entryId: "b", row: { [KEY]: [{ id: "old" }] } },
    ];
    const { tiers } = mergeTiersAcrossRows(rows, KEY);
    expect(tiers.map((t) => t.id)).toEqual(["old", "tier-1-1785893645338-x"]);
  });

  it("시각이 같으면 줄 순서 → 줄 안 자리 순서", () => {
    const rows = [
      { entryId: "a", row: { _createdTime: 100, [KEY]: [{ id: "a1" }, { id: "a2" }] } },
      { entryId: "b", row: { _createdTime: 100, [KEY]: [{ id: "b1" }] } },
    ];
    const { tiers } = mergeTiersAcrossRows(rows, KEY);
    expect(tiers.map((t) => t.id)).toEqual(["a1", "a2", "b1"]);
  });

  it("JSON 글자와 배열을 모두 읽는다", () => {
    expect(parseTierArray('[{"id":"x"}]')).toEqual([{ id: "x" }]);
    expect(parseTierArray([{ id: "y" }])).toEqual([{ id: "y" }]);
    expect(parseTierArray("깨진값")).toEqual([]);
    expect(parseTierArray(null)).toEqual([]);
  });
});

describe("splitMergedTiers — 고친 목록을 원래 줄로 되돌린다", () => {
  const owners = 세인시스.map((r) => r.entryId);

  it("고친 차수는 원래 저장돼 있던 줄로 돌아간다(자료를 옮기지 않는다)", () => {
    const { tiers, refByTierId } = mergeTiersAcrossRows(세인시스, KEY);
    const edited = tiers.map((t) => (t.id === "tier-1-1785893645338-xdka" ? { ...t, 계약금: 500 } : t));
    const out = splitMergedTiers(edited, refByTierId, owners);
    expect(out.get("local-1785721451333")?.map((t) => t.id)).toEqual(["tier-1-1785721457223-ad97"]);
    expect(out.get("local-1785893638043")).toEqual([{ id: "tier-1-1785893645338-xdka", label: "1차 정산", 계약금: 500, 계약일: "", 담당컨설턴트: "" }]);
  });

  it("★차수를 지우면 그 차수가 있던 줄이 빈 배열로 저장된다(안 그러면 지운 게 되살아난다)", () => {
    const { tiers, refByTierId } = mergeTiersAcrossRows(세인시스, KEY);
    const afterDelete = tiers.filter((t) => t.id !== "tier-1-1785893645338-xdka");
    const out = splitMergedTiers(afterDelete, refByTierId, owners);
    expect(out.get("local-1785893638043")).toEqual([]);
    expect(out.get("local-1785721451333")).toHaveLength(1);
  });

  it("새로 만든 차수(모르는 id)는 대표 줄에 붙는다", () => {
    const { tiers, refByTierId } = mergeTiersAcrossRows(세인시스, KEY);
    const added = [...tiers, { id: "tier-3-9999999999999-new", 계약금: 10 }];
    const out = splitMergedTiers(added, refByTierId, owners);
    expect(out.get("local-1785721451333")?.map((t) => t.id)).toEqual([
      "tier-1-1785721457223-ad97",
      "tier-3-9999999999999-new",
    ]);
  });

  it("id 가 없는 옛 차수도 잃지 않는다(대표 줄로)", () => {
    const out = splitMergedTiers([{ 계약금: 7 }], new Map(), owners);
    expect(out.get("local-1785721451333")).toEqual([{ 계약금: 7 }]);
  });

  it("줄이 하나도 없으면 아무 데도 저장하지 않는다(빈 지도)", () => {
    expect(splitMergedTiers([{ id: "x" }], new Map(), []).size).toBe(0);
  });
});

describe("tierHasContent · filledFieldCount — 삭제 확인창이 보여 줄 값", () => {
  it("id·label·밑줄 키만 있으면 빈 차수", () => {
    expect(tierHasContent({ id: "t", label: "1차 정산", _x: 1 })).toBe(false);
    expect(filledFieldCount({ id: "t", label: "1차 정산" })).toBe(0);
  });
  it("빈 글자·null 은 값으로 치지 않는다", () => {
    expect(tierHasContent({ id: "t", 계약일: "", 계약금: null })).toBe(false);
  });
  it("（주）세인시스 1차 계약은 값 3칸", () => {
    expect(filledFieldCount({ id: "t", label: "1차 정산", 계약금: 2200000, 계약일: "2026-08-03", 담당컨설턴트: "손문기" })).toBe(3);
  });
  it("숫자 0 도 값이다", () => expect(tierHasContent({ id: "t", 계약금: 0 })).toBe(true));
});
