// 경정청구 계약 차수 카드의 「수수료(VAT 제외) · 부가세 · 총 수수료(VAT 포함)」 입력 규칙.
// ─────────────────────────────────────────────────────────────────────────────
// 세 칸은 수식이 아니라 사람이 넣는 칸이다. 칸마다 값이 어디서 왔는지(출처)를 차수 데이터에 같이 저장한다.
//   _src_<칸키> = "notice"(수수료안내문) | "calc"(수수료로 계산) | "legacy"(기존 계산값) | "manual"(사람이 고침)
//   _nt_<칸키>  = 칸 아래에 보일 사유 글(예: 「자동 입력 실패」). 칸을 고치면 지운다.
// 이 키들은 수식 수동값(_ovr_*)·수수료 개정 표식(_cf_*)과 겹치지 않는다.
//
// 규칙
//   · 수수료를 넣으면 부가세 = floor(수수료 × 10%), 총 = 수수료 + 부가세. 출처가 manual 인 칸은 다시 계산하지 않는다.
//   · 다시 계산한 칸의 출처는 calc.
//   · notice / calc / legacy 값을 사람이 고치면 manual("(수정됨)"). 수수료를 **처음** 손으로 넣는 것은 시작값이라 manual 이 아니다.
//   · 부가세·총을 직접 고쳐도 다른 칸을 따라 바꾸지 않는다. 합이 안 맞으면 경고만 한다(저장은 막지 않는다).
// ERP 서버(src/lib/domains/tax-amendment/fee-input-rules.ts)가 같은 계산을 한다 — 시험 표를 양쪽이 똑같이 쓴다.
// ─────────────────────────────────────────────────────────────────────────────
import type { FieldDef, TierData } from "@wedly/ui-shared";

export const FEE_KEY = "수수료_반올림";
export const VAT_KEY = "부가세";
export const TOTAL_KEY = "총수수료_부가세포함";
export const FEE_INPUT_KEYS: readonly string[] = [FEE_KEY, VAT_KEY, TOTAL_KEY];

export type FeeSource = "notice" | "calc" | "legacy" | "manual";
const SOURCES: readonly string[] = ["notice", "calc", "legacy", "manual"];

export const feeSourceKey = (key: string) => `_src_${key}`;
export const feeNoteKey = (key: string) => `_nt_${key}`;

export function isFeeInputKey(key: string): boolean {
  return FEE_INPUT_KEYS.includes(key);
}

