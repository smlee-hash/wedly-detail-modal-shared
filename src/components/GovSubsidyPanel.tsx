"use client";

// 정부지원금 상세 섹션 공용 패널 (3앱 공통 — ERP·하이브·일루아).
// ─────────────────────────────────────────────────────────────────────────────
// ERP 전용이던 GovSubsidyPolicyPanel 을 detail-modal-shared 로 옮기고 "설정 주입식"으로 일반화.
// 각 앱 어댑터가 createGovSubsidyPanel(config) 로 자기 설정(편집권한·경로)을 넣어
// components.sectionPanels["government-subsidy"] 에 주입한다.
//
// 구조(경정청구 상세와 동일): 도메인 탭 아래 하위 탭 5개.
//   · 히스토리 : 공용 HistoryPanel + 앱별 댓글 경로(config.commentsPath). 보기전용(config.commentsReadOnly)이면 작성 차단.
//   · 계약/정산/환불 : 공용 SettlementInfoTab — 칸 목록·합계카드를 "공용 저장소"에서 읽어 3앱 동일 렌더.
//   · 미팅 : adapter.components.MeetingsTab (앱별 주입).
//
// 편집 게이트: config.editable(값 수정) · config.allowStructureEdit(칸/카드 구조 편집, ERP만).
//   하이브 = 보기 전용(둘 다 off). 일루아 = 값 수정 가능·구조는 ERP에서만.
//
// 주의: SettlementInfoTab 은 dms 의 두 갈래 핀(ERP/하이브·일루아)에서 일부 prop(enableConditionalFormula)이
//   달라, 본 패널은 같은 코드가 두 갈래에서 모두 빌드되도록 ComponentType<any> 로 느슨히 받는다
//   (기존 어댑터 components 캐스팅 관행과 동일). 미지원 prop 은 런타임에서 해당 컴포넌트가 무시한다.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  HistoryPanel,
  timeAgo,
  type HistoryAdapter,
  type UnifiedComment,
  type SectionPanelProps,
  type FeePublicTargetV1,
  type FeePublicViewV1,
  type ScoreCardDef,
  COMMON_BASIC_FIELD_SPECS,
  useDetailLoadState,
  checkApiResult,
  makePersistError,
  failureReason,
} from "@wedly/ui-shared";
import SettlementInfoTabBase from "./SettlementInfoTab";
import { resolveHistoryGate } from "./gov-history-gate";
import { buildGovEvalBase } from "./gov-eval-context";
import { resolveGovFieldEditProps } from "./gov-field-edit-gate";
import { splitMergedTiers, makeMergedTierId, parseMergedTierId, parseTierArray, tierIdOf } from "./gov-merged-tiers";
import {
  bindGovFeeEdit, isSensitiveGovFeeEdit, observedFeeViewMode,
  type GovPolicyFieldSaveOptions, type GovFeeEditRequestV1,
} from "./gov-fee-edit-binding";
import type { FeeTargetForTier, FeeTierView } from "./fee-tier-display";
import type { TierFieldEditIntentV1 } from "./tier-field-edit-intent";
import { ownerTierSavedBasis, hasNewFeeEditObservation, hasSavedTierMutation, refundReadProjectionOf, type SavedTierFieldSelection } from "./gov-save-observation";

// dms 두 갈래 핀의 prop 차이를 흡수(느슨한 타입). 런타임은 각 갈래 컴포넌트가 자기 prop 만 사용.
const SettlementInfoTab = SettlementInfoTabBase as unknown as ComponentType<Record<string, unknown>>;

// 합계 카드 4종 — ERP 정책자금과 동일(3앱 공용 상수).
const DEFAULT_SCORE_CARDS: ScoreCardDef[] = [
  { id: "policy",  label: "정책자금 총액",         color: "gray",   formula: { plus: ["정책자금총액"],   minus: [] } },
  { id: "success", label: "성공보수 총액",         color: "blue",   formula: { plus: ["성공보수총액"],   minus: [] } },
  { id: "fee",     label: "컨설턴트 수수료 총액",   color: "yellow", formula: { plus: ["컨설턴트수수료"], minus: [] } },
  { id: "revenue", label: "매출",                 color: "green",  formula: { plus: ["성공보수총액"],   minus: ["컨설턴트수수료"] } },
];

// 정책 도메인 비율 계산 키(ERP 정책자금과 동일).
const RATIO = { baseKey: "07계약금", feeKey: "13컨설턴트수수료", baseLabel: "계약금", feeLabel: "컨설턴트 수수료" };

export type GovSubsidyPanelConfig = {
  /** 값(계약금 등) 수정 가능 여부. ERP·일루아 true, 하이브 false. */
  editable: boolean;
  /** 칸/카드 정의(구조) 편집 허용. ERP만 true(정의는 한 곳에서). 일루아·하이브 false. */
  allowStructureEdit: boolean;
  /** 하이브 전용: 자기 앱 커스텀 칸만 관리자가 추가·수정. ERP 구조 편집이 켜져 있으면 무시된다(기존 ERP 동작 보존). */
  allowPartnerFieldEdit?: boolean;
  /** 관리자가 아니어도 값(계약정보·정산 등) 수정·신규 추가 허용(옵트인). 미설정 시 기존대로 관리자만.
   *  구조/칸 정의 편집은 이 플래그와 무관하게 항상 실제 관리자만(allowStructureEdit && isAdmin). */
  allowNonAdminEdit?: boolean;
  /** 수수료 계산식에 '반올림·내림' 항을 더할 수 있게 할지. 기본 꺼짐 — ERP 만 켠다.
   *  (사장님 결정 2026-08-15: 수수료 계산식은 ERP 에서만 관리) */
  allowStepTerms?: boolean;
  /** 히스토리 출처 라벨: "erp" | "hive" | "illua". */
  ownSource: string;
  /** ERP만 조건부 수식 UI. */
  enableConditionalFormula?: boolean;
  /** 조건부 수식 옵션(현재 행 기준). ERP만 제공. */
  conditionFieldOptions?: (row: Record<string, unknown>) => unknown;
  /** 히스토리 댓글 경로. */
  commentsPath: (entryId: string) => string;
  /**
   * 차수 카드 제목 옆에 그릴 것(선택). 이 패널은 계약·정산·환불 차수 카드를 직접 그리므로,
   * 공용 SettlementInfoTab 의 renderTierBadge 를 여기서 한 번 더 이어 준다.
   * 미주입이면 지금과 100% 동일 — 다른 앱에는 영향이 없다.
   */
  renderTierBadge?: (ctx: {
    entryId: string;
    kind: "contract" | "settlement" | "refund";
    index: number;
    tierId: string;
    /** 이 차수 고유 id 가 형제 차수와 겹치는가(겹치면 받는 쪽이 표시를 감춘다) */
    tierIdDuplicated?: boolean;
  }) => ReactNode;
  /** 보기 전용(하이브): 작성/수정/삭제 차단. */
  commentsReadOnly?: boolean;
  /** 이미지 붙여넣기 업로드 경로(기본 /api/upload). */
  uploadPath?: string;
  /** 칸/카드 설정 읽기 경로 — 모두 공용 policy-fund-* 저장소를 가리킨다(3앱 동일). */
  contractFieldsPath: string;
  refundFieldsPath: string;
  settlementFieldsPath: string;
  configPath: string;
  /** 값 저장(editable일 때만). 수수료 직접 수정은 선택적 넷째 인자로 원본 관측값을 전달한다. */
  savePolicyField?: (entryId: string, key: string, value: string | number | boolean | null, options?: GovPolicyFieldSaveOptions) => Promise<void>;
  /** 새 계약 생성(editable일 때만). 없으면 자동 생성 불가. */
  createContract?: (primaryRow: Record<string, unknown>) => Promise<string>;
  /** 이 그룹 행 중 정책 행만 골라내기(도메인 키 차이 흡수). */
  filterPolicyRows: (rows: SectionPanelProps["rows"]) => SectionPanelProps["rows"];
  /** 조건부 수식 기준 칸을 가져올 기본정보 도메인(ERP가 "government-subsidy" 등 주입). */
  conditionBasicDomain?: string;
};

type SubTab = "history" | "contract" | "settlement" | "refund" | "meetings";
const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "history", label: "히스토리" },
  { key: "contract", label: "계약정보" },
  { key: "settlement", label: "정산정보" },
  { key: "refund", label: "환불정보" },
  { key: "meetings", label: "미팅정보" },
];

/** 차수 원문이 담기는 세 칸 — 화면에 올리는 차수는 이 칸마다 주인 줄 번호가 박힌 id 로 나간다. */
const TIER_KEYS = ["계약정보_차수", "정산정보", "환불정보_차수"] as const;

