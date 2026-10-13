import type { GovFeeEditRequestV1 } from "./gov-fee-edit-binding";
import { parseTierArray } from "./gov-merged-tiers";

const REFUND_CONTAINER_KEY = "환불정보_차수";
const REFUND_CONTEXT_FLAG = "_governmentRefundContextEnabled";
/** ERP 환불 문맥이 읽을 때만 붙이는 칸 — 저장 때 서버가 지운다. 사용자가 고친 값이 아니다. */
const REFUND_READ_KEYS: ReadonlySet<string> = new Set(["계약일", "컨설팅담당", "_refundContractState"]);
const CONTRACT_TIER_KEY = "_contractTierId";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => hasOwn(right, key) && sameValue(left[key], right[key]));
}

/** id 없는 옛 차수는 원래 자리로 구분한다. 겹친 id는 다른 차수의 저장 확인에 쓰지 않는다. */
function tierIdentities(values: unknown[]): string[] | null {
  const ids = values.map((value, index) => {
    if (!isRecord(value)) return null;
    return typeof value.id === "string" && value.id !== ""
      ? JSON.stringify(["id", value.id])
      : JSON.stringify(["index", index]);
  });
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

/** 원본에서 제출값으로 바뀐 경로만 대조한다. 안 고친 칸의 동시 갱신은 허용한다. */
function containsMutation(before: unknown, submitted: unknown, observed: unknown): boolean {
  if (sameValue(before, submitted)) return true;
  if (isRecord(before) && isRecord(submitted)) {
    if (!isRecord(observed)) return false;
    return [...new Set([...Object.keys(before), ...Object.keys(submitted)])].every((key) => {
      const wasPresent = hasOwn(before, key);
      const isPresent = hasOwn(submitted, key);
      if (wasPresent === isPresent && sameValue(before[key], submitted[key])) return true;
      if (!isPresent) return !hasOwn(observed, key);
      if (!hasOwn(observed, key)) return false;
      return wasPresent
        ? containsMutation(before[key], submitted[key], observed[key])
        : sameValue(submitted[key], observed[key]);
    });
  }
  if (Array.isArray(before) && Array.isArray(submitted) && Array.isArray(observed)) {
    const beforeIds = tierIdentities(before);
    const submittedIds = tierIdentities(submitted);
    const observedIds = tierIdentities(observed);
    if (!beforeIds || !submittedIds || !observedIds) return sameValue(submitted, observed);
    // 추가·삭제·순서 변경은 제출한 구조 그대로 도착했을 때만 확인한다.
    if (!sameValue(beforeIds, submittedIds) && !sameValue(submittedIds, observedIds)) return false;
    return submittedIds.every((id, index) => {
      const beforeIndex = beforeIds.indexOf(id);
      if (beforeIndex >= 0 && sameValue(before[beforeIndex], submitted[index])) return true;
      const observedIndex = observedIds.indexOf(id);
      if (observedIndex < 0) return false;
      return beforeIndex < 0
        ? sameValue(submitted[index], observed[observedIndex])
        : containsMutation(before[beforeIndex], submitted[index], observed[observedIndex]);
    });
  }
  return sameValue(submitted, observed);
}

/** 화면용 합친 id가 아닌, 실제 저장 원문에서의 차수 선택. id 없는 원본만 index를 쓴다. */
export type SavedTierFieldSelection = { tierId: string; index: number; fieldKey: string };

function selectedTier(raw: unknown[], selection: SavedTierFieldSelection): Record<string, unknown> | null {
  if (!selection.tierId) {
    const tier = raw[selection.index];
    return isRecord(tier) && !(typeof tier.id === "string" && tier.id !== "") ? tier : null;
  }
  const matches = raw.filter((tier) => isRecord(tier) && tier.id === selection.tierId);
  return matches.length === 1 && isRecord(matches[0]) ? matches[0] : null;
}

/** 환불 읽기 투영이 켜진 소유자의 같은 줄 계약 식별. `soleContractTierId`는 계약 차수가 정확히 하나일 때만 있다. id 없는 옛 계약은 서버와 같은 자리 식별자를 쓴다. */
export type RefundReadProjection = { soleContractTierId?: string };

/**
 * 환불 저장 확인에 쓸 문맥. 환불 컨테이너이고 이 소유자 줄의 `_governmentRefundContextEnabled`가 정확히 true일 때만 준다.
 * 꺼진 문맥·다른 컨테이너·다른 소유자는 undefined — 기존처럼 엄격하게 대조한다.
 */
export function refundReadProjectionOf(
  owner: { row?: unknown } | null | undefined,
  key: string,
): RefundReadProjection | undefined {
  if (key !== REFUND_CONTAINER_KEY || !owner || !isRecord(owner.row) || owner.row[REFUND_CONTEXT_FLAG] !== true) return undefined;
  const contracts = parseTierArray(owner.row["계약정보_차수"]);
  const only: unknown = contracts.length === 1 ? contracts[0] : undefined;
  if (!isRecord(only)) return {};
  const id = typeof only.id === "string" ? only.id.trim() : "";
  return { soleContractTierId: id || "tier-1-0" };
}

function withoutRefundReadKeys(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((tier: unknown) => isRecord(tier)
    ? Object.fromEntries(Object.entries(tier).filter(([field]) => !REFUND_READ_KEYS.has(field)))
    : tier);
}

/**
 * 서버가 저장하며 붙이는 계약 연결을 제출값에 미리 반영한다. 제출한 id가 있으면 그대로(다르면 불일치로 남는다),
 * 없으면 같은 차수의 이전 id, 그것도 없으면 이 소유자의 유일한 계약 id. 서버처럼 제출한 모든 차수에 적용한다.
 */
function withServerContractBinding(submitted: unknown, before: unknown, projection: RefundReadProjection): unknown {
  if (!Array.isArray(submitted)) return submitted;
  return submitted.map((tier: unknown, index: number) => {
    if (!isRecord(tier)) return tier;
    const requestedId = typeof tier[CONTRACT_TIER_KEY] === "string" ? tier[CONTRACT_TIER_KEY].trim() : "";
    if (requestedId) return { ...tier, [CONTRACT_TIER_KEY]: requestedId };
    const unbound = { ...tier };
    delete unbound[CONTRACT_TIER_KEY];
    const prior = Array.isArray(before)
      ? selectedTier(before, { tierId: typeof tier.id === "string" ? tier.id : "", index, fieldKey: "" })
      : null;
    const priorId = prior?.[CONTRACT_TIER_KEY];
    const retainedId = typeof priorId === "string" ? priorId.trim() : "";
    const contractTierId = retainedId || projection.soleContractTierId;
    return contractTierId === undefined ? unbound : { ...unbound, [CONTRACT_TIER_KEY]: contractTierId };
  });
}

/**
 * 실제 제출한 변경의 저장 확인. 다른 원문·수수료 표시만 바뀐 것으로 성공을 판단하지 않는다.
 * `refundContext`는 환불 읽기 투영이 켜진 소유자일 때만 넘긴다 — 원본·제출·관측에서 서버 투영 칸만 빼고 대조한다.
 */
export function hasSavedTierMutation(
  beforeRaw: unknown,
  submittedRaw: string,
  observedRaw: unknown,
  selection?: SavedTierFieldSelection,
  refundContext?: RefundReadProjection,
): boolean {
  try {
    const submitted: unknown = JSON.parse(submittedRaw);
    const observed: unknown = typeof observedRaw === "string" ? JSON.parse(observedRaw) : observedRaw;
    if (!Array.isArray(submitted) || !Array.isArray(observed)) return false;
    // 명시한 칸은 값뿐 아니라 존재·삭제도 일치해야 한다. 같은 값 확정도 다른 칸으로 대신 확인하지 않는다.
    if (selection) {
      const requested = selectedTier(submitted, selection);
      const saved = selectedTier(observed, selection);
      if (!requested || !saved) return false;
      const present = hasOwn(requested, selection.fieldKey);
      if (present !== hasOwn(saved, selection.fieldKey)
        || (present && !sameValue(requested[selection.fieldKey], saved[selection.fieldKey]))) return false;
    }
    if (!refundContext && sameValue(submitted, observed)) return true;
    const before: unknown = typeof beforeRaw === "string" && beforeRaw.trim() !== ""
      ? JSON.parse(beforeRaw) : beforeRaw;
    if (!refundContext) return !sameValue(before, submitted) && containsMutation(before, submitted, observed);
    const plainBefore = withoutRefundReadKeys(before);
    const expected = withServerContractBinding(withoutRefundReadKeys(submitted), plainBefore, refundContext);
    const actual = withoutRefundReadKeys(observed);
    if (Array.isArray(expected) && Array.isArray(actual)) {
      for (const [index, tier] of expected.entries()) {
        if (!isRecord(tier)) return false;
        const chosen = { tierId: typeof tier.id === "string" ? tier.id : "", index, fieldKey: CONTRACT_TIER_KEY };
        const prior = Array.isArray(plainBefore) ? selectedTier(plainBefore, chosen) : null;
        if (prior && sameValue(prior, tier)) continue;
        const saved = selectedTier(actual, chosen);
        if (!saved || hasOwn(tier, CONTRACT_TIER_KEY) !== hasOwn(saved, CONTRACT_TIER_KEY)
          || !sameValue(tier[CONTRACT_TIER_KEY], saved[CONTRACT_TIER_KEY])) return false;
      }
    }
    return sameValue(expected, actual)
      || (!sameValue(plainBefore, expected) && containsMutation(plainBefore, expected, actual));
  } catch {
    return false;
  }
}

/** 저장 원문과 같은 컨테이너의 수수료 관측만 고정한다. 표시용 낙관적 값은 포함하지 않는다. */
export function ownerTierSavedBasis(owner: { row?: unknown; feeView?: unknown } | null, key: string): string {
  let feeView: unknown;
  if (key === "계약정보_차수" || key === "정산정보") {
    feeView = owner?.feeView;
    if (isRecord(feeView) && Array.isArray(feeView.targets)) {
      const scope = key === "계약정보_차수" ? "gov-contract" : "gov-settlement";
      feeView = {
        ...feeView,
        targets: feeView.targets.filter((target: unknown) => (
          isRecord(target) && target.scope === scope && isRecord(target.target)
          && target.target.containerKey === key
        )),
      };
    }
  }
  return JSON.stringify(
    { raw: isRecord(owner?.row) ? owner.row[key] : undefined, feeView },
    (_key, value: unknown) => isRecord(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : value,
  );
}

/** 다른 칸의 갱신으로 저장 잠금을 풀지 않는다. 방금 고친 칸의 새 사건 관측이 와야 한다. */
export function hasNewFeeEditObservation(savedBasis: string, edit: GovFeeEditRequestV1): boolean {
  const observation: unknown = JSON.parse(savedBasis);
  if (!isRecord(observation) || !isRecord(observation.feeView)) return false;
  const view = observation.feeView;
  if (view.mode !== "standard" || !isRecord(view.owner) || view.owner.entryId !== edit.selection.entryId
    || view.owner.sourceTable !== edit.selection.sourceTable || !Array.isArray(view.targets)) return false;
  const targets = view.targets.filter((candidate: unknown) => isRecord(candidate) && isRecord(candidate.target)
    && candidate.target.containerKey === edit.selection.containerKey && candidate.target.tierId === edit.selection.tierId);
  if (targets.length !== 1 || !isRecord(targets[0]) || !isRecord(targets[0].edits)) return false;
  const latest = targets[0].edits[edit.selection.fieldKey];
  return isRecord(latest) && latest.status === "ready" && typeof latest.eventVersion === "string"
    && latest.eventVersion.length > 0 && latest.eventVersion.length <= 256 && latest.eventVersion !== edit.expectedEventVersion;
}
