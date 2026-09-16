import { describe, it, expect } from "vitest";
import {
  mergeTiersAcrossRows,
  splitMergedTiers,
  makeMergedTierId,
  parseMergedTierId,
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
const owners = 세인시스.map((r) => r.entryId);

/** 화면 부품(ui-shared parseTiers)이 하는 짓을 본뜬다 — id 없는 차수에 합성 id 를 붙이고
 *  정의에 없는 키는 떨어뜨린다. 합친 목록이 화면을 한 바퀴 돌아오는 경로를 그대로 재현한다. */
function 화면을한바퀴(tiers: Record<string, unknown>[]): Record<string, unknown>[] {
  return tiers.map((t, i) => ({
    id: typeof t.id === "string" ? t.id : `tier-${i + 1}-${i}`,
    label: typeof t.label === "string" ? t.label : `${i + 1}차 정산`,
    계약금: t.계약금 ?? null,
    계약일: t.계약일 ?? "",
    담당컨설턴트: t.담당컨설턴트 ?? "",
  }));
}

describe("합친 id — 주인을 id 안에 박는다", () => {
  it("만들고 되푼다", () => {
    const id = makeMergedTierId(1, "tier-1-999", 0);
    expect(id).toBe("gm1~tier-1-999");
    expect(parseMergedTierId(id)).toEqual({ ownerIndex: 1, originalId: "tier-1-999" });
  });
  it("원래 id 가 없던 차수는 자리 표시로 박고, 되풀면 빈 글자", () => {
    const id = makeMergedTierId(2, "", 3);
    expect(id).toBe("gm2~noid3");
    expect(parseMergedTierId(id)).toEqual({ ownerIndex: 2, originalId: "" });
  });
  it("합친 id 가 아니면 null(= 화면에서 새로 만든 차수)", () => {
    expect(parseMergedTierId("tier-1-0")).toBeNull();
    expect(parseMergedTierId("gmx~a")).toBeNull();
    expect(parseMergedTierId("gm1")).toBeNull();
    expect(parseMergedTierId(undefined)).toBeNull();
  });
});

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
    const { tiers } = mergeTiersAcrossRows(세인시스, KEY);
    expect(tiers.map((t) => t.id)).toEqual([
      "gm0~tier-1-1785721457223-ad97",
      "gm1~tier-1-1785893645338-xdka",
    ]);
    // 번호는 배열 자리로 매겨지므로 1차 = 2026-08-03 계약(손문기)이어야 한다.
    expect(tiers[0].담당컨설턴트).toBe("손문기");
  });

  it("원본 차수 객체를 건드리지 않는다(사본에만 id 를 갈아 끼운다)", () => {
    const rows = [{ entryId: "a", row: { [KEY]: [{ id: "t1", 계약금: 1 }] } }];
    const { tiers } = mergeTiersAcrossRows(rows, KEY);
    expect(tiers[0].id).toBe("gm0~t1");
    expect((rows[0].row[KEY] as Record<string, unknown>[])[0].id).toBe("t1");
  });

  it("차수가 없는 계약 줄은 아무것도 더하지 않는다", () => {
    expect(mergeTiersAcrossRows([세인시스[2]], KEY).tiers).toEqual([]);
  });

  it("★F1: 두 줄에 같은 차수 id 가 있어도 둘 다 살아남는다(예전엔 뒤 줄이 사라졌다)", () => {
    const dup = [
      { entryId: "a", row: { _createdTime: 100, [KEY]: [{ id: "tier-1-0", 계약금: 1000 }] } },
      { entryId: "b", row: { _createdTime: 200, [KEY]: [{ id: "tier-1-0", 계약금: 2000 }] } },
    ];
    const { tiers } = mergeTiersAcrossRows(dup, KEY);
    expect(tiers).toHaveLength(2);
    expect(tiers.map((t) => t.id)).toEqual(["gm0~tier-1-0", "gm1~tier-1-0"]);
  });

  it("시각을 모르는 옛 차수는 아는 차수보다 앞(오래된 쪽)에 둔다", () => {
    const rows = [
      { entryId: "a", row: { [KEY]: [{ id: "tier-1-1785893645338-x" }] } },
      { entryId: "b", row: { [KEY]: [{ id: "old" }] } },
    ];
    expect(mergeTiersAcrossRows(rows, KEY).tiers.map((t) => t.id)).toEqual(["gm1~old", "gm0~tier-1-1785893645338-x"]);
  });

  it("시각이 같으면 줄 순서 → 줄 안 자리 순서", () => {
    const rows = [
      { entryId: "a", row: { _createdTime: 100, [KEY]: [{ id: "a1" }, { id: "a2" }] } },
      { entryId: "b", row: { _createdTime: 100, [KEY]: [{ id: "b1" }] } },
    ];
    expect(mergeTiersAcrossRows(rows, KEY).tiers.map((t) => t.id)).toEqual(["gm0~a1", "gm0~a2", "gm1~b1"]);
  });

  it("JSON 글자와 배열을 모두 읽는다", () => {
    expect(parseTierArray('[{"id":"x"}]')).toEqual([{ id: "x" }]);
    expect(parseTierArray([{ id: "y" }])).toEqual([{ id: "y" }]);
    expect(parseTierArray("깨진값")).toEqual([]);
    expect(parseTierArray(null)).toEqual([]);
  });
});