type OwnerTierSaveState = { saving: boolean; resetRevision: number; error: string | null };
type PendingTierSave = {
  panelScope: string;
  ownerId: string;
  /** 저장 잠금(scope)을 잡을 때의 주인. 첫 계약 줄이 아직 없던 첫 저장은 ownerId 가 만든 줄로 바뀌어도 "" 로 남는다. */
  scopeOwnerId: string;
  /** 요청이 시작된 순서 — 실패 기록을 지우고 덮을 때 더 새 요청의 기록을 건드리지 않으려고 비교한다. */
  seq: number;
  key: string;
  savedBasis: string;
  beforeRaw: unknown;
  submittedRaw?: string;
  succeeded: boolean;
  /**
   * 다시 읽기(onSaved) 요청을 받은 마운트가 아직 없다 — 같은 패널이 다시 열릴 때 전달한다.
   * 저장이 성공한 뒤뿐 아니라, 첫 계약 줄이 rows 에 나타나길 기다리는 중(아직 저장 전)에도 켜진다.
   */
  refreshPending?: boolean;
  feeEdit?: GovFeeEditRequestV1;
  ordinaryEdit?: SavedTierFieldSelection;
};
/** error: null = 새 요청의 시작 또는 저장 확인, 문자열 = 끝난 요청의 실패 이유, 생략 = 오류와 무관한 알림. */
type TierSaveNotice = { scope: string; save: PendingTierSave; error?: string | null; reset?: boolean; refresh?: boolean };
/** 끝난 저장 하나의 실패 이유. 저장 잠금과 무관하게 남는다 — 실패한 요청은 잠금을 즉시 풀고, 이유만 보인다. */
type TierSaveFailure = { save: PendingTierSave; message: string };
type ContractCreation = {
  promise: Promise<string>;
  /** 만들기가 끝나 받은 새 줄 id — 패널이 다시 열려도 같은 줄을 쓴다. 끝나기 전에는 null. */
  createdId: string | null;
  /** 이 결과를 기다리거나 이어서 쓰는 중인 요청 수. 0이 되고 rows 가 새 줄을 보여 준 뒤에만 비운다. */
  users: number;
};
type PolicyRow = SectionPanelProps["rows"][number] & { feeView?: FeePublicViewV1 };
/** 지금 마운트된 패널이 현재 보고 있는 것 — 전역에 rows 를 쌓지 않고, 마운트마다 최신 값을 읽는 접근자로만 둔다. */
type MountedPanelView = {
  panelScope: string;
  policyRows: ReadonlyArray<PolicyRow>;
  rowsLoadFailed: boolean;
  onSaved: SectionPanelProps["onSaved"];
};
/** 첫 계약 줄이 rows 에 나타나길 기다리는 중인 금액 저장 하나. 확인되면 스스로 풀린다. */
type OwnerWaiter = { panelScope: string; evaluate: () => void };
type CreatedOwnerObservation =
  | { status: "waiting" }
  | { status: "failed"; message: string }
  | { status: "ready"; row: PolicyRow };
const SAVING_TIERS_MESSAGE = "저장 중입니다. 저장이 끝난 뒤 다음 값을 수정해 주세요.";
const SAVE_BUSY_ERROR = "앞의 값을 저장 중입니다. 이번 변경은 저장하지 않았습니다. 저장이 끝난 뒤 다시 수정해 주세요.";
const SAVED_RELOAD_FAILED_MESSAGE = "저장된 값을 다시 불러오지 못했습니다. 창을 닫았다가 다시 열어 주세요.";
/**
 * 실패로만 끝내는 기한이다 — 이 시간이 지났다고 성공 처리하거나 잠금을 풀지 않는다.
 * 같은 논리 패널이 열려 있는 동안만 흐르는 합계 시간이다(닫힌 시간은 세지 않고, 다시 열어도 처음으로 되돌리지 않는다).
 */
const OWNER_OBSERVATION_DEADLINE_MS = 20_000;
const OWNER_DEADLINE_MESSAGE = "새로 만든 계약 줄을 20초 안에 확인하지 못해 금액을 저장하지 않았습니다.";
const OWNER_ROWS_FAILED_MESSAGE = "계약 정보를 불러오지 못해 새로 만든 계약 줄을 확인하지 못했습니다. 금액은 저장하지 않았습니다.";
const OWNER_UNREADABLE_MESSAGE = "새로 만든 계약 줄의 수수료 기준을 확인하지 못해 금액을 저장하지 않았습니다.";
const OWNER_POPULATED_MESSAGE = "새로 만든 계약 줄에 이미 다른 값이 저장되어 있어 금액을 저장하지 않았습니다.";

/** 컨테이너가 아직 없거나 구조적으로 비어 있는가. 읽을 수 없는 비어 있지 않은 값은 비었다고 보지 않는다. */
function isEmptyTierContainer(raw: unknown): boolean {
  if (raw == null) return true;
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw !== "string") return false;
  if (raw.trim() === "") return true;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 화면에 올린 차수 하나가 보여 줄 서버 수수료 대상을, 지금 받아 둔 줄 목록에서 **정확히 하나만** 고른다.
 * 첫 줄·표시 순서로 대신 고르지 않는다 — 주인 줄을 못 정하거나 대상이 0개·2개 이상이면 막힘으로 답한다.
 * 읽기만 한다(저장·수정 요청과 무관). 환불은 이 함수를 쓰지 않는다 — 옛 방식 그대로.
 */
function selectGovFeeTarget(
  policyRows: ReadonlyArray<{ entryId: string; row?: unknown; feeView?: unknown }>,
  containerKey: "계약정보_차수" | "정산정보",
  tier: { id?: unknown },
): FeeTierView {
  const RELOAD = "화면을 새로고침한 뒤 다시 확인해 주세요.";
  const blocked = (message: string): FeeTierView => ({ mode: "blocked", message });
  // 수수료 표준 화면을 가진 줄이 하나도 없는 화면(옛 앱·옛 자료)은 처음부터 옛 방식 그대로다.
  if (!policyRows.some((r) => r.feeView !== undefined)) return { mode: "legacy" };

  const tierId = typeof tier?.id === "string" ? tier.id : "";
  const ref = parseMergedTierId(tierId);
  if (!ref) return blocked("새로 만든 차수라 수수료 기준을 아직 찾을 수 없어요. 저장한 뒤 다시 열어 확인해 주세요.");
  const ownerNotFound = blocked(`이 차수가 속한 계약 줄을 정확히 찾지 못했어요. ${RELOAD}`);
  const owner = policyRows[ref.ownerIndex];
  if (
    !owner || typeof owner.entryId !== "string" || !owner.entryId
    || policyRows.filter((candidate) => candidate.entryId === owner.entryId).length !== 1
  ) return ownerNotFound;

  const sourceTiers = parseTierArray(isRecord(owner.row) ? owner.row[containerKey] : undefined);
  // 서버의 공개 차수 id — id 없는 원본 차수는 서버 투영(`tier-<자리+1>-<자리>`)과 같은 이름을 쓴다.
  const publicIds = sourceTiers.map((source, index) => tierIdOf(source) || `tier-${index + 1}-${index}`);
  const matches: number[] = [];
  sourceTiers.forEach((source, index) => {
    if (isRecord(source) && makeMergedTierId(ref.ownerIndex, tierIdOf(source), index) === tierId) matches.push(index);
  });
  if (matches.length !== 1) return ownerNotFound;
  const publicId = publicIds[matches[0]];
  if (publicIds.filter((id) => id === publicId).length !== 1) return ownerNotFound;

  const view: unknown = owner.feeView;
  if (view === undefined) return { mode: "legacy" }; // 이 줄은 수수료 표준 화면이 없는 옛 줄
  const invalid = blocked(`수수료 정보를 확인하지 못했어요. ${RELOAD}`);
  if (
    !isRecord(view) || view.version !== 1 || !isRecord(view.owner)
    || view.owner.sourceTable !== "PolicyFundEntry" || view.owner.entryId !== owner.entryId
  ) return invalid;
  if (view.mode === "legacy") return { mode: "legacy" };
  if (view.mode !== "standard" || !Array.isArray(view.targets)) return invalid;

  const scope = containerKey === "계약정보_차수" ? "gov-contract" : "gov-settlement";
  const targets = view.targets.filter((target: unknown) => (
    isRecord(target) && target.scope === scope && isRecord(target.target)
    && target.target.containerKey === containerKey && target.target.tierId === publicId
  ));
  if (targets.length !== 1) return blocked(`이 차수의 수수료 기준을 찾지 못했어요. ${RELOAD}`);
  return { mode: "standard", target: targets[0] as FeePublicTargetV1 };
}

