/**
 * 한 회사의 정부지원금 계약 줄 여러 개에 흩어져 있는 차수를 **한 목록**으로 합친다.
 *
 * 왜 필요한가 (노션 「담당 컨설턴트 컬럼 상세정보 ↔ 데이터테이블 연동 오류」, 사장님 지시 2026-09-17)
 *   한 회사에 정책자금 계약 줄이 여러 개일 수 있다(운영 실측 2026-09-16: 180곳).
 *   표는 2026-08-25부터 「계약 한 건 = 한 줄」로 합쳐 보여 주는데 **상세창만 「계약 1·2·3」
 *   알약으로 나뉘어** 있었다. 그래서 같은 회사인데 표와 상세가 서로 다른 담당 컨설턴트를
 *   보여 줬다 — 이번 요청의 뿌리다. 알약을 없애고 여기서 합친다.
 *
 * ★주인을 어떻게 기억하나 — **차수 id 안에 박아 넣는다.**
 *   합친 목록의 차수 id 는 `gm<줄번호>~<원래 id>` 꼴이고, 저장할 때 다시 원래 id 로 되돌린다.
 *   처음에는 「id → 주인」 지도를 따로 들고 있었는데, 독립 리뷰가 두 가지 치명 결함을 잡았다:
 *     · **F1(치명)** 두 계약 줄에 같은 차수 id 가 있으면(실제로 생긴다 — 아래) 지도에 한쪽만
 *       실려, 다음 저장 때 다른 줄의 차수가 **빈 배열로 덮여 영구 삭제**됐다.
 *     · **F2(높음)** id 없는 옛 차수는 지도에 안 실리는데, 화면 부품(`parseTiers`)이 내려가면서
 *       `tier-1-0` 같은 **합성 id** 를 붙여 돌려준다. 그래서 원래 줄이 아니라 대표 줄로
 *       (운 나쁘면 **남의 줄**로) 저장됐다.
 *   같은 id 가 실제로 겹치는 이유: `parseTiers` 가 붙이는 합성 id 는 `tier-<자리>-<번호>` 로
 *   **결정적**이라, 줄마다 따로 저장되던 알약 시절에 두 줄의 첫 차수가 둘 다 `tier-1-0` 이 된다.
 *   id 에 줄 번호를 박으면 겹칠 수가 없고, 화면을 한 바퀴 돌아와도 주인이 그대로 붙어 온다
 *   (`parseTiers` 는 id 를 글자 그대로 보존한다 — 다른 키는 떨어져 나가므로 id 여야 한다).
 *
 * 순서 규칙
 *   - 배열은 **오래된 것부터**. 차수 번호(1차·2차…)를 그 자리로 매기기 때문이다.
 *     화면은 displayOrderNewestFirst 가 뒤집어 최신을 맨 위에 그린다(사장님 지시 2026-09-17).
 *   - 만든 시각은 원래 차수 id 에 박혀 있다(`tier-1-1785721457223-ad97` → 1785721457223).
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

/** 합친 목록에서만 쓰는 id 앞머리. 실제 저장값에는 절대 나가지 않는다. */
const MERGED_PREFIX = "gm";
const MERGED_SEP = "~";
/** 원래 id 가 없던 차수의 자리 표시 — 줄 안 위치로 고정해 되돌아갈 자리를 잃지 않는다. */
const NO_ID = "noid";

/** 합친 목록용 id 를 만든다. */
export function makeMergedTierId(ownerIndex: number, originalId: string, indexInOwner: number): string {
  const tail = originalId || `${NO_ID}${indexInOwner}`;
  return `${MERGED_PREFIX}${ownerIndex}${MERGED_SEP}${tail}`;
}

/**
 * 합친 목록의 id 를 「주인 줄 번호 + 원래 id」로 되푼다.
 * 합친 id 가 아니면 null — 화면에서 **새로 만든 차수**라는 뜻이다.
 */