describe("splitMergedTiers — 고친 목록을 원래 줄로 되돌린다", () => {
  it("고친 차수는 원래 줄로 돌아가고 id 도 원래대로", () => {
    const { tiers } = mergeTiersAcrossRows(세인시스, KEY);
    const edited = 화면을한바퀴(tiers).map((t) => (t.id === "gm1~tier-1-1785893645338-xdka" ? { ...t, 계약금: 500 } : t));
    const out = splitMergedTiers(edited, owners);
    expect(out.get("local-1785721451333")?.map((t) => t.id)).toEqual(["tier-1-1785721457223-ad97"]);
    expect(out.get("local-1785893638043")).toEqual([
      { id: "tier-1-1785893645338-xdka", label: "1차 정산", 계약금: 500, 계약일: "", 담당컨설턴트: "" },
    ]);
    expect(out.get("local-1787646283410")).toEqual([]);
  });

  it("★F1: 같은 id 를 가진 두 줄의 차수가 각자 제 줄로 돌아간다", () => {
    const dup = [
      { entryId: "a", row: { _createdTime: 100, [KEY]: [{ id: "tier-1-0", 계약금: 1000 }] } },
      { entryId: "b", row: { _createdTime: 200, [KEY]: [{ id: "tier-1-0", 계약금: 2000 }] } },
    ];
    const { tiers } = mergeTiersAcrossRows(dup, KEY);
    const out = splitMergedTiers(화면을한바퀴(tiers), ["a", "b"]);
    expect(out.get("a")?.[0]).toMatchObject({ id: "tier-1-0", 계약금: 1000 });
    expect(out.get("b")?.[0]).toMatchObject({ id: "tier-1-0", 계약금: 2000 });
  });

  it("★F2: 비대표 줄의 id 없는 옛 차수가 대표 줄이 아니라 제 줄로 돌아간다", () => {
    const rows = [
      { entryId: "a", row: { _createdTime: 100, [KEY]: [{ id: "a1", 계약금: 1 }] } },
      { entryId: "b", row: { _createdTime: 200, [KEY]: [{ 계약금: 1000 }] } },  // id 없음
    ];
    const { tiers } = mergeTiersAcrossRows(rows, KEY);
    // 화면이 합성 id 를 붙여 돌려줘도 주인이 안 바뀌어야 한다.
    const out = splitMergedTiers(화면을한바퀴(tiers), ["a", "b"]);
    expect(out.get("b")).toHaveLength(1);
    expect(out.get("b")?.[0]).toMatchObject({ 계약금: 1000 });
    expect(out.get("b")?.[0].id).toBeUndefined();   // 합성 id 를 저장값에 심지 않는다
    expect(out.get("a")).toHaveLength(1);
  });

  it("★차수를 지우면 그 차수가 있던 줄이 빈 배열로 저장된다(안 그러면 지운 게 되살아난다)", () => {
    const { tiers } = mergeTiersAcrossRows(세인시스, KEY);
    const afterDelete = 화면을한바퀴(tiers).filter((t) => t.id !== "gm1~tier-1-1785893645338-xdka");
    const out = splitMergedTiers(afterDelete, owners);
    expect(out.get("local-1785893638043")).toEqual([]);
    expect(out.get("local-1785721451333")).toHaveLength(1);
  });

  it("새로 만든 차수(합친 id 가 아닌 것)는 대표 줄에 붙는다", () => {
    const { tiers } = mergeTiersAcrossRows(세인시스, KEY);
    const added = [...화면을한바퀴(tiers), { id: "tier-3-9999999999999-new", 계약금: 10 }];
    const out = splitMergedTiers(added, owners);
    expect(out.get("local-1785721451333")?.map((t) => t.id)).toEqual([
      "tier-1-1785721457223-ad97",
      "tier-3-9999999999999-new",
    ]);
  });

  it("줄 번호가 범위를 벗어난 id 는 대표 줄로(자료를 잃지 않는다)", () => {
    const out = splitMergedTiers([{ id: "gm9~ghost", 계약금: 5 }], owners);
    expect(out.get("local-1785721451333")).toEqual([{ id: "ghost", 계약금: 5 }]);
  });

  it("못 읽는 합친 id 는 저장값에 안 남긴다", () => {
    const out = splitMergedTiers([{ id: "gmBROKEN", 계약금: 5 }], owners);
    expect(out.get("local-1785721451333")).toEqual([{ 계약금: 5 }]);
  });

  it("줄이 하나도 없으면 아무 데도 저장하지 않는다", () => {
    expect(splitMergedTiers([{ id: "x" }], []).size).toBe(0);
  });

  it("합치기 → 화면 → 저장 왕복이 원래 자료를 그대로 되돌린다(값 안 건드림)", () => {
    const { tiers } = mergeTiersAcrossRows(세인시스, KEY);
    const out = splitMergedTiers(화면을한바퀴(tiers), owners);
    expect(out.get("local-1785721451333")).toEqual([
      { id: "tier-1-1785721457223-ad97", label: "1차 정산", 계약금: 2200000, 계약일: "2026-08-03", 담당컨설턴트: "손문기" },
    ]);
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