async function commentsJson(res: Response): Promise<UnifiedComment[]> {
  // 앱별 댓글 응답 형태 차이 흡수: ERP={data:[...]}, 일루아={data:{illuaComments:[...]}},
  // 하이브 읽기전용={data:[...]}, 그 외 {data:{comments:[...]}} / {data:{hiveComments:[...]}}.
  const j = await res.json().catch(() => null);
  // ★실패를 "빈 목록 성공"으로 바꾸지 않는다(2026-08-26 배포본 브라우저 확인에서 발견).
  //  로그인이 풀린 상태(401)에서 등록을 누르면 여기가 빈 배열을 돌려줘, 화면 목록이 통째로
  //  비워지고 입력칸까지 지워져 **방금 쓴 글이 흔적 없이 사라졌다.** 실제로 재현했다.
  //  오류를 던지면 위 부품이 친 글을 그대로 남기고 왜 실패했는지 안내한다.
  const bad = checkApiResult(res, j);
  if (bad !== "none") throw makePersistError(bad, failureReason(bad));
  const d = (j as { data?: unknown } | null)?.data as
    | UnifiedComment[]
    | { comments?: UnifiedComment[]; illuaComments?: UnifiedComment[]; hiveComments?: UnifiedComment[] }
    | null
    | undefined;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.comments)) return d.comments;
  if (d && Array.isArray(d.illuaComments)) return d.illuaComments;
  if (d && Array.isArray(d.hiveComments)) return d.hiveComments;
  return [];
}

