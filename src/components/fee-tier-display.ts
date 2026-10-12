// 서버가 승인한 수수료 표시값을 차수 칸·합계 카드에 그대로 잇는 읽기 전용 계산부.
//
// 원칙
//  · 읽기만 한다. 차수 원본·칸 정의를 바꾸거나, 보여 준 값을 저장 값으로 되돌려 쓰지 않는다.
//  · 서버 대상(target.fields)에 들어 있는 칸, 또는 칸 정의에 자기 소유 feeStandard(version 1) 표식이 붙은
//    칸은 서버가 정한 값(0·null·빈 글자 포함)만 쓴다. 못 찾았거나 막혔으면 옛 수식·저장값·0 으로 채우지 않고
//    '풀리지 않음'으로 둔다. 표식이 깨졌어도 옛 방식으로 돌아가지 않는다.
//  · 그 칸에 기대는 일반 수식은 복사본(표시 전용) 차수·칸 정의에서 같은 선택값으로 계산한다.
//  · 표식도 선택 함수도 없는 화면, 그리고 선택 함수가 '옛 방식'이라고 답한 차수는 LEGACY — 기존 동작 그대로.

import {
  evalFormulaForTierDetailed,
  getTierOverride,
  isNumericFieldType,
  overrideKeyOf,
  parseFormulaTerms,
  type FeePublicTargetV1,
  type FieldDef,
  type FormulaBlock,
  type FormulaTerm,
  type TierData,
} from "@wedly/ui-shared";

/** 차수 하나가 서버 수수료 표시 대상인지 알려 주는 선택 함수의 답. */
export type FeeTierView =
  | { mode: "legacy" }
  | { mode: "blocked"; message: string }
  | { mode: "standard"; target: FeePublicTargetV1 };

/** 차수마다 어느 서버 대상을 볼지 정해 주는 선택 함수. 안 넘기면 표식 없는 칸만 옛 방식이다. */
export type FeeTargetForTier = (tier: TierData) => FeeTierView;

export type FeeValueSource = "automatic" | "manual" | "finalized" | "unverified-historical";

/** 합계가 부분합이 되지 않도록 '풀리지 않은 서버 칸이 끼어 있다'를 나타내는 값. 숫자가 아니므로 카드에는 '-' 로 나온다. */
export type FeeUnresolved = { kind: "fee-unresolved"; message: string };

export type FeeFieldSelection =
  | { state: "legacy" }
  | { state: "unresolved"; message: string }
  | { state: "blocked"; blocked: FormulaBlock }
  | {
      state: "selected";
      /** true 면 서버가 직접 정한 칸, false 면 그 칸에 기대는 일반 수식의 결과 */
      managed: boolean;
      value: string | number | null;
      /** 합산에 쓰는 숫자. 빈 값·숫자가 아닌 칸은 null */
      amount: number | null;
      source: FeeValueSource | null;
      automaticValue: number | null;
    };

export type FeeTierContext = {
  /** 서버 표시 대상 차수 — 옛 비율 자동 채움·연쇄 계산을 끈다. */
  readonly serverManaged: boolean;
  select(field: FieldDef): FeeFieldSelection;
  /** 수동값이 걸린 일반 수식 칸의 '수식 계산값'(툴팁용). 풀리지 않았거나 해당 없으면 null. */
  calculatedWithoutOverride(field: FieldDef): number | null;
};

type ConditionValues = Parameters<typeof evalFormulaForTierDetailed>[4];

const LEGACY: FeeFieldSelection = { state: "legacy" };

export const LEGACY_FEE_CONTEXT: FeeTierContext = {
  serverManaged: false,
  select: () => LEGACY,
  calculatedWithoutOverride: () => null,
};

const SOURCES: ReadonlySet<string> = new Set<FeeValueSource>(["automatic", "manual", "finalized", "unverified-historical"]);

const RELOAD = "화면을 새로고침한 뒤 다시 확인해 주세요.";
const NO_RESOLVER_MESSAGE = `수수료 표시 정보를 아직 받지 못했어요. ${RELOAD}`;
const INVALID_VIEW_MESSAGE = `수수료 정보를 확인하지 못했어요. ${RELOAD}`;
const BAD_ENTRY_MESSAGE = `서버가 보낸 이 칸의 값을 읽지 못했어요. ${RELOAD}`;
const MISSING_MESSAGE = `이 칸의 수수료 값을 받지 못했어요. ${RELOAD}`;
const GENERIC_BLOCKED_MESSAGE = "수수료 계산에 필요한 기준을 확인해 주세요.";
const BLOCK_REASON_MESSAGES: Readonly<Record<string, string>> = {
  "fee-base-vat-basis-unconfirmed": "부가세 기준이 아직 확정되지 않아 수수료를 보여 드릴 수 없어요. 기준 금액을 확인해 주세요.",
};

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 풀리지 않은 서버 칸이 낀 합계의 안내문(카드 툴팁용). 해당 없으면 undefined. */
export function feeUnresolvedMessage(value: unknown): string | undefined {
  return isRecord(value) && value.kind === "fee-unresolved" && typeof value.message === "string"
    ? value.message
    : undefined;
}

