// 차수카드의 「비운 이유」·「적용 기준」 글.
//
// 정산 기준표(정확히 하나 방식)는 칸을 계산한 뒤 결과 기록을 차수 객체에 글자 키로 남긴다(공용 엔진 tiered 의 계약).
//   _fsr_<칸>  = 칸을 비운 이유 글(예: 「조건 중복 - 확인 필요」)
//   _fsb_<칸>  = 적용한 기준표 줄 글(예: 「정부지원금 13번 행」)
//   _ovr_<칸>  = 사람이 고친 값 — 항상 계산 결과·기록보다 먼저다.
// 여기서는 그 기록을 읽어 보여 줄 글만 고른다. 읽기만 하고 다시 계산하지 않으며 차수를 바꾸지 않는다.
//
// 공용 엔진의 readStoredFeeResult 는 아직 이 저장소가 쓰는 공용 패키지 판에 없어(엔진 판이 올라오기 전)
// 같은 규칙(비어 있지 않은 글자만 인정)을 여기서 순수 함수로 다시 구현했다. 가져다 쓸 수 있게 되면 이 파일의 읽기 부분만 바꾸면 된다.

import type { TierData } from "@wedly/ui-shared";

/** 칸을 비운 이유 / 적용 기준 / 사람이 고친 값의 저장 키 접두사 — 공용 엔진 계약(TIER_FEE_REASON_PREFIX 등)과 같은 값. */
export const FEE_REASON_KEY_PREFIX = "_fsr_";
export const FEE_BASIS_KEY_PREFIX = "_fsb_";
export const FEE_OVERRIDE_KEY_PREFIX = "_ovr_";
/** 적용 기준 글 앞에 붙는 이름. */
export const FEE_BASIS_LABEL = "적용 기준";
/** 화면에 싣는 글의 최대 길이(정상 글은 한 줄이라 넉넉한 안전 상한). */
const NOTE_MAX_CHARS = 200;

export interface FeeBasisNoteResult {
  /** 값이 비어 있을 때 보일 이유 글(저장된 그대로). */
  reason?: string;
  /** 값이 계산됐을 때 보일 적용 기준 글(저장된 그대로 — 「적용 기준: 」 머리말은 표시 부품이 붙인다). */
  basis?: string;
}

export interface FeeBasisNoteOptions {
  /** 지금 화면에 보이는 값. 안 넘기면(undefined) 차수에 저장된 칸 값을 본다. null 은 「비어 있음」이다. */
  shown?: unknown;
  /** 확정된 정산이면 true — 적용 기준을 숨긴다. */
  finalized?: boolean;
  /** 호출자가 이미 「사람이 고친 값」임을 아는 경우 true(차수의 _ovr_ 는 따로 읽는다). */
  edited?: boolean;
}

/** 비어 있지 않은 글자만 인정(공백뿐인 글은 없는 것). 너무 길면 자른다. */
function storedText(tier: TierData, prefix: string, key: string): string | undefined {
  if (!key) return undefined;
  const raw = tier[prefix + key];
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  return text ? text.slice(0, NOTE_MAX_CHARS) : undefined;
}

/** 사람이 고친 값이 저장돼 있나 — 숫자이거나 숫자로 읽히는 비어 있지 않은 글(0 포함). 공용 엔진 getTierOverride 와 같은 판정. */
function hasPersonOverride(tier: TierData, key: string): boolean {
  if (!key) return false;
  const raw = tier[FEE_OVERRIDE_KEY_PREFIX + key];
  const num = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(num);
}

/** 값이 비었나 — null·undefined·공백 글·숫자가 아닌 수. 0 은 계산된 값이라 비어 있지 않다. */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/**
 * 한 칸 아래에 보일 글을 고른다.
 *  · 값이 비어 있고 `_fsr_<칸>` 이 있으면 → { reason }
 *  · 값이 있고 `_fsb_<칸>` 이 있으면 → { basis } — 단, 사람이 고친 값(`_ovr_`·edited)이거나 확정된 정산이면 숨긴다.
 *  · 사람이 고친 값이 있으면 아무 글도 내지 않는다(사람 값이 항상 먼저).
 */
export function feeBasisNoteOf(tier: TierData, key: string, opts: FeeBasisNoteOptions = {}): FeeBasisNoteResult {
  if (opts.edited || hasPersonOverride(tier, key)) return {};
  const shown = opts.shown === undefined ? tier[key] : opts.shown;
  if (isEmptyValue(shown)) {
    const reason = storedText(tier, FEE_REASON_KEY_PREFIX, key);
    return reason ? { reason } : {};
  }
  if (opts.finalized) return {};
  const basis = storedText(tier, FEE_BASIS_KEY_PREFIX, key);
  return basis ? { basis } : {};
}

/** 칸 아래에 붙는 작은 글 한 줄 — 이유는 주황(확인할 일), 적용 기준은 조용한 회색. 글이 없으면 아무것도 그리지 않는다. */
export function FeeBasisNote({ note }: { note?: FeeBasisNoteResult }) {
  if (!note) return null;
  if (note.reason) return <div className="text-[11px] text-wedly-orange break-keep">{note.reason}</div>;
  if (note.basis) return <div className="text-[11px] text-wedly-muted break-keep">{`${FEE_BASIS_LABEL}: ${note.basis}`}</div>;
  return null;
}