/** 앱별 설정을 받아 정부지원금 섹션 패널 컴포넌트를 만든다(sectionPanels 에 주입). */
export function createGovSubsidyPanel(config: GovSubsidyPanelConfig) {
  // 바깥 도메인 탭이 패널을 없애도 같은 논리 패널의 미확인 저장은 유지한다.
  // 관측값은 각 마운트에서 현재 rows로만 읽는다. 여기에는 진행 중인 요청만 둔다.
  const pendingTierSaves = new Map<string, PendingTierSave>();
  // 첫 계약 줄을 만드는 요청도 같은 논리 패널(panelScope)의 마운트·컨테이너·히스토리 사이에 하나로 공유한다.
  // 진행 중인 요청과 끝난 새 줄 id 를 함께 둔다. 닫힘(unmount)만으로는 비우지 않는다 —
  // rows 가 그 새 줄을 보여 주고 이어서 쓰는 요청도 없을 때에만 정확히 그 항목만 비운다.
  const contractCreations = new Map<string, ContractCreation>();
  const creationListeners = new Set<(panelScope: string) => void>();
  const tierSaveListeners = new Set<(notice: TierSaveNotice) => void>();
  const scopeForOwner = (panelScope: string, ownerId: string, key: string) => JSON.stringify([panelScope, ownerId, key]);
  // 끝난 저장의 실패 이유 — 패널이 닫혀 있어도, 화면이 그 사이 첫 저장이 만든 줄로 바뀌어도 읽을 수 있게 마운트와 따로 둔다.
  // 같은 고객(panelScope)·컨테이너·주인마다 가장 최근 하나만 둔다. 같은 곳에서 새 요청이 시작되면 지운다. 이 기록은 잠금이 아니다 — 화면에 이유를 보이기만 한다.
  const tierSaveFailures = new Map<string, TierSaveFailure>();
  let tierSaveSeq = 0;
  // 이 요청의 실패를 읽을 수 있는 이름들. 첫 줄을 만들던 저장(빈 주인)만 "빈 주인 → 방금 만든 그 줄" 별칭이 하나 더 생긴다. 다른 주인·회사로는 번지지 않는다.
  const failureScopesOf = (save: PendingTierSave) => {
    const scopes = [scopeForOwner(save.panelScope, save.scopeOwnerId, save.key)];
    if (save.scopeOwnerId === "" && save.ownerId !== "") scopes.push(scopeForOwner(save.panelScope, save.ownerId, save.key));
    return scopes;
  };
  const forgetTierFailure = (failure: TierSaveFailure) => {
    for (const scope of failureScopesOf(failure.save)) {
      if (tierSaveFailures.get(scope) === failure) tierSaveFailures.delete(scope);
    }
  };
  // 이 요청보다 먼저 시작한 요청의 실패만 지운다 — 새 요청을 시작할 때와 이 요청의 저장 확인이 도착할 때. 더 새 요청의 실패는 남긴다.
  const clearOlderTierFailures = (save: PendingTierSave) => {
    for (const scope of failureScopesOf(save)) {
      const failure = tierSaveFailures.get(scope);
      if (failure && failure.save.seq < save.seq) forgetTierFailure(failure);
    }
  };
  const recordTierFailure = (save: PendingTierSave, message: string) => {
    clearOlderTierFailures(save);
    const scopes = failureScopesOf(save);
    if (scopes.some((scope) => tierSaveFailures.has(scope))) return; // 남아 있는 것은 이 요청보다 새 요청의 실패다
    const failure: TierSaveFailure = { save, message };
    for (const scope of scopes) tierSaveFailures.set(scope, failure);
  };
  const notifyTierSave = (notice: TierSaveNotice) => {
    // 듣는 화면이 없어도 먼저 기록한다. 늦은 콜백은 releaseTierSave 의 요청 비교를 통과한 현재 요청만 여기까지 온다.
    if (notice.error === null) clearOlderTierFailures(notice.save);
    else if (notice.error !== undefined) recordTierFailure(notice.save, notice.error);
    for (const listener of tierSaveListeners) listener(notice);
  };
  const releaseTierSave = (scope: string, save: PendingTierSave, notice: Omit<TierSaveNotice, "scope" | "save"> = {}) => {
    if (pendingTierSaves.get(scope) !== save) return;
    pendingTierSaves.delete(scope);
    notifyTierSave({ scope, save, ...notice });
  };
  // 방금 만든 첫 계약 줄에 처음 쓰는 금액은, 그 줄이 같은 논리 패널의 현재 rows 에 실제로 나타나 수수료 표시를 읽을 수 있을 때까지 보내지 않는다.
  // 전역에 지난 rows 를 쌓아 두지 않는다 — 기다리는 요청(ownerWaiters)과 지금 마운트된 패널의 접근자(mountedPanels)만 둔다.
  // 패널이 닫혀도 요청은 남는다. 같은 논리 패널이 다시 열리면 그 마운트의 실제 rows 로 이어서 확인한다.
  const mountedPanels = new Set<{ current: MountedPanelView }>();
  const ownerWaiters = new Set<OwnerWaiter>();
  const pokeOwnerWaiters = (panelScope: string) => {
    for (const waiter of [...ownerWaiters]) {
      if (waiter.panelScope === panelScope) waiter.evaluate();
    }
  };
  // 지금 마운트된 것 중 정확히 이 논리 패널(panelScope)의 화면만 — 다른 회사의 화면은 세지 않는다.
  const mountedViewsOf = (panelScope: string) => (
    [...mountedPanels].map((mounted) => mounted.current).filter((view) => view.panelScope === panelScope)
  );
  const observeCreatedOwner = (panelScope: string, ownerId: string, key: string): CreatedOwnerObservation => {
    const views = mountedViewsOf(panelScope);
    if (views.length === 0) return { status: "waiting" };
    if (views.some((view) => view.rowsLoadFailed)) return { status: "failed", message: OWNER_ROWS_FAILED_MESSAGE };
    for (const view of views) {
      const matches = view.policyRows.filter((candidate) => candidate.entryId === ownerId);
      if (matches.length === 0) continue;
      const row = matches[0];
      // 정확히 한 줄, 그 줄의 수수료 표시가 표준 또는 실제 옛 앱 표시여야 한다. 없거나 깨졌으면 일반 저장으로 낮추지 않는다.
      if (matches.length !== 1 || !isRecord(row.row) || observedFeeViewMode(row) === undefined) {
        return { status: "failed", message: OWNER_UNREADABLE_MESSAGE };
      }
      // 방금 만든 줄의 이 컨테이너는 아직 비어 있어야 한다. 다른 쪽이 먼저 채웠다면 그 차수를 덮지 않는다.
      if (!isEmptyTierContainer(row.row[key])) return { status: "failed", message: OWNER_POPULATED_MESSAGE };
      return { status: "ready", row };
    }
    return { status: "waiting" };
  };
  /**
   * 만들기 응답으로 받은 줄 id(save.ownerId)가 현재 rows 에 나타나길 기다린다. 응답이 rows 보다 늦든 빠르든 같은 확인을 거친다.
   * 기한(20초)은 실패로만 끝낸다. 끝나면(확인·실패·기한) 타이머와 등록을 모두 푼다. 패널이 닫힌 것만으로는 끝나지 않는다.
   * 기한은 이 요청이 가진 남은 시간(remainingMs)으로 센다. 정확히 같은 panelScope 의 패널이 하나라도 마운트된 동안만 타이머가 돌고,
   * 하나도 없으면 타이머를 끄고 남은 시간만 보관한다. 같은 패널이 다시 열리면 그 남은 시간으로 이어 간다.
   */
  const awaitCreatedOwner = (scope: string, save: PendingTierSave): Promise<PolicyRow> => (
    new Promise<PolicyRow>((resolve, reject) => {
      let settled = false;
      let remainingMs = OWNER_OBSERVATION_DEADLINE_MS;
      let startAt = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter: OwnerWaiter = {
        panelScope: save.panelScope,
        evaluate: () => {
          if (settled) return;
          const observation = observeCreatedOwner(save.panelScope, save.ownerId, save.key);
          if (observation.status === "ready") settle(() => resolve(observation.row));
          else if (observation.status === "failed") settle(() => reject(new Error(observation.message)));
          else syncDeadline();
        },
      };
      // 지금 마운트된 같은 panelScope 패널이 있는지에 맞춰 타이머를 켜거나 끈다. 이미 맞는 상태면 아무것도 하지 않는다.
      function syncDeadline() {
        const active = mountedViewsOf(save.panelScope).length > 0;
        if (active && timer === null) {
          startAt = Date.now();
          timer = setTimeout(() => settle(() => reject(new Error(OWNER_DEADLINE_MESSAGE))), remainingMs);
        } else if (!active && timer !== null) {
          clearTimeout(timer);
          timer = null;
          remainingMs = Math.max(0, remainingMs - Math.max(0, Date.now() - startAt));
        }
      }
      // 확인·실패·기한 중 먼저 오는 하나로만 끝낸다. 끝나면 등록과 타이머를 함께 푼다.
      function settle(finish: () => void) {
        if (settled) return;
        settled = true;
        ownerWaiters.delete(waiter);
        if (timer !== null) clearTimeout(timer);
        timer = null;
        finish();
      }
      // 먼저 등록하고 알린다 — 다시 읽기가 동기로 끝나도 놓치지 않는다.
      ownerWaiters.add(waiter);
      // rows 가 만들기 응답보다 먼저 도착해 있었을 수 있다.
      waiter.evaluate();
      if (settled) return;
      // 받은 마운트가 없거나 onSaved 가 없으면 켜 둔 채 남는다 — 같은 패널이 다시 열릴 때 전달한다.
      save.refreshPending = true;
      notifyTierSave({ scope, save, refresh: true });
    })
  );
  const startContractCreation = (panelScope: string, primaryRow: Record<string, unknown>): ContractCreation => {
    if (!config.createContract) throw new Error("이 앱에서는 새 계약을 만들 수 없습니다.");
    let started: Promise<string>;
    try {
      started = Promise.resolve(config.createContract(primaryRow));
    } catch (e) {
      started = Promise.reject(e);
    }
    const creation: ContractCreation = { promise: started, createdId: null, users: 0 };
    creation.promise = started.then(
      (id) => {
        creation.createdId = id;
        return id;
      },
      (e) => {
        // 실패한 그 시도만 비운다 — 다음 저장이 다시 만들어 볼 수 있게. 이미 다른 시도가 자리했다면 건드리지 않는다.
        if (contractCreations.get(panelScope) === creation) contractCreations.delete(panelScope);
        throw e;
      },
    );
    contractCreations.set(panelScope, creation);
    return creation;
  };
  /** 같은 논리 패널의 첫 줄 만들기에 참여한다(이미 있으면 그 요청·결과를 그대로 쓴다). 이어 쓰기가 끝나면 release() 로 알린다. */
  const claimContractOwner = async (panelScope: string, primaryRow: Record<string, unknown>) => {
    const creation = contractCreations.get(panelScope) ?? startContractCreation(panelScope, primaryRow);
    creation.users += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      creation.users -= 1;
      for (const listener of creationListeners) listener(panelScope);
    };
    try {
      return { id: await creation.promise, release };
    } catch (e) {
      release();
      throw e;
    }
  };
  // 정확히 만들어진 그 줄이 rows 에 보이고 이어서 쓰는 요청이 없을 때만 그 항목을 비운다. 다른 줄이 보인다고 비우지 않는다.
  const retireObservedCreation = (panelScope: string, observedEntryIds: readonly string[]) => {
    const creation = contractCreations.get(panelScope);
    if (!creation || creation.createdId === null || creation.users > 0) return;
    if (observedEntryIds.includes(creation.createdId)) contractCreations.delete(panelScope);
  };
  function GovSubsidyPanel({ rows, primaryRow, isAdmin, onSaved, adapter, onSubTabChange }: SectionPanelProps & {
    /** 바깥 탭 줄이 있는 배치에서 「지금 고른 탭」을 알려 주는 통로. 미전달이면 내부 상태만(이 갈래 기본).
     *  ★여기서는 바깥 값을 읽지 않는다 — 읽으면 「항목 없어도 히스토리로 먼저 연다」(재작업 2026-07-15)가
     *  되돌아간다. 바깥이 탭 줄을 그리는 배치가 이 갈래에 들어올 때 그때 읽도록 넓힌다(ERP NO.190 참고). */
    onSubTabChange?: (t: string) => void;
  }) {
    const policyRows = config.filterPolicyRows(rows);
    // 항목이 없어도 히스토리로 먼저 연다 — 첫 메모 입력칸(또는 안내)이 바로 보이게(재작업 2026-07-15).
    // 기존엔 항목 없으면 '계약정보'로 열려, 첫 메모 입력이 가능한지 알기 어려웠다.
    const [subTab, setSubTab] = useState<SubTab>("history");
    const [sel, setSel] = useState(0);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [userName, setUserName] = useState("");
    const tierSavedObservationsRef = useRef(new Map<string, string>());
    const [tierSaveStates, setTierSaveStates] = useState<Record<string, OwnerTierSaveState>>({});

    useEffect(() => {
      adapter.api.currentUser().then((u) => setUserName(u?.name ?? "")).catch(() => {});
    }, [adapter]);

    const anchorKey = String(primaryRow["15사업자번호"] ?? primaryRow["04사업자번호"] ?? primaryRow["_id"] ?? "");
    const panelScope = JSON.stringify([config.ownSource, primaryRow["_id"] ?? "", anchorKey]);

    const idx = policyRows.length ? Math.min(sel, policyRows.length - 1) : -1;
    const entry = idx >= 0 ? policyRows[idx] : null;
    const entryId = entry?.entryId ?? "";
    // 공유하던 생성 결과는 rows 가 그 새 줄(정확한 id)을 보여 주고 이어서 쓰는 요청이 없을 때에만 비운다.
    // 아무 줄이나 나타났다고, 또는 패널이 닫혔다고 비우면 늦게 도착하는 같은 패널의 요청이 줄을 한 번 더 만든다.
    const policyEntryIds = JSON.stringify(policyRows.map((r) => r.entryId));
    const policyEntryIdsRef = useRef<string[]>([]);
    useEffect(() => {
      policyEntryIdsRef.current = JSON.parse(policyEntryIds) as string[];
      retireObservedCreation(panelScope, policyEntryIdsRef.current);
    }, [policyEntryIds, panelScope]);
    useEffect(() => {
      // 응답이 rows 보다 늦게 끝나는 순서도 있다 — 마지막 요청이 끝날 때 현재 rows 로 다시 확인한다.
      const listener = (scope: string) => {
        if (scope === panelScope) retireObservedCreation(panelScope, policyEntryIdsRef.current);
      };
      creationListeners.add(listener);
      return () => { creationListeners.delete(listener); };
    }, [panelScope]);
    const data = (entry?.row ?? {}) as Record<string, unknown>;

    // 상세창이 분야 행 목록을 못 불러왔나 — 상자가 없는 호출부는 항상 거짓이라 동작 그대로.
    const { rowsLoadFailed } = useDetailLoadState();
    // 첫 계약 줄을 기다리는 금액 저장이 읽을 이 마운트의 현재 값. 그려질 때마다 갱신하고 기다리는 요청에 확인을 맡긴다.
    const liveRef = useRef<MountedPanelView>({ panelScope, policyRows, rowsLoadFailed, onSaved });
    useEffect(() => {
      liveRef.current = { panelScope, policyRows, rowsLoadFailed, onSaved };
      pokeOwnerWaiters(panelScope);
    });

    const releaseObservedTierSaves = useCallback(() => {
      for (const [scope, save] of pendingTierSaves) {
        if (save.panelScope !== panelScope || !save.succeeded) continue;
        const observed = tierSavedObservationsRef.current.get(scopeForOwner(panelScope, save.ownerId, save.key));
        if (observed === undefined) continue;
        if (save.feeEdit) {
          // 돈 칸은 기존처럼 고른 칸의 정확한 새 사건이 있어야 한다.
          if (observed === save.savedBasis || !hasNewFeeEditObservation(observed, save.feeEdit)) continue;
        } else {
          const observedRaw = (JSON.parse(observed) as { raw?: unknown }).raw;
          // 환불 읽기 투영은 저장한 그 소유자 줄이 지금 정확히 하나일 때만 — 없거나 겹치면 기존처럼 엄격하게 대조한다.
          const currentOwners = liveRef.current.policyRows.filter((candidate) => candidate.entryId === save.ownerId);
          if (save.submittedRaw === undefined
            || !hasSavedTierMutation(
              save.beforeRaw, save.submittedRaw, observedRaw, save.ordinaryEdit,
              refundReadProjectionOf(currentOwners.length === 1 ? currentOwners[0] : null, save.key),
            )) continue;
        }
        releaseTierSave(scope, save, { error: null });
      }
    }, [panelScope]);
    useEffect(() => {
      const listener = (notice: TierSaveNotice) => {
        if (notice.save.panelScope !== panelScope) return;
        setTierSaveStates((prev) => ({
          ...prev,
          [notice.scope]: {
            saving: pendingTierSaves.has(notice.scope),
            resetRevision: (prev[notice.scope]?.resetRevision ?? 0) + (notice.reset ? 1 : 0),
            // 끝난 요청의 실패 이유는 여기(옛 scope)에 두지 않는다 — tierSaveFailures 에서 읽는다. 여기 남는 오류는 저장 중 안내뿐이다.
            error: notice.error === undefined ? prev[notice.scope]?.error ?? null : null,
          },
        }));
        // 옛 인스턴스의 응답도 현재 마운트의 관측과 대조한다. unmount 때 구독은 제거한다.
        releaseObservedTierSaves();
        // 요청할 수 있는 마운트만 신호를 받는다 — 먼저 받은 것으로 표시한 뒤 부른다(다시 그려져도 반복하지 않게).
        if (notice.refresh && onSaved) {
          notice.save.refreshPending = false;
          onSaved();
        }
      };
      tierSaveListeners.add(listener);
      // 패널이 닫힌 사이 성공한 저장(또는 첫 계약 줄을 기다리는 저장)은 다시 읽기 요청을 받을 마운트가 없었다 — 같은 회사로 다시 열린 이 마운트가 한 번 대신 요청한다.
      // 이 신호는 다시 읽기 요청일 뿐이다 — 저장 잠금은 위 관측(releaseObservedTierSaves)이 실제 저장값을 볼 때에만 푼다.
      // onSaved 가 없는 마운트는 받은 것으로 치지 않는다.
      let missedRefresh = false;
      if (onSaved) {
        for (const save of pendingTierSaves.values()) {
          if (save.panelScope !== panelScope || !save.refreshPending) continue;
          save.refreshPending = false;
          missedRefresh = true;
        }
      }
      if (missedRefresh) onSaved?.();
      // 그리고 구독하는 사이에 끝난 실패도 놓치지 않는다 — 이 고객의 실패 기록이 있으면 한 번 더 그려 읽는다(읽기만, 요청은 없다).
      for (const failure of tierSaveFailures.values()) {
        if (failure.save.panelScope !== panelScope) continue;
        setTierSaveStates((prev) => ({ ...prev }));
        break;
      }
      return () => { tierSaveListeners.delete(listener); };
    }, [panelScope, onSaved, releaseObservedTierSaves]);
    // 다시 읽기 시작(onSaved)이 아니라 같은 소유자·컨테이너의 요청한 저장 결과가 도착한 뒤에만 연다.
    const observedTierSnapshots = JSON.stringify(policyRows.flatMap((owner) => (
      policyRows.filter((candidate) => candidate.entryId === owner.entryId).length === 1
        ? ["계약정보_차수", "정산정보", "환불정보_차수"].map((key) => [
          scopeForOwner(panelScope, owner.entryId, key), ownerTierSavedBasis(owner, key),
        ])
        : []
    )));
    // 원문이 같아도 현재 소유자의 환불 읽기 문맥이 달라지면 저장 확인을 다시 한다.
    const observedRefundContexts = JSON.stringify(policyRows.map((owner) => [
      owner.entryId, refundReadProjectionOf(owner, "환불정보_차수"),
    ]));
    useEffect(() => {
      tierSavedObservationsRef.current = new Map(JSON.parse(observedTierSnapshots) as Array<[string, string]>);
      releaseObservedTierSaves();
    }, [observedTierSnapshots, observedRefundContexts, releaseObservedTierSaves]);



    // ── 차수의 주인 ────────────────────────────────────────────────────────────
    // 이 갈래는 계약 알약(계약 1·2·3)으로 한 번에 한 줄만 보여 주므로, 차수의 주인 목록은 지금 고른 줄 하나다.
    // 차수 id 에 주인 줄 번호를 박아(`gm0~원래id`) 화면에 올리고, 저장할 때 원래 id 로 되돌려 그 줄에만 쓴다.
    // 수수료 표시 대상·수정 기준·저장 줄이 모두 이 한 목록에서 나오므로 서로 어긋나지 않는다.
    // (여러 줄을 한 목록으로 합쳐 보이는 배치는 이 갈래에 없다 — 합치려면 이 목록만 policyRows 로 넓히면 된다.)
    const tierOwners = (entry ? [entry] : []) as Array<SectionPanelProps["rows"][number] & { feeView?: FeePublicViewV1 }>;
    // 줄 id + 차수 원문만 뽑은 글자를 기준으로 삼는다 — 렌더마다 새 배열이라 그대로는 의존성에 못 쓴다.
    const tierSourceKey = tierOwners
      .map((r) => `${r.entryId}:${TIER_KEYS.map((k) => JSON.stringify((r.row ?? {})[k] ?? null)).join("|")}`)
      .join("\u0001");
    const ownerTiers = useMemo(() => {
      const owner = tierOwners[0];
      const out: Record<string, string | null> = {};
      for (const key of TIER_KEYS) {
        // 줄이 아직 없으면 지금까지처럼 값 없음(null) 그대로 — 화면이 빈 첫 칸을 보여 준다.
        // 원래 순서를 그대로 둔다(번호 1차·2차…가 저장된 순서를 따르는 지금 동작 유지).
        out[key] = owner
          ? JSON.stringify(parseTierArray(owner.row?.[key]).map((tier, index) => ({ ...tier, id: makeMergedTierId(0, tierIdOf(tier), index) })))
          : null;
      }
      return out;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tierSourceKey]);

    // NO.125 반려 재작업: 수식 평가 바탕 행 — 전체 탭과 동일 문맥(경정청구 행+공통 칸 채움)을
    // 어느 화면에서든 재현한다(대웅글로벌: 일루아 탭·일루아 앱 카드가 전체 탭과 딴 값이던 원인).
    const evalBase = useMemo(
      () => buildGovEvalBase(rows as ReadonlyArray<{ domain?: string; row?: unknown }>, primaryRow as Record<string, unknown>, COMMON_BASIC_FIELD_SPECS),
      [rows, primaryRow],
    );

    // 값 편집 가능 = 앱이 편집 허용 && (관리자 || 일반 사용자 편집 옵트인). 하이브는 editable=false → 항상 보기 전용.
    // NO.119: allowNonAdminEdit(ERP·일루아) 로 일반 사용자도 값 수정·신규 추가 가능. 구조 편집은 아래 259행에서 실제 isAdmin 유지.
    const canEditValues = config.editable && (isAdmin || config.allowNonAdminEdit === true);
    // 댓글(히스토리) 작성 가능 = 보기전용 앱이 아니면 허용 — 값 편집(canEditValues)과 분리.
    // 하이브는 editable:false(값 잠금) + commentsReadOnly 미설정(댓글 개방)으로 여기만 열린다.
    const canWriteHistory = config.commentsReadOnly !== true;
    // 히스토리 게이트 — 항목 없어도 편집 가능하면 첫 메모 입력(저장 시 항목 자동생성). 보기 전용은 기존대로 입력 없음.
    // 식별값(사업자번호/연락처)이 없어도 열린다 — 자동생성 항목은 앵커 꼬리표(_anchorRef, 각 앱 prefill 부여)로
    // 원래 회사와 묶여 고아가 되지 않는다(재작업 2026-07-15, 노션 반려 지적 반영).
    useEffect(() => {
      // 같은 회사로 다시 열린 마운트도 이미 기다리던 요청을 자기 rows 로 이어서 확인한다. 열리면 멈춰 있던 기한도 남은 시간으로 다시 돈다.
      const mounted = liveRef;
      mountedPanels.add(mounted);
      pokeOwnerWaiters(panelScope);
      // 닫힐 때는 접근자만 빼고 요청은 남긴다. 뺀 즉시 이 논리 패널의 요청에 알려, 마운트된 화면이 없어졌다면 기한 타이머를 바로 멈추게 한다.
      return () => {
        mountedPanels.delete(mounted);
        pokeOwnerWaiters(panelScope);
      };
    }, [panelScope]);
    const historyGate = resolveHistoryGate({ entryId, canEditValues, canWriteHistory, hasCreateContract: Boolean(config.createContract), rowsLoadFailed });
    const MeetingsTab = adapter.components.MeetingsTab as ComponentType<{ rawValue: unknown; onSave: (json: string) => void; readOnly?: boolean }>;

    const historyAdapter = useMemo<HistoryAdapter>(() => {
      const url = config.commentsPath(entryId);
      const ro = config.commentsReadOnly === true;
      const blocked = async (): Promise<UnifiedComment[]> => {
        throw new Error("이 앱에서는 정부지원금 히스토리를 작성할 수 없습니다. ERP 또는 일루아에서 작성해 주세요.");
      };
      return {
        fetch: async () => {
          const res = await fetch(url, { cache: "no-store" });
          return { comments: await commentsJson(res) };
        },
        create: ro
          ? (async () => blocked())
          : async ({ text, category }) =>
              commentsJson(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, category }) })),
        edit: ro
          ? (async () => blocked())
          : async ({ commentId, text }) =>
              commentsJson(await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId, text }) })),
        remove: ro
          ? (async () => blocked())
          : async ({ commentId }) =>
              commentsJson(await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId }) })),
        uploadImage: async (file: File) => {
          const fd = new FormData();
          const ext = file.name.split(".").pop() || "png";
          fd.append("file", file, `paste_${Date.now()}.${ext}`);
          const res = await fetch(config.uploadPath ?? "/api/upload", { method: "POST", body: fd });
          const j = await res.json().catch(() => null);
          if (!j?.success || !j?.data?.url) throw new Error("이미지 업로드에 실패했습니다.");
          return j.data.url as string;
        },
      };
    }, [entryId]);

    // 쓸 계약 줄 id. 줄이 있으면 그대로, 없으면 같은 논리 패널이 공유하는 첫 줄 만들기에 참여한다.
    // 이어서 하는 일(저장·댓글)이 끝나면 release() 를 꼭 부른다 — 그 전에는 만들기 결과를 비우지 않는다.
    async function acquireOwner(): Promise<{ id: string; release: () => void }> {
      if (entryId) return { id: entryId, release: () => {} };
      return claimContractOwner(panelScope, primaryRow);
    }

    async function saveOrCreate(key: string, value: string | number | boolean | null) {
      if (!config.savePolicyField) return;
      setErr(null);
      let release = () => {};
      try {
        const owner = await acquireOwner();
        release = owner.release;
        await config.savePolicyField(owner.id, key, value);
        onSaved?.();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "저장에 실패했습니다.");
      } finally {
        release();
      }
    }

    /**
     * 차수 목록이 저장될 때 — 원래 id 로 되돌려 **주인 줄 하나에만** 쓴다.
     * 칸 하나를 직접 고친 저장(editIntent)은 어느 줄의 어느 차수인지 쓰기 전에 한 번 확인하고,
     * 돈 칸이면 서버가 최종 검증할 수정 요청(feeEdit)을 넷째 인자로 함께 보낸다. 의도가 없으면 기존 세 인자 저장 그대로.
     */
    const tierSaveScopeFor = (key: string) => {
      const draftScope = scopeForOwner(panelScope, "", key);
      const draftSave = pendingTierSaves.get(draftScope);
      // 계약 줄을 자동 생성한 첫 저장도 새 줄이 rows에 나타날 때까지 같은 요청으로 유지한다.
      if (draftSave && (!entryId || draftSave.ownerId === entryId)) return draftScope;
      return scopeForOwner(panelScope, entryId, key);
    };
    async function saveOwnerTiers(key: string, json: string, editIntent?: TierFieldEditIntentV1) {
      // 요청을 시작한 주인과 컨테이너를 끝까지 유지한다. 옛 주인의 늦은 실패는 새 주인의 입력을 건드리지 않는다.
      const owner = entry;
      const scope = tierSaveScopeFor(key);
      if (pendingTierSaves.has(scope)) {
        setTierSaveStates((prev) => ({
          ...prev,
          [scope]: { saving: true, resetRevision: (prev[scope]?.resetRevision ?? 0) + 1, error: SAVE_BUSY_ERROR },
        }));
        return;
      }
      const savedBasis = ownerTierSavedBasis(owner, key);
      const pendingSave: PendingTierSave = {
        panelScope, ownerId: owner?.entryId ?? "", scopeOwnerId: owner?.entryId ?? "", seq: ++tierSaveSeq, key, savedBasis,
        beforeRaw: (JSON.parse(savedBasis) as { raw?: unknown }).raw, succeeded: false,
      };
      pendingTierSaves.set(scope, pendingSave);
      notifyTierSave({ scope, save: pendingSave, error: null });
      setErr(null);
      let refresh = false;
      let releaseOwner = () => {};
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          throw new Error("차수 값을 읽지 못했습니다.");
        }
        if (!Array.isArray(parsed)) throw new Error("차수 값을 읽지 못했습니다.");
        const saved = parsed as Record<string, unknown>[];
        if (!config.savePolicyField) throw new Error("이 앱에서는 차수 값을 저장할 수 없습니다.");
        let target = owner;
        if (!target) {
          // 계약 줄이 아직 없다 — 기존처럼 첫 저장 때 자동 생성한다(같은 패널의 만들기는 한 번만).
          const created = await acquireOwner();
          releaseOwner = created.release;
          pendingSave.ownerId = created.id;
          if (!isSensitiveGovFeeEdit(key, editIntent)) {
            pendingSave.submittedRaw = json;
            await config.savePolicyField(created.id, key, json);
            pendingSave.succeeded = true;
            refresh = true;
            return;
          }
          // 금액 칸의 첫 저장은 만들어진 id 만으로 보내지 않는다. 그 줄이 rows 에 실제로 나타나 수수료 표시를 읽은 뒤에만
          // 아래 기존 소유자 경로(bindGovFeeEdit)로 이어 간다. 확인하지 못하면 세 인자 저장으로 낮추지 않고 실패한다.
          target = await awaitCreatedOwner(scope, pendingSave);
          // 이제부터 저장 확인의 기준은 방금 읽은 실제 소유자의 원문이다.
          pendingSave.savedBasis = ownerTierSavedBasis(target, key);
          pendingSave.beforeRaw = (JSON.parse(pendingSave.savedBasis) as { raw?: unknown }).raw;
        }
        // 어느 줄도 쓰기 전에 한 번만 검증한다. 고른 줄 하나만 넘기므로 새 차수의 소유자도 이 줄이다.
        // 첫 줄을 만든 금액 저장도 방금 읽은 그 줄과 처음 캡처한 editIntent 로 같은 경로를 탄다(새 차수 id·요청 id·이전 값 그대로).
        const binding = bindGovFeeEdit([target], key, saved, editIntent);
        if (binding && binding.entryId !== target.entryId) throw new Error("수수료 수정 정보를 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 저장해 주세요.");
        const feeEdit = binding?.feeEdit;
        pendingSave.feeEdit = feeEdit;
        const tiers = splitMergedTiers(saved, [target.entryId]).get(target.entryId) ?? [];
        const before = JSON.stringify(parseTierArray((target.row ?? {})[key]));
        const after = JSON.stringify(tiers);
        pendingSave.submittedRaw = after;
        if (editIntent && !feeEdit) {
          const index = saved.findIndex((tier) => tier.id === editIntent.tierId);
          if (index < 0 || !tiers[index]) throw new Error("수정한 차수를 확인하지 못했습니다.");
          pendingSave.ordinaryEdit = { tierId: tierIdOf(tiers[index]), index, fieldKey: editIntent.fieldKey };
        }
        const options = feeEdit ? { feeEdit } : undefined;
        if (before === after && !options) return; // 같은 금액 확정도 고른 줄의 수정 기준은 저장한다.
        if (options) await config.savePolicyField(target.entryId, key, after, options);
        else await config.savePolicyField(target.entryId, key, after);
        pendingSave.succeeded = true;
        refresh = true;
      } catch (e) {
        releaseTierSave(scope, pendingSave, {
          reset: true, refresh: true,
          error: `${e instanceof Error ? e.message : "저장에 실패했습니다."} 저장된 값을 다시 불러옵니다. 확인한 뒤 다시 수정해 주세요.`,
        });
      } finally {
        try {
          if (pendingSave.succeeded) {
            // 새 마운트가 저장 관측을 먼저 받은 경우도 현재 마운트의 구독자가 확인한다.
            // 구독자가 없으면(패널이 닫힘) refreshPending 이 남아 다시 열릴 때 전달된다.
            if (pendingTierSaves.get(scope) === pendingSave) {
              pendingSave.refreshPending = refresh;
              notifyTierSave({ scope, save: pendingSave, refresh });
            }
          } else {
            releaseTierSave(scope, pendingSave);
          }
        } finally {
          // 이 저장이 쓰던 새 줄 id 는 마지막에 놓는다 — 위 알림이 모두 끝난 뒤에야 만들기 결과를 비울 수 있다.
          releaseOwner();
        }
      }
    }

    /** 화면 차수 id 에 박힌 원래 차수 id — 파트너 정산 뱃지는 `entryId + 원래 tierId` 로 붙는다.
     *  id 가 없던 옛 차수는 지금까지처럼 화면 부품이 붙이던 합성 id(`tier-<자리+1>-<자리>`)로 넘긴다. */
    function originalTierId(shownId: string): string {
      const ref = parseMergedTierId(shownId);
      if (!ref) return shownId;
      if (ref.originalId) return ref.originalId;
      const slot = /~noid(\d+)$/.exec(shownId)?.[1];
      return slot === undefined ? "" : `tier-${Number(slot) + 1}-${slot}`;
    }

    /** 계약·정산 컨테이너마다 따로 — 지금 받아 둔 줄 목록 기준으로 차수의 서버 수수료 대상을 고른다(표시 전용). 환불은 쓰지 않는다. */
    const feeTargetFor = (containerKey: "계약정보_차수" | "정산정보"): FeeTargetForTier => (tier) => (
      selectGovFeeTarget(tierOwners, containerKey, tier)
    );

    async function addContract() {
      if (busy || !config.createContract) return;
      setBusy(true);
      setErr(null);
      try {
        await config.createContract(primaryRow);
        onSaved?.();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "계약 생성에 실패했습니다.");
      } finally {
        setBusy(false);
      }
    }

    // 어댑터가 공급하는 기본정보 정의 기반 조건 옵션(ERP가 conditionBasicDomain 주입 시 사용).
    const [condFromDefs, setCondFromDefs] = useState<Array<{ key: string; label: string; options?: Array<{ value: string; badgeClass?: string }> }> | null>(null);
    useEffect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = adapter as any;
      const fn = a?.conditionFieldOptionsFor as ((defs: unknown[]) => Array<{ key: string; label: string; options?: Array<{ value: string; badgeClass?: string }> }>) | undefined;
      const load = a?.api?.loadBasicFieldDefs as ((d: string) => Promise<unknown[]>) | undefined;
      if (!config.enableConditionalFormula || !fn || !load || !config.conditionBasicDomain) {
        setCondFromDefs(null);
        return;
      }
      let alive = true;
      Promise.resolve(load(config.conditionBasicDomain))
        .then((defs: unknown[]) => { if (alive) setCondFromDefs(fn(defs)); })
        .catch(() => {});
      return () => { alive = false; };
    }, [adapter, config.conditionBasicDomain, config.enableConditionalFormula]);

    const onSaveTiersFor = (key: string) => (canEditValues ? (json: string, editIntent?: TierFieldEditIntentV1) => { void saveOwnerTiers(key, json, editIntent); } : () => {});
    const tierSavePropsFor = (key: string) => {
      const scope = tierSaveScopeFor(key);
      const state = tierSaveStates[scope];
      return {
        savedBasisVersion: ownerTierSavedBasis(entry, key),
        saveResetRevision: state?.resetRevision ?? 0,
        saveInProgress: pendingTierSaves.has(scope),
        canStartSave: () => {
          if (!pendingTierSaves.has(scope)) return true;
          setTierSaveStates((prev) => ({
            ...prev,
            [scope]: { saving: true, resetRevision: prev[scope]?.resetRevision ?? 0, error: SAVE_BUSY_ERROR },
          }));
          return false;
        },
      };
    };
    const shownTierContainer = subTab === "contract" ? "계약정보_차수"
      : subTab === "settlement" ? "정산정보" : subTab === "refund" ? "환불정보_차수" : null;
    const shownTierScope = shownTierContainer ? tierSaveScopeFor(shownTierContainer) : null;
    const shownTierSave = shownTierScope ? {
      ...tierSaveStates[shownTierScope], saving: pendingTierSaves.has(shownTierScope),
    } : undefined;
    // 끝난 저장의 실패 이유는 지금 보는 고객·컨테이너·주인과 정확히 같은 기록만 — 첫 저장이 만든 줄은 그 줄을 보는 동안 같은 기록으로 읽힌다.
    const shownFailure = shownTierContainer ? tierSaveFailures.get(scopeForOwner(panelScope, entryId, shownTierContainer)) : undefined;
    // 저장은 끝났지만 저장된 값을 아직 확인하지 못한 채 상세창의 다시 읽기가 실패했다면 안내만 보인다. 잠금·실패 기록과 무관하고, 실제 저장값이 확인되어야만 잠금이 풀린다.
    const reloadFailedMessage = rowsLoadFailed && shownTierSave?.saving ? SAVED_RELOAD_FAILED_MESSAGE : undefined;
    const shownError = [err, shownTierSave?.error, shownFailure?.message, reloadFailedMessage].filter(Boolean).join(" ") || null;
    // 조건 "기준 칸" 표준 후보를 만드는 함수 — 앱(어댑터)이 넘겨줄 때만 쓴다.
    // 화면 부품(@wedly/ui-shared)에서 직접 가져오면, 그 함수가 없는 판을 무는 앱(하이브·일루아 v0.29)이
    // 화면을 열기도 전에 빌드에서 죽는다. 그래서 앱이 주입하는 형태로 받는다.
    // 안 넘기면 빈 목록 → 커스텀 후보만 남아 지금 하이브·일루아 동작과 똑같다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const basicOptsFn = (adapter as any)?.basicConditionOptionsFromRow as
      | ((row: Record<string, unknown>) => Array<{ key: string; label: string }>)
      | undefined;
    const condOpts = (() => {
      if (condFromDefs) {
        // ERP 경로: 표준 기본정보 칸 + 커스텀(enrich) 합산.
        // 표준 후보는 "정책 행(data)" 기준 — 조건 키는 3앱이 공유하는 정부지원금 데이터에 존재해야
        // 모든 화면에서 같은 값으로 평가된다(NO.125). primaryRow(통합협업 전체 탭=경정청구 행)를 쓰면
        // 52사업장주소지 같은 타 분야 키가 후보로 잡혀, 그 조건이 일루아·정부지원금 문맥에서는
        // 기준 칸이 늘 비어 영영 미발동(항상 기본식)한다.
        // data 는 entry?.row ?? {} 라 항상 객체 — "계약 행 없음" 폴백은 빈 객체 검사로 해야 실제로 동작한다(리뷰 M-3).
        const condRow = data && Object.keys(data).length > 0 ? data : primaryRow;
        const std = basicOptsFn?.(condRow as Record<string, unknown>) ?? [];
        const customKeys = new Set(condFromDefs.map((o) => o.key));
        return [...std.filter((o) => !customKeys.has(o.key)), ...condFromDefs];
      }
      // 어댑터 미공급(하이브·일루아) → 기존 폴백 그대로(변경 금지).
      return config.enableConditionalFormula && config.conditionFieldOptions ? config.conditionFieldOptions(data) : undefined;
    })();

    // 계약/정산/환불 공통 prop — 공용 저장소 설정·합계카드로 3앱 동일 렌더.
    // row: 평가 바탕 행(evalBase = 경정청구 행+primaryRow+공통 칸 채움) + 정산 행(data) — 정산 키가 우선(덮어씀).
    //   conditionValues 는 row 에서 오므로, 조건 기준 칸(27주소지·DB분류·영업담당)이 전 화면에서 채워진다(NO.125 반려 재작업).
    const fieldEdit = resolveGovFieldEditProps({ allowStructureEdit: config.allowStructureEdit, allowPartnerFieldEdit: config.allowPartnerFieldEdit }, isAdmin);
    const settlementCommon: Record<string, unknown> = {
      row: { ...evalBase, ...(data ?? {}) },
      isAdmin: canEditValues,
      readOnly: !canEditValues,
      allowStructureEdit: config.allowStructureEdit && isAdmin,
      columnScopeMode: fieldEdit.columnScopeMode,
      allowCardEdit: fieldEdit.allowCardEdit,
      allowColumnEdit: fieldEdit.allowColumnEdit,
      allowRowLayoutEdit: fieldEdit.allowRowLayoutEdit,
      allowColumnDelete: fieldEdit.allowColumnDelete,
      allowColumnReorder: fieldEdit.allowColumnReorder,
      // 반올림·내림 항 추가 단추 — 앱이 켤 때만. 안 켜면 단추가 안 뜬다(하이브·일루아).
      allowStepTerms: config.allowStepTerms === true,
      ratioBaseKey: RATIO.baseKey,
      ratioFeeKey: RATIO.feeKey,
      ratioBaseLabel: RATIO.baseLabel,
      ratioFeeLabel: RATIO.feeLabel,
      configApiPath: config.configPath,
      defaultScoreCards: DEFAULT_SCORE_CARDS,
      seedDefaultCardsForAllPrefixes: true,
      enableConditionalFormula: config.enableConditionalFormula,
      conditionFieldOptions: condOpts,
    };

    return (
      <div className="flex flex-col">
        {shownError && (
          <div role="alert" className="mx-4 mt-3 rounded-xl border border-wedly-bd-red bg-wedly-bg-red px-3 py-2 text-[13px] text-wedly-red-ink">
            {shownError}
          </div>
        )}

        {shownTierSave?.saving && (<div role="status" className="mx-4 mt-3 text-[13px] text-wedly-muted">{SAVING_TIERS_MESSAGE}</div>)}
        {/* 계약이 여러 건일 때만 선택바 */}
        {policyRows.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto px-4 pt-3">
            {policyRows.map((r, i) => (
              <button
                key={r.entryId}
                onClick={() => setSel(i)}
                className={`flex-shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                  i === idx ? "bg-wedly-bg-blue text-wedly-accent-ink" : "text-wedly-t2 hover:bg-wedly-bg-gray hover:text-wedly-t2"
                }`}
              >
                계약 {i + 1}
              </button>
            ))}
            {canEditValues && config.createContract && (
              <button
                onClick={addContract}
                disabled={busy}
                className="ml-1 flex-shrink-0 rounded-full px-2.5 py-1 text-[12px] text-wedly-t2 hover:bg-wedly-bg-gray hover:text-wedly-t1 disabled:opacity-50"
              >
                + 추가
              </button>
            )}
          </div>
        )}

        {/* 하위 탭 바 — 알약형 */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-wedly-bd/60 bg-wedly-bg-gray/50 px-4 py-2">
          {SUB_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setSubTab(key);
                // 바깥이 같은 탭 상태를 들고 있으면 함께 맞춘다(미전달 앱은 아무 일도 안 일어난다).
                if (typeof onSubTabChange === "function") onSubTabChange(key);
              }}
              className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                subTab === key ? "bg-wedly-bg-blue text-wedly-accent-ink" : "text-wedly-t2 hover:bg-wedly-bg-gray hover:text-wedly-t2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1">
          {subTab === "history" && (
            <div className="p-4">
              {historyGate === "panel" ? (
                <HistoryPanel
                  pageId={entryId}
                  adapter={historyAdapter}
                  currentUserName={userName}
                  isAdmin={config.editable || canWriteHistory ? isAdmin : false}
                  ownSource={config.ownSource}
                  enableImagePaste={!config.commentsReadOnly}
                  readOnly={config.commentsReadOnly === true}
                  timeFormatter={timeAgo}
                  pollingIntervalMs={5000}
                  shareEnabled={false}
                  hideCategories
                  draftId={entryId}
                />
              ) : historyGate === "loadFailed" ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-wedly-bd-red bg-wedly-bg-red px-3 py-3">
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-wedly-red">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-wedly-red-ink break-keep">계약 정보를 불러오지 못했어요</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-wedly-t2 break-keep">
                      지금 글을 남기면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다.
                      화면을 새로 고친 뒤 다시 열어 주세요.
                    </p>
                  </div>
                </div>
              ) : historyGate === "composer" ? (
                <FirstHistoryComposer
                  onAdd={async (text) => {
                    const owner = await acquireOwner();
                    try {
                      const res = await fetch(config.commentsPath(owner.id), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text }),
                      });
                      if (!res.ok) throw new Error("저장에 실패했습니다.");
                      onSaved?.();
                    } finally {
                      owner.release();
                    }
                  }}
                />
              ) : (
                <div className="py-12 text-center text-[13px] text-wedly-muted">아직 남겨진 히스토리가 없습니다.</div>
              )}
            </div>
          )}

          {subTab === "contract" && (
            <div className="p-4">
              <SettlementInfoTab key={tierSaveScopeFor("계약정보_차수")} {...settlementCommon} {...tierSavePropsFor("계약정보_차수")} rawValue={ownerTiers["계약정보_차수"]} onSave={onSaveTiersFor("계약정보_차수")} feeTargetForTier={feeTargetFor("계약정보_차수")} storagePrefix="contract" addButtonSuffixOverride="계약" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => config.renderTierBadge!({ entryId, kind: "contract", index: i, tierId: originalTierId(tid), tierIdDuplicated: dup }) : undefined} fieldsApiPath={config.contractFieldsPath} sectionTitle="계약정보" />
            </div>
          )}

          {subTab === "settlement" && (
            <div className="p-4">
              <SettlementInfoTab key={tierSaveScopeFor("정산정보")} {...settlementCommon} {...tierSavePropsFor("정산정보")} rawValue={ownerTiers["정산정보"]} onSave={onSaveTiersFor("정산정보")} feeTargetForTier={feeTargetFor("정산정보")} storagePrefix="settlement" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => config.renderTierBadge!({ entryId, kind: "settlement", index: i, tierId: originalTierId(tid), tierIdDuplicated: dup }) : undefined} fieldsApiPath={config.settlementFieldsPath} sectionTitle="정산정보" />
            </div>
          )}

          {subTab === "refund" && (
            <div className="p-4">
              <SettlementInfoTab key={tierSaveScopeFor("환불정보_차수")} {...settlementCommon} {...tierSavePropsFor("환불정보_차수")} rawValue={ownerTiers["환불정보_차수"]} onSave={onSaveTiersFor("환불정보_차수")} storagePrefix="refund" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => config.renderTierBadge!({ entryId, kind: "refund", index: i, tierId: originalTierId(tid), tierIdDuplicated: dup }) : undefined} fieldsApiPath={config.refundFieldsPath} sectionTitle="환불정보" />
            </div>
          )}

          {subTab === "meetings" && (
            <div className="p-4">
              <MeetingsTab readOnly={!canEditValues} rawValue={data["_meetings"] ?? null} onSave={canEditValues ? (json: string) => saveOrCreate("_meetings", json) : () => {}} />
            </div>
          )}
        </div>
      </div>
    );
  }
  return GovSubsidyPanel;
}