/** 합산 한 걸음 — 옛 방식 칸이면 null(부르는 쪽이 기존 계산을 한다), 풀리지 않았으면 합계를 막는다. */
export function addFeeSelection(sum: number, selection: FeeFieldSelection): number | FormulaBlock | FeeUnresolved | null {
  if (selection.state === "unresolved") return { kind: "fee-unresolved", message: selection.message };
  if (selection.state === "blocked") return selection.blocked;
  if (selection.state === "selected") return sum + (selection.amount ?? 0);
  return null;
}

/** '실제로 더할 값이 있나' 한 걸음 — 옛 방식 칸이면 null. 0 은 값이고, 빈 값·풀리지 않음은 값이 아니다. */
export function feeSelectionHasValue(selection: FeeFieldSelection): boolean | null {
  if (selection.state === "legacy") return null;
  return selection.state === "selected" && typeof selection.amount === "number" && Number.isFinite(selection.amount);
}

function isDateFormula(field: FieldDef): boolean {
  return field.type === "formula" && field.formulaResult === "date";
}

function validMarker(marker: unknown): boolean {
  return isRecord(marker) && marker.version === 1;
}

/** 숫자·숫자 글자는 숫자로, null·빈 글자는 null(빈 값)로, 그 밖은 undefined(읽을 수 없음). */
function parseAmount(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return null;
    return /^[+-]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : undefined;
  }
  return undefined;
}

type ManagedState =
  | { ok: true; value: string | number | null; amount: number | null; source: FeeValueSource; automaticValue: number | null }
  | { ok: false; message: string };

function parseEntry(entry: unknown, numeric: boolean): ManagedState {
  const bad: ManagedState = { ok: false, message: BAD_ENTRY_MESSAGE };
  if (!isRecord(entry) || !hasOwn(entry, "value")) return bad;
  const sourceRaw = entry.source;
  if (typeof sourceRaw !== "string" || !SOURCES.has(sourceRaw)) return bad;
  const source = sourceRaw as FeeValueSource;
  const automaticValue = parseAmount(entry.automaticValue) ?? null;
  if (numeric) {
    const amount = parseAmount(entry.value);
    if (amount === undefined) return bad;
    return { ok: true, value: amount, amount, source, automaticValue };
  }
  const value = entry.value;
  if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    return { ok: true, value, amount: null, source, automaticValue };
  }
  return bad;
}

type ClassifiedView =
  | { kind: "absent" }
  | { kind: "legacy" }
  | { kind: "invalid" }
  | { kind: "blocked"; message: string }
  | { kind: "standard"; fields: Record<string, unknown>; status: unknown; reason: unknown };

function classifyView(raw: unknown): ClassifiedView {
  if (!isRecord(raw)) return { kind: "invalid" };
  if (raw.mode === "legacy") return { kind: "legacy" };
  if (raw.mode === "blocked") {
    const message = typeof raw.message === "string" ? raw.message.trim() : "";
    return { kind: "blocked", message: message || GENERIC_BLOCKED_MESSAGE };
  }
  const target = raw.target;
  if (raw.mode === "standard" && isRecord(target)) {
    const targetFields = target.fields;
    if (isRecord(targetFields)) return { kind: "standard", fields: targetFields, status: target.status, reason: target.reason };
  }
  return { kind: "invalid" };
}

function missingMessage(view: { status: unknown; reason: unknown }): string {
  if (typeof view.reason === "string" && hasOwn(BLOCK_REASON_MESSAGES, view.reason)) return BLOCK_REASON_MESSAGES[view.reason];
  return view.status === "blocked" ? GENERIC_BLOCKED_MESSAGE : MISSING_MESSAGE;
}

function addKey(value: unknown, out: Set<string>): void {
  if (typeof value === "string" && value) out.add(value);
}

function termRefs(terms: ReadonlyArray<FormulaTerm>, out: Set<string>): void {
  for (const term of terms) {
    if (term.unit === "group") termRefs(term.terms ?? [], out);
    else if (term.unit === "column") addKey(term.columnKey, out);
  }
}

