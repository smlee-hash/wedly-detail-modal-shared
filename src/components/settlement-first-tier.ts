/**
 * 정산 차수 목록 읽기·첫 칸 초안.
 *
 * 공용 `parseTiers`(@wedly/ui-shared)는 빈 배열을 빈 차수 1개로 만든다.
 * 기본(ensureFirstTier=false)은 명시적 빈 목록을 그대로 두어, 마지막 차수 삭제(`[]`)가
 * 빈 카드로 되살아나지 않게 한다. 정부 계약 탭만 ensureFirstTier 로 빈 목록도 첫 칸을 보여 준다.
 * 그 첫 칸은 저장하지 않은 초안이다 — 열기·칸 불러오기·새로고침에서는 쓰지 않는다.
 */
import { parseTiers, type FieldDef, type TierData } from "@wedly/ui-shared";

/** 명시적 빈 목록인가 — `[]` 또는 JSON `"[]"`. 빈 글자·null 은 여기 넣지 않는다(없는 값). */
export function isExplicitEmptyTierList(raw: unknown): boolean {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return false;
    try {
      arr = JSON.parse(t);
    } catch {
      return false;
    }
  }
  return Array.isArray(arr) && arr.length === 0;
}

/**
 * 저장된 차수 개수. 없거나 빈 목록은 0. 깨진 글자·배열이 아니면 -1(초안으로 보지 않음).
 */
function persistedTierCount(raw: unknown): number {
  if (raw == null) return 0;
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return 0;
    try {
      arr = JSON.parse(t);
    } catch {
      return -1;
    }
  }
  if (Array.isArray(arr)) return arr.length;
  return -1;
}

/**
 * 빈 목록은 그대로, 없거나 깨진 값만 공용 parseTiers 에 맡긴다.
 * 파서 정리 범위는 넓히지 않는다 — 값이 있으면 원문 raw 를 그대로 parseTiers 에 넘긴다.
 */
export function parseTiersKeepEmpty(raw: unknown, fields: FieldDef[]): TierData[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return parseTiers(raw, fields);
    try {
      arr = JSON.parse(t);
    } catch {
      return parseTiers(raw, fields);
    }
  }
  if (Array.isArray(arr) && arr.length === 0) return [];
  return parseTiers(raw, fields);
}

/**
 * ensureFirstTier 가 켜지면 명시적 빈 목록도 null 과 같이 공용 parseTiers 로 빈 차수 1개를 만든다.
 */
export function parseSettlementTiers(
  raw: unknown,
  fields: FieldDef[],
  ensureFirstTier = false,
): TierData[] {
  if (ensureFirstTier && isExplicitEmptyTierList(raw)) return parseTiers(null, fields);
  if (ensureFirstTier) return parseTiers(raw, fields);
  return parseTiersKeepEmpty(raw, fields);
}

/** 저장된 차수가 없어 화면에만 있는 첫 칸 초안인가. 저장된 빈 차수 객체는 해당하지 않는다. */
export function isUnsavedFirstTierDraft(raw: unknown, ensureFirstTier = false): boolean {
  if (!ensureFirstTier) return false;
  return persistedTierCount(raw) === 0;
}

/** 열기·불러오기 — 표시만. 저장 값은 만들지 않는다. */
export function loadSettlementTiers(
  raw: unknown,
  fields: FieldDef[],
  ensureFirstTier = false,
): { tiers: TierData[]; isDraft: boolean } {
  return {
    tiers: parseSettlementTiers(raw, fields, ensureFirstTier),
    isDraft: isUnsavedFirstTierDraft(raw, ensureFirstTier),
  };
}

/**
 * 마지막 저장 차수를 지운 뒤. ensureFirstTier 이면 저장은 `[]` 한 번, 화면은 새 빈 초안.
 */
export function afterLastTierRemoved(
  remaining: TierData[],
  fields: FieldDef[],
  ensureFirstTier = false,
): { persist: TierData[]; display: TierData[]; isDraft: boolean } {
  if (ensureFirstTier && remaining.length === 0) {
    return { persist: [], display: parseTiers(null, fields), isDraft: true };
  }
  return { persist: remaining, display: remaining, isDraft: false };
}

/** 마지막 차수 삭제 확인창의 앞문장. ensureFirstTier 일 때만 빈 첫 칸이 남는다고 적는다. */
export function lastTierDeleteWarning(ensureFirstTier = false): string {
  if (ensureFirstTier) {
    return "이 회사의 마지막 차수입니다. 지워도 회사 자료는 남고 빈 첫 입력칸이 다시 나타납니다. ";
  }
  return "이 회사의 마지막 차수입니다. 지워도 회사 자료는 남고 아래 「추가」로 다시 만들 수 있습니다. ";
}