export function parseMergedTierId(id: unknown): { ownerIndex: number; originalId: string } | null {
  if (typeof id !== "string" || !id.startsWith(MERGED_PREFIX)) return null;
  const sep = id.indexOf(MERGED_SEP);
  if (sep < 0) return null;
  const num = id.slice(MERGED_PREFIX.length, sep);
  if (!/^\d+$/.test(num)) return null;
  const tail = id.slice(sep + MERGED_SEP.length);
  // 자리 표시(noidN)는 「원래 id 가 없었다」는 뜻이라 빈 글자로 되돌린다.
  const originalId = new RegExp(`^${NO_ID}\\d+$`).test(tail) ? "" : tail;
  return { ownerIndex: Number(num), originalId };
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
  return tier && typeof tier.id === "string" ? tier.id.trim() : "";
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
  ownerIndex: number;
  indexInOwner: number;
  at: number | null;
}

/**
 * 여러 계약 줄의 같은 종류 차수를 하나로 합친다(오래된 것부터).
 * 각 차수의 id 는 `gm<줄번호>~<원래 id>` 로 바뀌어 나간다 — 주인을 잃지 않게.
 *
 * @param rows     그 회사의 정책 계약 줄들. 첫 줄이 대표다.
 * @param dataKey  "계약정보_차수" · "정산정보" · "환불정보_차수"
 */
export function mergeTiersAcrossRows(
  rows: ReadonlyArray<PolicyRowForMerge>,
  dataKey: string,
): { tiers: TierObject[] } {
  const items: Sortable[] = [];

  rows.forEach((r, ownerIndex) => {
    const arr = parseTierArray(r.row?.[dataKey]);
    const rowAt = rowCreatedAt(r.row ?? {});
    arr.forEach((tier, indexInOwner) => {
      const originalId = tierIdOf(tier);
      items.push({
        // ★id 를 갈아 끼운 **사본**을 만든다. 원본 객체는 건드리지 않는다.
        tier: { ...tier, id: makeMergedTierId(ownerIndex, originalId, indexInOwner) },
        ownerIndex,
        indexInOwner,
        at: tierCreatedAtFromId(originalId) ?? rowAt,
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

  return { tiers: items.map((i) => i.tier) };
}

/**
 * 합쳐 보여 준 목록이 저장될 때 — 차수를 **원래 줄로 되돌려** 나눈다.
 *
 * @param saved   화면이 돌려준 차수 배열(추가·삭제·수정이 반영된 상태)
 * @param owners  그 회사의 계약 줄 id 들(첫 개가 대표)
 * @returns 줄 id → 그 줄에 저장할 차수 배열. **줄마다 빠짐없이** 돌려준다(빈 배열 포함) —
 *          그래야 마지막 차수를 지운 줄도 빈 배열로 저장돼 실제로 사라진다.
 */
export function splitMergedTiers(
  saved: ReadonlyArray<TierObject>,
  owners: ReadonlyArray<string>,
): Map<string, TierObject[]> {
  const out = new Map<string, TierObject[]>();
  for (const id of owners) out.set(id, []);
  const primary = owners[0] ?? "";
  if (!primary) return out;

  for (const tier of saved) {
    const ref = parseMergedTierId(tier?.id);
    const target = ref && owners[ref.ownerIndex] ? owners[ref.ownerIndex] : primary;
    const restored: TierObject = { ...tier };
    if (ref) {
      // 원래 id 로 되돌린다. 원래 id 가 없던 차수는 id 키 자체를 뺀다 —
      // 화면 부품이 붙인 합성 id(`tier-1-0`)를 저장값에 새로 심지 않기 위해서다.
      if (ref.originalId) restored.id = ref.originalId;
      else delete restored.id;
    } else if (typeof restored.id === "string" && restored.id.startsWith(MERGED_PREFIX)) {
      // 합친 id 처럼 보이지만 못 읽은 값 — 그대로 내보내면 저장값이 더러워진다.
      delete restored.id;
    }
    const list = out.get(target);
    if (list) list.push(restored);
  }
  return out;
}

/** 값이 하나라도 든 차수인가(id·label 은 값으로 치지 않는다). */
export function tierHasContent(tier: TierObject | undefined | null): boolean {
  return filledFieldCount(tier) > 0;
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
