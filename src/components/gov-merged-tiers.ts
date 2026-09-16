/**
 * 한 회사의 정부지원금 계약 줄 여러 개에 흩어져 있는 차수를 **한 목록**으로 합친다.
 *
 * 왜 필요한가 (노션 「담당 컨설턴트 컬럼 상세정보 ↔ 데이터테이블 연동 오류」, 사장님 지시 2026-09-17)
 *   한 회사에 정책자금 계약 줄이 여러 개일 수 있다(운영 실측 2026-09-16: 180곳).
 *   표는 2026-08-25부터 「계약 한 건 = 한 줄」로 합쳐 보여 주는데 **상세창만 「계약 1·2·3」
 *   알약으로 나뉘어** 있었다. 그래서 같은 회사인데 표와 상세가 서로 다른 담당 컨설턴트를
 *   보여 줬다 — 이번 요청의 뿌리다. 알약을 없애고 여기서 합친다.
 *
 * 순서 규칙
 *   - 배열은 **오래된 것부터**. 차수 번호(1차·2차…)를 그 자리로 매기기 때문이다.
 *     화면은 displayOrderNewestFirst 가 뒤집어 최신을 맨 위에 그린다(사장님 지시 2026-09-17).
 *   - 만든 시각은 차수 id 에 박혀 있다(`tier-1-1785721457223-ad97` → 1785721457223).
 *     옛 차수라 없으면 그 계약 줄의 만든 시각(_createdTime) → 줄 순서 → 줄 안 위치로 내려간다.
 *
 * 저장 규칙
 *   합쳐 **보여 줄 뿐 자료를 옮기지 않는다.** 고친 차수는 원래 들어 있던 계약 줄에 되돌려
 *   저장한다(splitMergedTiers). 자료를 옮기면 되돌릴 수 없고, 다른 화면(표·정산)이 읽는
 *   자리가 통째로 바뀌어 사고 범위가 커진다.
 */

export type TierObject = Record<string, unknown>;

export interface PolicyRowForMerge {
  entryId: string;
  row: Record<string, unknown>;
}

export interface MergedTierRef {
  /** 이 차수가 실제로 저장돼 있는 계약 줄 */
  ownerEntryId: string;
  /** policyRows 안 그 줄의 자리(대표 = 0) */
  ownerIndex: number;
}