/** 세 칸이 모두 수식이 아닌 숫자 입력 칸일 때만 이 규칙을 쓴다 — 옛 정의(수식 칸)에서는 기존 동작 그대로. */
export function isFeeInputCard(fields: ReadonlyArray<Pick<FieldDef, "key" | "type">>): boolean {
  return FEE_INPUT_KEYS.every((k) => fields.some((f) => f.key === k && f.type === "number"));
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function readFeeSource(tier: Record<string, unknown>, key: string): FeeSource | null {
  const v = tier[feeSourceKey(key)];
  return typeof v === "string" && SOURCES.includes(v) ? (v as FeeSource) : null;
}

export function readFeeNote(tier: Record<string, unknown>, key: string): string | null {
  const v = tier[feeNoteKey(key)];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** 수수료(VAT 제외)에서 부가세 — 원 단위 내림. 정수 나눗셈이라 부동소수 오차가 없다. */
export function vatOf(fee: number): number {
  return Math.floor(fee / 10);
}

/**
 * 사람이 세 칸 중 하나를 고친 뒤의 차수를 돌려준다(원본은 바꾸지 않는다). 값이 그대로면 같은 객체를 돌려준다.
 */
export function applyFeeInputEdit(tier: TierData, key: string, value: unknown): TierData {
  if (!isFeeInputKey(key)) return { ...tier, [key]: value as TierData[string] };
  const nextValue = toNumber(value);
  const currentValue = toNumber(tier[key]);
  if (nextValue === currentValue) return tier;

  const out: TierData = { ...tier, [key]: nextValue };
  delete out[feeNoteKey(key)];
  const currentSource = readFeeSource(tier, key);

  const setCalc = (k: string, v: number | null) => {
    out[k] = v;
    delete out[feeNoteKey(k)];
    if (v === null) delete out[feeSourceKey(k)];
    else out[feeSourceKey(k)] = "calc";
  };
  const recalcFrom = (fee: number | null) => {
    // 수수료를 비우면 우리가 계산해 둔 값(calc)만 같이 비운다 — 안내문·기존 값은 그대로 둔다.
    if (fee === null) {
      for (const k of [VAT_KEY, TOTAL_KEY]) if (readFeeSource(out, k) === "calc") setCalc(k, null);
      return;
    }
    if (readFeeSource(out, VAT_KEY) !== "manual") setCalc(VAT_KEY, vatOf(fee));
    if (readFeeSource(out, TOTAL_KEY) !== "manual") setCalc(TOTAL_KEY, fee + (toNumber(out[VAT_KEY]) ?? vatOf(fee)));
  };

  if (key === FEE_KEY) {
    if (nextValue === null) delete out[feeSourceKey(key)];
    // 값이 있던 칸을 안내문·계산·기존 값 위에서 고치면 사람이 고친 값. 비어 있던 칸의 첫 입력은 시작값.
    else if (currentValue !== null && currentSource !== null && currentSource !== "manual") out[feeSourceKey(key)] = "manual";
    recalcFrom(nextValue);
    return out;
  }

  // 부가세·총: 비우면 출처를 지우고 수수료가 있으면 계산값으로 되돌린다. 값을 넣으면 manual.
  if (nextValue === null) {
    delete out[feeSourceKey(key)];
    const fee = toNumber(out[FEE_KEY]);
    if (fee !== null) {
      if (key === VAT_KEY) {
        setCalc(VAT_KEY, vatOf(fee));
        // 총이 계산값이면 되돌린 부가세로 다시 맞춘다 — 안내문·기존·사람이 고친 총은 그대로 둔다.
        if (readFeeSource(out, TOTAL_KEY) === "calc") setCalc(TOTAL_KEY, fee + vatOf(fee));
      } else setCalc(TOTAL_KEY, fee + (toNumber(out[VAT_KEY]) ?? vatOf(fee)));
    }
    return out;
  }
  out[feeSourceKey(key)] = "manual";
  return out;
}

/** 수수료 + 부가세 ≠ 총 수수료일 때 차이(총 − (수수료 + 부가세)). 세 칸이 모두 숫자일 때만 따진다. */
export function feeMismatchDiff(tier: Record<string, unknown>): number | null {
  const fee = toNumber(tier[FEE_KEY]);
  const vat = toNumber(tier[VAT_KEY]);
  const total = toNumber(tier[TOTAL_KEY]);
  if (fee === null || vat === null || total === null) return null;
  const diff = total - (fee + vat);
  return diff === 0 ? null : diff;
}

export function feeMismatchMessage(diff: number): string {
  return `수수료 + 부가세가 총 수수료와 다릅니다(차이 ${Math.abs(diff).toLocaleString("ko-KR")}원)`;
}

/** 사람이 고친 값인가 — 칸 옆에 기존 「(수정됨)」 배지를 보인다. */
export function isFeeManual(tier: Record<string, unknown>, key: string): boolean {
  return isFeeInputKey(key) && readFeeSource(tier, key) === "manual";
}

/** 칸 아래 작은 글씨 — 저장된 사유가 먼저, 없으면 출처 설명. 사람이 고친 값은 배지로만 알리고 글은 없다. */
export function feeFieldHint(tier: Record<string, unknown>, key: string): string | null {
  if (!isFeeInputKey(key)) return null;
  const note = readFeeNote(tier, key);
  if (note) return note;
  if (toNumber(tier[key]) === null) return null;
  switch (readFeeSource(tier, key)) {
    case "legacy": return "안내문 없음 - 기존 계산값";
    case "notice": return "수수료안내문 값";
    case "calc": return "수수료로 계산한 값";
    default: return null;
  }
}

/**
 * 공용 parseTiers 는 칸 정의에 있는 키만 옮겨 담아 `_src_*`·`_nt_*` 를 버린다 — 다시 저장될 때 사라지지 않게 원문에서 되살린다.
 * 차수 개수가 같을 때만 같은 순서로 옮긴다(빈 값·깨진 글은 기본 차수가 만들어져 개수가 다르다).
 */
export function carryFeeInputMeta(raw: unknown, tiers: TierData[]): TierData[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return tiers; }
  }
  if (!Array.isArray(arr) || arr.length !== tiers.length) return tiers;
  return tiers.map((tier, i) => {
    const item = arr[i];
    if (!item || typeof item !== "object") return tier;
    let out = tier;
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!key.startsWith("_src_") && !key.startsWith("_nt_")) continue;
      const v = (item as Record<string, unknown>)[key];
      if (typeof v !== "string") continue;
      if (out === tier) out = { ...tier };
      out[key] = v;
    }
    return out;
  });
}
