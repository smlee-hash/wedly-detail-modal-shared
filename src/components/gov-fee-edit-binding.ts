import type { FeePublicViewV1 } from "@wedly/ui-shared";
import type { TierFieldEditIntentV1 } from "./tier-field-edit-intent";
import { makeMergedTierId, parseTierArray, tierIdOf, type PolicyRowForMerge, type TierObject } from "./gov-merged-tiers";

/** 서버가 최종 검증할 한 번의 정부지원금 수수료 수정 요청. */
export type GovFeeEditRequestV1 = {
  version: 1;
  requestId: string;
  selection: {
    sourceTable: "PolicyFundEntry";
    entryId: string;
    containerKey: "계약정보_차수" | "정산정보";
    tierId: string;
    fieldKey: string;
  };
  previous: TierFieldEditIntentV1["previous"];
  expectedEventVersion: string | null;
};

/** 기존 세 인자 저장과 호환되는 선택적 넷째 인자. */
export type GovPolicyFieldSaveOptions = { feeEdit?: GovFeeEditRequestV1 };

type PolicyRowWithFeeView = PolicyRowForMerge & { feeView?: FeePublicViewV1 };
type OriginalTier = { owner: PolicyRowWithFeeView; tier: TierObject; tierId: string };
type MoneyContainerKey = GovFeeEditRequestV1["selection"]["containerKey"];
/** entryId 는 사용자가 고친 원본 소유자 하나. feeEdit 는 돈 칸을 고쳤을 때만 따로 붙는다. */
type GovFeeEditBinding = { entryId: string; feeEdit?: GovFeeEditRequestV1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVED_TIER_ID = /^(?:noid\d+$|gm\d+~)/;
const OVERRIDE_PREFIX = "_ovr_";
const REFUND_KEY = "환불정보_차수";
/** splitMergedTiers 는 gm 으로 시작하는 못 읽은 id 를 저장값에서 지운다 — 새 차수 id 로 쓸 수 없다. */
const MERGED_ID_HEAD = "gm";
/**
 * 버전 1 에서 저장본에 없는 새 차수의 금액 요청으로 분류하는 논리 칸.
 * field 는 그대로 저장되는 기준 칸, override 는 실제 저장 키가 `_ovr_<칸>` 인 수동값 지정·해제 대상이다.
 * 요청을 분류할 뿐 권한을 주지 않는다 — 현재 컴파일된 범위·행위자·원본 값은 서버가 잠금 아래에서 다시 검증한다.
 */
const NEW_DRAFT_MONEY_KEYS: Readonly<Record<MoneyContainerKey, { field: ReadonlySet<string>; override: ReadonlySet<string> }>> = {
  "계약정보_차수": {
    field: new Set(["계약금"]),
    override: new Set(["[컨설턴트]_수수료", "[위들리]_수수료", "[하이브]_계약금_수수료", "[올카데미]_계약금_수수료"]),
  },
  "정산정보": {
    field: new Set(),
    override: new Set(["매출", "컨설턴트수수료정산일", "[위들리]_성공보수_수수료", "[하이브]_성공보수_수수료", "[올카데미]_성공보수_수수료"]),
  },
};

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidBinding(): never {
  throw new Error("수수료 수정 정보를 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.");
}

/** 서버의 id 없는 원본 차수 투영과 동일하다. 실제 id와 겹치면 소유자를 확정할 수 없다. */
function projectedTierId(originalId: string, indexInOwner: number): string {
  return originalId || `tier-${indexInOwner + 1}-${indexInOwner}`;
}

/**
 * 한 소유자의 원본 차수 전체를 저장 전에 한 번 확인한다(소유자 줄 id·차수 모양·id 보존·예약 id·겹침).
 * 이 소유자의 줄을 실제로 쓸 때만 부른다 — 다른 소유자의 원본은 검증도, 수정도 하지 않는다.
 */
function checkedSourceTiers(
  owner: PolicyRowWithFeeView,
  containerKey: string,
): Array<{ tier: TierObject; originalId: string; tierId: string; indexInOwner: number }> {
  if (
    typeof owner.entryId !== "string" || !owner.entryId || owner.entryId !== owner.entryId.trim()
  ) invalidBinding();
  const sourceIds = new Set<string>();
  return parseTierArray(owner.row[containerKey]).map((tier, indexInOwner) => {
    if (!isRecord(tier)) invalidBinding();
    const originalId = tierIdOf(tier);
    if (originalId && (
      !hasOwn(tier, "id") || tier.id !== originalId || RESERVED_TIER_ID.test(originalId)
    )) invalidBinding();
    const tierId = projectedTierId(originalId, indexInOwner);
    if (sourceIds.has(tierId)) invalidBinding();
    sourceIds.add(tierId);
    return { tier, originalId, tierId, indexInOwner };
  });
}

/** feeView 가 없거나, 소유자가 일치하는 구조적으로 올바른 옛 앱(legacy) 표시일 때만 참. 표준·차단·깨진 값은 거짓. */
function isAbsentOrStructuralLegacy(owner: PolicyRowWithFeeView): boolean {
  const view: unknown = owner.feeView;
  if (view === undefined) return true;
  return isRecord(view) && view.version === 1 && view.mode === "legacy"
    && isRecord(view.owner) && view.owner.sourceTable === "PolicyFundEntry" && view.owner.entryId === owner.entryId
    && Array.isArray(view.targets) && view.targets.length === 0;
}

/** 소유자가 정확히 일치하고 targets 가 배열인 버전 1 표준 표시일 때만 참. 차단·옛 앱·깨진·소유자 불일치 값은 거짓. */
function isStructuralStandard(owner: PolicyRowWithFeeView): boolean {
  const view: unknown = owner.feeView;
  return isRecord(view) && view.version === 1 && view.mode === "standard"
    && isRecord(view.owner) && view.owner.sourceTable === "PolicyFundEntry" && view.owner.entryId === owner.entryId
    && Array.isArray(view.targets);
}

/** 이전 값이 있다고 주장하면 own value 가 단순 값(유한 숫자·문자열·불리언·null)이어야 한다. 값을 지어내지 않는다. */
function isWellFormedPrevious(previous: TierFieldEditIntentV1["previous"]): boolean {
  if (!previous.present) return true;
  if (!hasOwn(previous, "value")) return false;
  const value: unknown = previous.value;
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

/** 새 차수 요청이 금액 칸이면 논리 칸 키, 아니면 undefined(날짜 등). 정규 조합(종류·접두사)이 아니면 금액으로 보지 않는다. */
function newDraftMoneyKey(containerKey: MoneyContainerKey, intent: TierFieldEditIntentV1): string | undefined {
  const keys = NEW_DRAFT_MONEY_KEYS[containerKey];
  if (intent.kind === "field") return keys.field.has(intent.fieldKey) ? intent.fieldKey : undefined;
  if (!intent.fieldKey.startsWith(OVERRIDE_PREFIX)) return undefined;
  const logicalKey = intent.fieldKey.slice(OVERRIDE_PREFIX.length);
  return keys.override.has(logicalKey) ? logicalKey : undefined;
}

/**
 * 계약·정산 컨테이너에서 서버가 소유자의 수수료 관측으로 다시 검증해야 하는 수정인가(패널 내부용, index 로 내보내지 않는다).
 * 저장본에 없는 새 차수의 알려진 금액 칸과 모든 수동값 지정·해제가 해당한다. 날짜 같은 일반 칸·환불·히스토리는 아니다.
 * 요청을 분류할 뿐 권한도 관측도 만들지 않는다 — 소유자가 아직 없을 때 이 값이 참이면 실제 소유자 관측을 기다려야 한다.
 */
export function isSensitiveGovFeeEdit(containerKey: string, intent?: TierFieldEditIntentV1): boolean {
  if (!intent || (containerKey !== "계약정보_차수" && containerKey !== "정산정보")) return false;
  if (intent.kind === "override" || intent.kind === "restore") return true;
  return intent.kind === "field" && newDraftMoneyKey(containerKey, intent) !== undefined;
}

/**
 * 방금 만든 소유자 줄에서 읽은 수수료 표시가 첫 금액 저장의 근거가 될 수 있는가(패널 내부용).
 * 소유자가 정확히 일치하는 버전 1 표준 표시, 또는 실제로 있는 구조적 옛 앱(legacy) 표시만 인정한다.
 * 표시가 없거나 차단·깨진·소유자 불일치면 undefined — 옛 앱이나 일반 저장으로 낮추지 않는다.
 */
export function observedFeeViewMode(owner: PolicyRowWithFeeView): "standard" | "legacy" | undefined {
  if (isStructuralStandard(owner)) return "standard";
  return owner.feeView !== undefined && isAbsentOrStructuralLegacy(owner) ? "legacy" : undefined;
}

/**
 * 화면이 새로 만든 첫 차수(저장본 어디에도 없는 원본 그대로의 새 id)의 소유자. splitMergedTiers 가 새 id 를 대표 줄(첫 줄)로
 * 보내는 것과 똑같이 그 줄 하나만 확정하고, 확정할 수 없으면 대표 줄로 폴백하지 않고 막는다.
 * 환불에는 수수료 대상이 없으므로 화면 종류와 무관하게 소유자만 묶는다.
 * 계약·정산은 모든 줄이 옛 앱(legacy)이면 소유자만 묶고(금액 사건 없음), 대표 줄이 정확한 표준 화면이면 그 대표 줄을 묶는다.
 * 표준에서 금액 칸을 처음 쓰면 저장본에 사건이 아직 없다는 낙관적 전제(expectedEventVersion: null)로 만든다 — 읽은 관측이 아니다.
 * 날짜 같은 금액이 아닌 칸은 금액 요청 없이 소유자만 묶는다. 깨진·차단·불일치 화면은 옛 앱으로 낮추지 않고 막는다.
 */
function bindNewRawDraft(
  policyRows: ReadonlyArray<PolicyRowWithFeeView>,
  containerKey: MoneyContainerKey | typeof REFUND_KEY,
  submitted: ReadonlyArray<TierObject>,
  intent: TierFieldEditIntentV1,
): GovFeeEditBinding {
  const rawId = intent.tierId;
  if (
    rawId !== rawId.trim()
    || rawId.startsWith(MERGED_ID_HEAD) || RESERVED_TIER_ID.test(rawId)
    || submitted.filter(tier => isRecord(tier) && hasOwn(tier, "id") && tier.id === rawId).length !== 1
  ) invalidBinding();

  const primary = policyRows[0];
  if (!primary) invalidBinding();
  // 새 차수가 저장될 대표 줄은 기존 선택 소유자와 같은 기준으로 확인한다.
  checkedSourceTiers(primary, containerKey);
  if (policyRows.filter(candidate => candidate.entryId === primary.entryId).length !== 1) invalidBinding();
  // 어느 소유자의 원본에도(id 없는 차수의 투영 id 포함) 이 id 가 있으면 새 차수가 아니다.
  const collides = policyRows.some(owner => parseTierArray(owner.row[containerKey]).some((tier, indexInOwner) => (
    isRecord(tier) && projectedTierId(tierIdOf(tier), indexInOwner) === rawId
  )));
  if (collides) invalidBinding();

  const entryId = primary.entryId;
  if (containerKey === REFUND_KEY) return { entryId };
  // 첫 저장 뒤 부모 refetch 전에도 같은 초안의 다음 칸을 입력할 수 있다. legacy에는 금액 사건을 만들지 않는다.
  if (policyRows.every(isAbsentOrStructuralLegacy)) return { entryId };

  // 표준 첫 차수: 대표 줄이 정확한 표준 화면이어야 하고, 다른 줄도 구조적으로 읽을 수 있어야 한다.
  if (
    !isStructuralStandard(primary)
    || !policyRows.every(owner => isAbsentOrStructuralLegacy(owner) || isStructuralStandard(owner))
  ) invalidBinding();
  const fieldKey = newDraftMoneyKey(containerKey, intent);
  if (fieldKey === undefined) return { entryId };

  // 새 차수의 금액 요청은 읽은 관측이 없다. 원래 이전 값을 그대로 두고 사건이 아직 없다는 전제(null)만 붙인다.
  const previous = intent.previous;
  if (!isWellFormedPrevious(previous)) invalidBinding();
  return {
    entryId,
    feeEdit: {
      version: 1,
      requestId: intent.requestId,
      selection: { sourceTable: "PolicyFundEntry", entryId, containerKey, tierId: rawId, fieldKey },
      previous,
      expectedEventVersion: null,
    },
  };
}

/**
 * 현재 원본 줄에서만 소유자·차수·이전 값을 찾는다. 표시 순서와 첫 줄 폴백은 쓰지 않는다.
 * 모든 검증은 호출자가 어느 줄도 저장하기 전에 한 번만 수행한다.
 * 관측값은 서버 검증용으로 전달할 뿐이며 표시 금액·자동 계산 상태는 읽지 않는다.
 *
 * 수정 의도가 없으면 undefined(기존 저장 그대로). 올바른 의도면 옛 앱·표준 모두 사용자가 고친
 * 소유자 하나를 돌려주고, 수정 요청(feeEdit)은 표준 화면의 돈 칸일 때만 붙인다.
 * 환불 칸은 수수료 대상이 없어 소유자(entryId)만 돌려준다. 저장본에 없는 새 첫 차수는 bindNewRawDraft
 * (표준 새 금액 요청은 읽은 관측 없이 expectedEventVersion: null 로 만들고, 기존 차수는 항상 준비된 관측을 요구한다).
 */
export function bindGovFeeEdit(
  policyRows: ReadonlyArray<PolicyRowWithFeeView>,
  containerKey: string,
  submitted: ReadonlyArray<TierObject>,
  intent?: TierFieldEditIntentV1,
): GovFeeEditBinding | undefined {
  if (!intent || (containerKey !== "계약정보_차수" && containerKey !== "정산정보" && containerKey !== REFUND_KEY)) {
    return undefined;
  }

  if (
    intent.version !== 1 || typeof intent.requestId !== "string" || !UUID.test(intent.requestId)
    || typeof intent.tierId !== "string" || !intent.tierId
    || typeof intent.fieldKey !== "string" || !intent.fieldKey || intent.fieldKey === "id"
    || !isRecord(intent.previous) || typeof intent.previous.present !== "boolean"
  ) invalidBinding();
  const override = intent.kind === "override" || intent.kind === "restore";
  if (
    (!override && intent.kind !== "field")
    || override !== intent.fieldKey.startsWith(OVERRIDE_PREFIX)
    || (intent.kind === "restore" && !intent.previous.present)
  ) invalidBinding();
  const fieldKey = override ? intent.fieldKey.slice(OVERRIDE_PREFIX.length) : intent.fieldKey;
  if (!fieldKey || fieldKey.startsWith(OVERRIDE_PREFIX)) invalidBinding();

  const matches: OriginalTier[] = [];
  policyRows.forEach((owner, ownerIndex) => {
    const sourceTiers = parseTierArray(owner.row[containerKey]);
    // 선택한 합친 id 가 있는 소유자만 상세 검증한다. 다른 소유자의 원본은 고치지 않는다.
    if (!sourceTiers.some((tier, indexInOwner) => (
      isRecord(tier) && makeMergedTierId(ownerIndex, tierIdOf(tier), indexInOwner) === intent.tierId
    ))) return;
    for (const { tier, originalId, tierId, indexInOwner } of checkedSourceTiers(owner, containerKey)) {
      if (makeMergedTierId(ownerIndex, originalId, indexInOwner) === intent.tierId) {
        matches.push({ owner, tier, tierId });
      }
    }
  });
  // 현재 합친 id 가 하나도 아니면 화면이 방금 만든 새 첫 차수인지 따로 확인한다(옛 id·남의 줄 id 는 거기서 막힌다).
  if (matches.length === 0) return bindNewRawDraft(policyRows, containerKey, submitted, intent);
  if (matches.length !== 1) invalidBinding();
  const { owner, tier, tierId } = matches[0];
  if (policyRows.filter(candidate => candidate.entryId === owner.entryId).length !== 1) invalidBinding();
  if (submitted.filter(tier => isRecord(tier) && hasOwn(tier, "id") && tier.id === intent.tierId).length !== 1) {
    invalidBinding();
  }
  // 여기부터 owner.entryId 는 정확히 한 원본 줄로 확정됐다. 아래 어느 반환이든 그 소유자만 돌려준다.
  const entryId = owner.entryId;
  // 환불 칸은 공개 수수료 대상이 없다. 고른 소유자 하나만 확정하고 수수료 수정 요청은 만들지 않는다.
  if (containerKey === REFUND_KEY) return { entryId };
  const view = owner.feeView;
  if (view === undefined) return { entryId };
  if (
    !isRecord(view) || view.version !== 1 || !isRecord(view.owner)
    || view.owner.sourceTable !== "PolicyFundEntry" || view.owner.entryId !== entryId
  ) invalidBinding();
  if (view.mode === "legacy") return { entryId };

  const scope = containerKey === "계약정보_차수" ? "gov-contract" : "gov-settlement";
  const targets = view.mode === "standard" && Array.isArray(view.targets) ? view.targets.filter(target => (
    isRecord(target) && target.scope === scope && isRecord(target.target)
    && target.target.containerKey === containerKey && target.target.tierId === tierId
  )) : [];
  const knownMoney = NEW_DRAFT_MONEY_KEYS[containerKey];
  const sensitive = override || knownMoney.field.has(fieldKey) || knownMoney.override.has(fieldKey)
    || targets.some(target => isRecord(target.edits) && hasOwn(target.edits, fieldKey));
  // 원본 소유자·차수·제출 일치가 확인된 일반 칸은 수수료 차단과 별개로 저장한다.
  // 알려진 금액 칸과 표준 대상에서 관측한 칸, 모든 수동 지정·복원은 표시·CAS 검증을 그대로 거친다.
  if (!sensitive) return { entryId };
  if (view.mode !== "standard" || !Array.isArray(view.targets)) invalidBinding();
  if (targets.length !== 1 || !isRecord(targets[0].edits)) invalidBinding();
  const edits = targets[0].edits;
  if (!hasOwn(edits, fieldKey)) invalidBinding();

  const previous = intent.previous;
  if (hasOwn(tier, intent.fieldKey) !== previous.present) invalidBinding();
  if (!isWellFormedPrevious(previous) || (previous.present && tier[intent.fieldKey] !== previous.value)) invalidBinding();

  // 대상의 blocked(예: VAT 미확정)와 개별 수정 관측의 ready는 서로 다른 판단이다.
  const observation = edits[fieldKey];
  if (
    !isRecord(observation) || observation.status !== "ready" || !hasOwn(observation, "eventVersion")
    || !(observation.eventVersion === null
      || (typeof observation.eventVersion === "string" && observation.eventVersion.length >= 1 && observation.eventVersion.length <= 256))
  ) invalidBinding();

  return {
    entryId,
    feeEdit: {
      version: 1,
      requestId: intent.requestId,
      selection: { sourceTable: "PolicyFundEntry", entryId, containerKey, tierId, fieldKey },
      previous: intent.previous,
      expectedEventVersion: observation.eventVersion,
    },
  };
}