/** 비교 대상이 글자가 아니라 다른 칸을 가리키는 경우의 칸 키. */
function compareRefs(right: unknown, out: Set<string>): void {
  if (!isRecord(right) || right.kind === "text") return;
  for (const [prop, value] of Object.entries(right)) {
    if (prop !== "kind" && prop !== "value") addKey(value, out);
  }
}

/** 한 수식 칸이 직접 읽는 칸 — 열 항·묶음 안쪽·조건 칸(조건 규칙별 식 포함). */
function directRefs(field: FieldDef): Set<string> {
  const out = new Set<string>();
  termRefs(parseFormulaTerms(field.formula), out);
  const cond = (field as unknown as { conditional?: unknown }).conditional;
  if (isRecord(cond)) {
    addKey(cond.conditionFieldKey, out);
    if (Array.isArray(cond.rules)) {
      for (const rule of cond.rules) {
        if (!isRecord(rule)) continue;
        addKey(rule.leftKey, out);
        compareRefs(rule.right, out);
        termRefs(parseFormulaTerms(rule.formula as Parameters<typeof parseFormulaTerms>[0]), out);
        if (!Array.isArray(rule.clauses)) continue;
        for (const clause of rule.clauses) {
          if (!isRecord(clause)) continue;
          addKey(clause.leftKey, out);
          compareRefs(clause.right, out);
        }
      }
    }
  }
  return out;
}

/** 표시 전용 복사본의 서버 칸 — 수식·조건·표식을 떼어 낸 숫자 칸. 원본 정의는 건드리지 않는다. */
function standIn(field: FieldDef): FieldDef {
  const copy: Record<string, unknown> = { ...field };
  for (const prop of ["formula", "conditional", "formulaResult", "dateFormula", "feeStandard"]) delete copy[prop];
  // 수식의 퍼센트 결과는 이미 비율(0.1)이다. 직접 퍼센트 칸(10)만 /100 환산을 유지한다.
  copy.type = field.type === "percent"
    ? "percent"
    : isNumericFieldType(field.type) ? "number" : field.type;
  return copy as unknown as FieldDef;
}

/**
 * 차수 하나의 서버 수수료 표시 문맥을 만든다.
 * 표식도 선택 함수도 없거나 선택 함수가 '옛 방식'이라고 답하면 LEGACY_FEE_CONTEXT 를 돌려준다.
 */
