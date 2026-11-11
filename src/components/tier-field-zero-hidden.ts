// 차수 카드에서 "값이 0이 아닐 때만 보이는 칸" — 차수마다 따로 판정한다.
// ─────────────────────────────────────────────────────────────────────────────
// tier-field-hidden.ts 의 hidden 은 칸을 모든 차수에서 항상 감춘다. 이 파일은 그 옆에서,
// 같은 칸이라도 그 차수의 값이 0이거나 비었으면 감추고 0이 아니면 보이게 한다.
// (정부지원금 계약 차수의 [올카데미] 계약금 수수료, 환불 차수의 [올카데미] 환불 수수료 — 몫이 있는 차수에서만 보인다.)
//
// 감춰도 칸 정의·저장값·합계는 그대로다. 그릴 때만 거른다 — 집계와 위들리 몫(나머지) 계산은 이 파일과 무관하다.
// 규칙을 받는 칸이 아니면 값을 계산하지도 않아 다른 칸의 화면은 한 톨도 달라지지 않는다.
// ─────────────────────────────────────────────────────────────────────────────
import { evalFormulaForTier, type FieldDef, type TierData } from "@wedly/ui-shared";
import type { FeeTierContext } from "./fee-tier-display";

/** 칸 정의에 표시(hideWhenZero)를 붙이지 않아도 기본으로 이 규칙을 받는 칸. 기준표 재등록이 칸 정의를 새로 써도 유지된다.
 *  환불 칸은 계약금 칸과 같은 규칙을 받는다(정산 요청 3 — 환불도 계약금과 같은 규칙으로 답받음). */
const ZERO_HIDDEN_FIELD_KEYS: ReadonlySet<string> = new Set(["[올카데미]_계약금_수수료", "[올카데미]_환불_수수료"]);

export function tierFieldHiddenWhenZero(field: unknown): boolean {
  if (!field || typeof field !== "object") return false;
  const f = field as Record<string, unknown>;
  // 정확히 true 일 때만 — "true" 문자열·1 같은 값으로 실수로 감추지 않게(tierFieldHidden 과 같은 기준).
  if (f.hideWhenZero === true) return true;
  return typeof f.key === "string" && ZERO_HIDDEN_FIELD_KEYS.has(f.key);
}

/** 0이 아닌 숫자(또는 그렇게 읽히는 글자)면 true. 비었거나 0이거나 숫자가 아니면(풀리지 않은 값 포함) false. */
export function isShownNonZeroValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value !== "string") return false;
  const text = value.replace(/[,\s원]/g, "");
  if (text === "") return false;
  const n = Number(text);
  return Number.isFinite(n) && n !== 0;
}

/** 이 칸을 이 값으로 감춰야 하는가 — 규칙을 받는 칸이면서 값이 0이 아닌 숫자가 아닐 때. */
export function tierFieldHiddenByZeroValue(field: unknown, value: unknown): boolean {
  return tierFieldHiddenWhenZero(field) && !isShownNonZeroValue(value);
}

/**
 * 차수 카드가 이 칸에 그리는 값(SettlementInfoTab 의 shownValue 와 같은 순서)을 읽는다.
 * 규칙을 받는 칸일 때만 읽고, 아니면 아무것도 계산하지 않고 null 을 돌려준다.
 * 서버가 정한 칸(selected)은 서버 값, 풀리지 않았거나 막혔으면 값 없음, 옛 방식이면 수식 계산값·저장값이다.
 */
export function zeroHiddenFieldValue(
  field: FieldDef,
  tier: TierData,
  fields: FieldDef[],
  feeContext: FeeTierContext,
  conditionValues?: Record<string, unknown>,
): unknown {
  if (!tierFieldHiddenWhenZero(field)) return null;
  const sel = feeContext.select(field);
  if (sel.state === "selected") return sel.value;
  if (sel.state === "unresolved" || sel.state === "blocked") return null;
  return field.type === "formula"
    ? evalFormulaForTier(field, tier, fields, undefined, conditionValues)
    : (tier[field.key] ?? null);
}