/** 차수 배열 파싱 — JSON 문자열/배열 모두 허용, 그 외엔 빈 배열. */
export function parseTierArray(raw: unknown): TierObject[] {
  if (Array.isArray(raw)) return raw as TierObject[];
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const p: unknown = JSON.parse(raw);
      return Array.isArray(p) ? (p as TierObject[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 차수 고유 id(문자열이고 비어 있지 않을 때만). */
export function tierIdOf(tier: TierObject | undefined | null): string {
  const id = tier && typeof tier.id === "string" ? tier.id.trim() : "";
  return id;
}

/**
 * 차수 id 에 박힌 만든 시각(ms). `tier-<자리>-<시각>-<임의>` 꼴에서 13자리 수를 찾는다.
 * 못 찾으면 null — 부르는 쪽이 줄 시각으로 내려간다.
 *
 * ★자리 숫자(`tier-1-…`)를 시각으로 오인하지 않게 **10자리 이상**만 시각으로 본다.
 */
export function tierCreatedAtFromId(id: string): number | null {
  if (!id) return null;
  let best: number | null = null;
  for (const part of id.split("-")) {
    if (!/^\d{10,}$/.test(part)) continue;
    const n = Number(part);
    if (Number.isFinite(n)) best = best === null ? n : Math.max(best, n);
  }
  return best;
}

/** 계약 줄이 만들어진 시각(ms). 없거나 못 읽으면 null. */
export function rowCreatedAt(row: Record<string, unknown>): number | null {
  const raw = row?.["_createdTime"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

interface Sortable {
  tier: TierObject;
  ownerEntryId: string;
  ownerIndex: number;
  indexInOwner: number;
  at: number | null;
}

/**
 * 여러 계약 줄의 같은 종류 차수를 하나로 합친다(오래된 것부터).
 *
 * @param rows     그 회사의 정책 계약 줄들. 첫 줄이 대표다.
 * @param dataKey  "계약정보_차수" · "정산정보" · "환불정보_차수"
 */
export function mergeTiersAcrossRows(
  rows: ReadonlyArray<PolicyRowForMerge>,
  dataKey: string,
): { tiers: TierObject[]; refByTierId: Map<string, MergedTierRef>; refByPosition: MergedTierRef[] } {
  const items: Sortable[] = [];
  // 같은 차수 id 가 두 줄에 얹혀 오면 한 번만 싣는다 — 안 그러면 합계가 부푼다
  // (표 쪽 harvestTiersFrom 이 같은 이유로 id 중복을 막는다).
  const seen = new Set<string>();

  rows.forEach((r, ownerIndex) => {
    const arr = parseTierArray(r.row?.[dataKey]);
    const rowAt = rowCreatedAt(r.row ?? {});
    arr.forEach((tier, indexInOwner) => {
      const id = tierIdOf(tier);
      if (id) {
        if (seen.has(id)) return;
        seen.add(id);
      }
      items.push({
        tier,
        ownerEntryId: r.entryId,
        ownerIndex,
        indexInOwner,
        at: tierCreatedAtFromId(id) ?? rowAt,
      });
    });
  });

  items.sort((a, b) => {
    // 시각을 모르는 차수는 아는 차수보다 **앞**(오래된 쪽)에 둔다 — 옛 자료라서 모르는 것이다.
    if (a.at !== b.at) {
      if (a.at === null) return -1;
      if (b.at === null) return 1;
      return a.at - b.at;
    }
    if (a.ownerIndex !== b.ownerIndex) return a.ownerIndex - b.ownerIndex;
    return a.indexInOwner - b.indexInOwner;
  });

  const refByTierId = new Map<string, MergedTierRef>();
  const refByPosition: MergedTierRef[] = [];
  const tiers: TierObject[] = [];
  for (const it of items) {
    const ref = { ownerEntryId: it.ownerEntryId, ownerIndex: it.ownerIndex };
    tiers.push(it.tier);
    refByPosition.push(ref);
    const id = tierIdOf(it.tier);
    if (id) refByTierId.set(id, ref);
  }
  return { tiers, refByTierId, refByPosition };
}

/**
 * 합쳐 보여 준 목록이 저장될 때 — 차수를 **원래 줄로 되돌려** 나눈다.
 *
 * @param saved        화면이 돌려준 차수 배열(추가·삭제·수정이 반영된 상태)
 * @param refByTierId  합칠 때 만든 「차수 id → 원래 줄」 지도
 * @param owners       그 회사의 계약 줄 id 들(첫 개가 대표)
 * @returns 줄 id → 그 줄에 저장할 차수 배열. **줄마다 빠짐없이** 돌려준다(빈 배열 포함) —
 *          그래야 마지막 차수를 지운 줄도 빈 배열로 저장돼 실제로 사라진다.
 */
export function splitMergedTiers(
  saved: ReadonlyArray<TierObject>,
  refByTierId: ReadonlyMap<string, MergedTierRef>,
  owners: ReadonlyArray<string>,
): Map<string, TierObject[]> {
  const out = new Map<string, TierObject[]>();
  for (const id of owners) out.set(id, []);
  const primary = owners[0] ?? "";
  for (const tier of saved) {
    const ref = refByTierId.get(tierIdOf(tier));
    // 모르는 차수 = 화면에서 새로 만든 것 → 대표 줄에 붙인다.
    const target = ref && out.has(ref.ownerEntryId) ? ref.ownerEntryId : primary;
    if (!target) continue;
    const list = out.get(target);
    if (list) list.push(tier);
  }
  return out;
}

/** 값이 하나라도 든 차수인가(id·label 은 값으로 치지 않는다). */
export function tierHasContent(tier: TierObject | undefined | null): boolean {
  if (!tier) return false;
  for (const [k, v] of Object.entries(tier)) {
    if (k === "id" || k === "label" || k.startsWith("_")) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return true;
  }
  return false;
}

/** 차수에 값이 든 칸 수 — 삭제 확인창이 「무엇을 지우는지」 보여 줄 때 쓴다. */
export function filledFieldCount(tier: TierObject | undefined | null): number {
  if (!tier) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(tier)) {
    if (k === "id" || k === "label" || k.startsWith("_")) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    n += 1;
  }
  return n;
}