export function createFeeTierContext(
  tier: TierData,
  fields: ReadonlyArray<FieldDef>,
  resolver: FeeTargetForTier | undefined,
  conditionValues: ConditionValues,
): FeeTierContext {
  const markers = new Map<string, boolean>(); // 칸 키 → 표식이 올바른가
  for (const field of fields) {
    if (isDateFormula(field)) continue; // 날짜는 대상이 아니다
    if (hasOwn(field, "feeStandard")) markers.set(field.key, validMarker((field as unknown as Record<string, unknown>).feeStandard));
    else if (hasOwn(field, "feeServerManaged")) markers.set(field.key, (field as unknown as Record<string, unknown>).feeServerManaged === true);
  }
  if (!resolver && markers.size === 0) return LEGACY_FEE_CONTEXT;

  const view = ((): ClassifiedView => {
    if (!resolver) return { kind: "absent" };
    try {
      return classifyView(resolver(tier));
    } catch {
      return { kind: "invalid" };
    }
  })();
  if (view.kind === "legacy" && markers.size === 0) return LEGACY_FEE_CONTEXT;
  if (view.kind !== "standard" && markers.size === 0) return LEGACY_FEE_CONTEXT;

  const byKey = new Map<string, FieldDef>();
  for (const field of fields) byKey.set(field.key, field);
  const managed = new Set<string>(markers.keys());
  if (view.kind === "standard") {
    for (const key of Object.keys(view.fields)) {
      const def = byKey.get(key);
      if (def && !isDateFormula(def)) managed.add(key);
    }
  }

  const states = new Map<string, ManagedState>();
  const stateOf = (key: string): ManagedState => {
    const hit = states.get(key);
    if (hit) return hit;
    let state: ManagedState;
    if (markers.get(key) === false) {
      state = { ok: false, message: INVALID_VIEW_MESSAGE };
    } else if (view.kind === "standard") {
      const def = byKey.get(key);
      state = hasOwn(view.fields, key)
        ? parseEntry(view.fields[key], def ? isNumericFieldType(def.type) : true)
        : { ok: false, message: missingMessage(view) };
    } else if (view.kind === "blocked") {
      state = { ok: false, message: view.message };
    } else {
      state = { ok: false, message: view.kind === "absent" ? NO_RESOLVER_MESSAGE : INVALID_VIEW_MESSAGE };
    }
    states.set(key, state);
    return state;
  };

  // 서버 칸과 연결되는 수식인지 분류한다. 실제 필요한 값의 막힘은 공용 계산기가 읽을 때만 판단한다.
  const dependencies = new Map<string, string[]>();
  const managedDependenciesOf = (field: FieldDef): string[] => {
    const cache = dependencies;
    const hit = cache.get(field.key);
    if (hit) return hit;
    const seen = new Set<string>([field.key]);
    const found = new Set<string>();
    const stack: FieldDef[] = [field];
    while (stack.length > 0) {
      const current = stack.pop() as FieldDef;
      for (const key of directRefs(current)) {
        if (managed.has(key)) found.add(key);
        if (seen.has(key)) continue;
        seen.add(key);
        const ref = byKey.get(key);
        if (ref && !managed.has(key) && ref.type === "formula" && !isDateFormula(ref)) stack.push(ref);
      }
    }
    const list = [...found];
    cache.set(field.key, list);
    return list;
  };
  const readBlock = (field: FieldDef): FormulaBlock | undefined => {
    if (!managed.has(field.key) || stateOf(field.key).ok) return undefined;
    return { kind: "missing", from: field.key, keys: [field.key] };
  };

  // 표시 전용 복사본 — 서버 칸을 선택값이 든 숫자 칸으로 바꾼다. 원본 차수·정의·저장 모양은 그대로다.
  let detached: { tier: TierData; fields: FieldDef[]; conditionValues: ConditionValues } | null = null;
  const detachedView = (): { tier: TierData; fields: FieldDef[]; conditionValues: ConditionValues } => {
    if (detached) return detached;
    const copy: Record<string, unknown> = { ...tier };
    const conditions = { ...conditionValues };
    for (const key of managed) {
      delete copy[overrideKeyOf(key)];
      const state = stateOf(key);
      copy[key] = state.ok ? state.value : null;
      // 공유 계산기는 빈 차수 값을 평면 행에서 다시 찾는다. 그 사본에도 같은 선택값을 덮어 옛 값 부활을 막는다.
      conditions[key] = copy[key];
    }
    detached = {
      tier: copy as unknown as TierData,
      fields: fields.map((field) => (managed.has(field.key) ? standIn(field) : field)),
      conditionValues: conditions,
    };
    return detached;
  };

  const selected = (value: number | null): FeeFieldSelection => (
    { state: "selected", managed: false, value, amount: value, source: null, automaticValue: null }
  );

  const compute = (field: FieldDef): FeeFieldSelection => {
    if (managed.has(field.key)) {
      const state = stateOf(field.key);
      return state.ok
        ? { state: "selected", managed: true, value: state.value, amount: state.amount, source: state.source, automaticValue: state.automaticValue }
        : { state: "unresolved", message: state.message };
    }
    if (field.type !== "formula" || isDateFormula(field)) return LEGACY;
    const deps = managedDependenciesOf(field);
    if (deps.length === 0) return LEGACY;
    // 이 칸에 직접 넣어 둔 수동값은 기대는 서버 칸이 막혀도 그대로 산다.
    const own = getTierOverride(tier, field.key);
    if (own !== null) return selected(own);
    const display = detachedView();
    const result = evalFormulaForTierDetailed(field, display.tier, display.fields, undefined, display.conditionValues, readBlock);
    if (result.blocked) {
      // 필요한 서버 값이 없어서 막혔을 때만 서버의 사유를 보여 준다. 거짓 조건 분기의 값은 읽지 않는다.
      if (managed.has(result.blocked.from)) {
        const state = stateOf(result.blocked.from);
        if (!state.ok) return { state: "unresolved", message: state.message };
      }
      return { state: "blocked", blocked: result.blocked };
    }
    return selected(typeof result.value === "number" && Number.isFinite(result.value) ? result.value : null);
  };

  const cache = new Map<string, FeeFieldSelection>();
  return {
    serverManaged: true,
    select(field) {
      const hit = cache.get(field.key);
      if (hit) return hit;
      const result = compute(field);
      cache.set(field.key, result);
      return result;
    },
    calculatedWithoutOverride(field) {
      if (field.type !== "formula" || isDateFormula(field) || managed.has(field.key)) return null;
      const deps = managedDependenciesOf(field);
      if (deps.length === 0) return null;
      const display = detachedView();
      const base: Record<string, unknown> = { ...display.tier };
      delete base[overrideKeyOf(field.key)];
      const result = evalFormulaForTierDetailed(field, base as unknown as TierData, display.fields, undefined, display.conditionValues, readBlock);
      return !result.blocked && typeof result.value === "number" && Number.isFinite(result.value) ? result.value : null;
    },
  };
}