/** 항목이 없을 때 첫 히스토리 메모 입력칸 — 저장하면 정부지원금 항목이 자동생성된다. */
function FirstHistoryComposer({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onAdd(t);
      setText("");
      // 저장 성공 — 부모 새로고침(onSaved)으로 항목이 잡히면 이 컴포저는 패널로 교체된다.
      // 그 사이 빈 입력칸만 보이면 재입력(중복 메모)을 유도하므로 저장됨 안내를 띄운다(코드리뷰 반영).
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-wedly-muted">계약이 없어도 히스토리를 바로 남길 수 있어요. 첫 메모를 남기면 정부지원금 항목이 자동으로 만들어집니다.</p>
      {saved && (
        <div className="rounded-lg border border-wedly-bd-green bg-wedly-bg-green px-3 py-2 text-[13px] text-wedly-green-ink">
          저장했습니다. 히스토리를 불러오는 중…
        </div>
      )}
      {err && <div role="alert" className="rounded-lg border border-wedly-bd-red bg-wedly-bg-red px-3 py-2 text-[13px] text-wedly-red-ink">{err}</div>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="히스토리 메모를 입력하세요"
        className="w-full rounded-lg border border-wedly-bd px-3 py-2 text-sm focus:border-wedly-accent focus:outline-none"
        onKeyDown={(e) => {
          // 한글 IME 조합 확정 Enter로 미완성 텍스트가 제출되지 않게 가드(HistoryPanel과 동일 패턴).
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-wedly-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "저장 중…" : "히스토리 남기기"}
        </button>
      </div>
    </div>
  );
}
