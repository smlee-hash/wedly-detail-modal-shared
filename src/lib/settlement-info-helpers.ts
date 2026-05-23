// 경정청구 정산정보 — 사용자 정의 필드 지원 (서버·클라이언트 공용 헬퍼)
//
// 데이터:
//   - 필드 정의: JsonCache["tax-amendment-settlement-fields"]
//     형식: Array<{ key, label, type: "text"|"date"|"number" }>
//   - 차수별 값: entry.data["정산정보"] = JSON string of Array<TierData>
//     형식: { id, label, [fieldKey]: string | number | null }
//
// 정책자금(policy-fund/settlement-info-helpers.ts) 와 동일 구조이나 도메인에 맞게
// 기본 필드(DEFAULT_FIELDS)만 경정청구용으로 정의.

export type FieldType = "text" | "date" | "number";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
}

// 정산 합계 스코어카드 정의 — 어드민이 카드 제목, 색, 계산식, 추가/삭제 모두 편집 가능.
// 계산식: 카드 값 = sum(plus 컬럼들) - sum(minus 컬럼들)
export type ScoreCardColor = "gray" | "blue" | "yellow" | "green" | "purple" | "red";

export interface ScoreCardDef {
  id: string;
  label: string;
  color: ScoreCardColor;
  formula: {
    plus: string[];
    minus: string[];
  };
}

// 기본 스코어카드 (마이그레이션 / fallback 용)
export const DEFAULT_SCORECARDS: ScoreCardDef[] = [
  { id: "refund",  label: "총 환급금",          color: "gray",   formula: { plus: ["총환급금"],   minus: [] } },
  { id: "success", label: "성공보수 총액",      color: "blue",   formula: { plus: ["성공보수총액"], minus: [] } },
  { id: "fee",     label: "컨설턴트 수수료 총액", color: "yellow", formula: { plus: ["컨설턴트수수료"], minus: [] } },
  { id: "revenue", label: "매출",              color: "green",  formula: { plus: ["성공보수총액"], minus: ["컨설턴트수수료"] } },
];

// 카드 색상 → Tailwind 클래스 토큰 매핑 (위들리 디자인)
export const SCORECARD_COLOR_CLASSES: Record<ScoreCardColor, { bg: string; valueText: string; labelText: string }> = {
  gray:   { bg: "bg-wedly-bg-gray",   valueText: "text-wedly-navy",   labelText: "text-wedly-muted" },
  blue:   { bg: "bg-wedly-bg-blue",   valueText: "text-wedly-accent", labelText: "text-wedly-accent" },
  yellow: { bg: "bg-wedly-bg-yellow", valueText: "text-wedly-orange", labelText: "text-wedly-orange" },
  green:  { bg: "bg-wedly-bg-green",  valueText: "text-wedly-green",  labelText: "text-wedly-green" },
  purple: { bg: "bg-wedly-bg-purple", valueText: "text-wedly-purple", labelText: "text-wedly-purple" },
  red:    { bg: "bg-wedly-bg-red",    valueText: "text-wedly-red",    labelText: "text-wedly-red" },
};

export function makeScoreCardId(): string {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 안전한 파싱 — 잘못된 데이터는 무시
export function parseScoreCards(raw: unknown): ScoreCardDef[] | null {
  if (!Array.isArray(raw)) return null;
  const allowedColors: ScoreCardColor[] = ["gray", "blue", "yellow", "green", "purple", "red"];
  const result: ScoreCardDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id : makeScoreCardId();
    const label = typeof o.label === "string" ? o.label : "";
    const color = (allowedColors.includes(o.color as ScoreCardColor) ? o.color : "gray") as ScoreCardColor;
    const f = (o.formula && typeof o.formula === "object") ? (o.formula as Record<string, unknown>) : {};
    const plus = Array.isArray(f.plus) ? (f.plus as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const minus = Array.isArray(f.minus) ? (f.minus as unknown[]).filter((x): x is string => typeof x === "string") : [];
    result.push({ id, label, color, formula: { plus, minus } });
  }
  return result;
}

export type TierData = {
  id: string;
  label: string;
} & Record<string, string | number | null>;

export const ORDINAL_KO = ["1차", "2차", "3차", "4차", "5차", "6차", "7차", "8차", "9차", "10차", "11차", "12차"];

// 기본 필드 (초기 상태) — 경정청구 도메인
export const DEFAULT_FIELDS: FieldDef[] = [
  { key: "환급금수령일", label: "환급금 수령일", type: "date" },
  { key: "환급내역", label: "환급 내역", type: "text" },
  { key: "총환급금", label: "총 환급금", type: "number" },
  { key: "성공보수총액", label: "성공보수", type: "number" },
  { key: "컨설턴트수수료", label: "컨설턴트 수수료", type: "number" },
  { key: "매출VAT포함", label: "WEDLY 매출 (VAT 포함)", type: "number" },
  { key: "매출VAT제외", label: "WEDLY 매출 (VAT 제외)", type: "number" },
  { key: "담당컨설턴트", label: "담당 컨설턴트", type: "text" },
  { key: "컨설턴트수수료정산일", label: "컨설턴트 수수료 정산일", type: "date" },
  { key: "정산일", label: "성공보수 수금일", type: "date" },
];

export function makeEmptyTier(idx: number, fields: FieldDef[]): TierData {
  const ord = ORDINAL_KO[idx] || `${idx + 1}차`;
  const tier: TierData = {
    id: `tier-${idx + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: `${ord} 정산`,
  };
  for (const f of fields) {
    tier[f.key] = f.type === "number" ? null : "";
  }
  return tier;
}

export function makeDefaultTiers(fields: FieldDef[]): TierData[] {
  return [makeEmptyTier(0, fields), makeEmptyTier(1, fields), makeEmptyTier(2, fields)];
}

export function parseTiers(raw: unknown, fields: FieldDef[]): TierData[] {
  if (!raw) return makeDefaultTiers(fields);
  let arr: unknown;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return makeDefaultTiers(fields); }
  } else { arr = raw; }
  if (!Array.isArray(arr) || arr.length === 0) return makeDefaultTiers(fields);

  return arr.map((t, i): TierData => {
    const ord = ORDINAL_KO[i] || `${i + 1}차`;
    const item = (t || {}) as Record<string, unknown>;
    const tier: TierData = {
      id: typeof item.id === "string" ? item.id : `tier-${i + 1}-${i}`,
      label: typeof item.label === "string" ? item.label : `${ord} 정산`,
    };
    for (const f of fields) {
      const v = item[f.key];
      if (f.type === "number") {
        tier[f.key] = typeof v === "number" ? v : (v === null || v === undefined || v === "" ? null : Number(v) || null);
      } else {
        tier[f.key] = typeof v === "string" ? v : "";
      }
    }
    return tier;
  });
}

export function relabelTiers(tiers: TierData[]): TierData[] {
  return tiers.map((t, i) => ({ ...t, label: `${ORDINAL_KO[i] || `${i + 1}차`} 정산` }));
}

export function generateFieldKey(label: string, existing: FieldDef[]): string {
  const base = label.trim().replace(/\s+/g, "_") || "field";
  let key = base;
  let n = 1;
  const used = new Set(existing.map((f) => f.key));
  while (used.has(key)) {
    n += 1;
    key = `${base}_${n}`;
  }
  return key;
}
