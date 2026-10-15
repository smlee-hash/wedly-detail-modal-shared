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
import { GOV_SUB_TABS, resolveGovSubTab, type GovSubTab } from "./gov-subtab";
import type { SelectDropdownColorFamily } from "./SelectDropdown";
import { resolveHistoryGate } from "./gov-history-gate";
import { buildGovEvalBase } from "./gov-eval-context";
import { mergeTiersAcrossRows, splitMergedTiers, makeMergedTierId, parseMergedTierId, parseTierArray, tierIdOf } from "./gov-merged-tiers";
import {
  bindGovFeeEdit, isSensitiveGovFeeEdit, observedFeeViewMode,
  type GovFeeEditRequestV1, type GovPolicyFieldSaveOptions,
} from "./gov-fee-edit-binding";
import { hasNewFeeEditObservation, hasSavedTierMutation, ownerTierSavedBasis, refundReadProjectionOf, type SavedTierFieldSelection } from "./gov-save-observation";
import type { FeeTargetForTier, FeeTierView } from "./fee-tier-display";
import type { TierFieldEditIntentV1 } from "./tier-field-edit-intent";

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
  /** 관리자가 아니어도 값(계약정보·정산 등) 수정·신규 추가 허용(옵트인). 미설정 시 기존대로 관리자만.
   *  구조/칸 정의 편집은 이 플래그와 무관하게 항상 실제 관리자만(allowStructureEdit && isAdmin). */
  allowNonAdminEdit?: boolean;
  /** 수수료 계산식에 '반올림·내림' 항을 더할 수 있게 할지. 기본 꺼짐 — ERP 만 켠다.
   *  (사장님 결정 2026-08-15: 수수료 계산식은 ERP 에서만 관리) */
  allowStepTerms?: boolean;
  /** 수식 칸 관리자 수동 수정(_ovr_<칸키>·「(수정됨)」 배지) 허용. 기본 꺼짐 — ERP 만 켠다.
   *  allowNonAdminEdit 와 무관하게 **실제 관리자**에게만 열린다(요청서: 관리자 계정에서 수정). 2026-09-09 */
  allowFormulaOverride?: boolean;
  /** 히스토리 출처 라벨: "erp" | "hive" | "illua". */
  ownSource: string;
  /** ERP만 조건부 수식 UI. */
  enableConditionalFormula?: boolean;
  /** 조건부 수식 옵션(현재 행 기준). ERP만 제공. */
  conditionFieldOptions?: (row: Record<string, unknown>) => unknown;
  /** 히스토리 댓글 경로. */
  commentsPath: (entryId: string) => string;
  /**
   * 대표님께 보낼 카톡 보고문을 **서버에서** 만들어 오는 통로(선택). ERP 만 실어 준다.
   * 미주입이면 공용 HistoryPanel 이 기계 정리글로 떨어지고 창이 그 사실을 밝힌다.
   * ★없으면 정부지원금 탭의 「카톡 보고」가 늘 기계글만 낸다(2026-09-02 실사례 — 경정청구 탭만 AI 글이 나왔다).
   */
  buildKakaoReport?: (entryId: string, commentId: string) => Promise<string | null>;
  /** 히스토리 작성칸 아래에 앱이 끼워 넣을 칸(선택). entryId 는 이력의 대표 줄. */
  historyComposerExtra?: (entryId: string) => ReactNode;
  /** 히스토리 글이 저장된 뒤 앱이 할 일(선택). 실패해도 저장은 되돌리지 않는다(공용 HistoryPanel 이 잡는다). */
  onHistorySent?: (entryId: string, text: string) => void | Promise<void>;
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
  /** 하위 탭(계약·정산·환불) 머리에 앱이 끼우는 부품 — ERP 만 주입(수식 설정 버튼). 미주입이면 아무것도 그리지 않는다. */
  renderSubTabHeader?: (ctx: { subTab: "contract" | "settlement" | "refund"; entryId: string }) => ReactNode;
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
  /** 이력을 읽고 쓸 행 고르기(선택). 미설정 시 filterPolicyRows 결과를 그대로 쓴다. 계약 저장 소유자에는 영향을 주지 않는다. */
  filterHistoryRows?: (rows: SectionPanelProps["rows"]) => SectionPanelProps["rows"];
  /** 조건부 수식 기준 칸을 가져올 기본정보 도메인(ERP가 "government-subsidy" 등 주입). */
  conditionBasicDomain?: string;
  /** 선택 칸 보기 색 고르는 판. 내려주면 차수 카드 드롭다운에 「색상 변경」이 뜬다. */
  colorFamilies?: SelectDropdownColorFamily[];
};

type SubTab = GovSubTab;
const SUB_TABS = GOV_SUB_TABS;
type MergedTierSaveState = { saving: boolean; resetRevision: number; error: string | null };
type PendingTierOwnerSave = {
  savedBasis: string;
  beforeRaw: unknown;
  submittedRaw: string;
  succeeded: boolean;
  feeEdit?: GovFeeEditRequestV1;
  ordinaryEdit?: SavedTierFieldSelection;
};
type PendingMergedTierSave = {
  panelScope: string;
  /** 이 요청이 잠금을 잡은 컨테이너와 소유자 순서 — 실패 기록의 이름이 된다. */
  key: string;
  scopeOwnerIds: readonly string[];
  /** 요청이 시작된 순서 — 실패 기록을 지우고 덮을 때 더 새 요청의 기록을 건드리지 않으려고 비교한다. */
  seq: number;
  finished: boolean;
  createdOwnerId?: string;
  /**
   * 다시 읽기(onSaved) 요청을 받은 마운트가 아직 없다 — 같은 패널이 다시 열릴 때 전달한다.
   * 저장이 끝난 뒤뿐 아니라, 첫 계약 줄이 rows 에 나타나길 기다리는 중(아직 저장 전)에도 켜진다.
   */
  refreshPending?: boolean;
  owners: Map<string, PendingTierOwnerSave>;
};
/** error: null = 새 요청의 시작 또는 저장 확인, 문자열 = 끝난 요청의 실패 이유, 생략 = 오류와 무관한 알림. */
type TierSaveNotice = { scope: string; save: PendingMergedTierSave; error?: string | null; reset?: boolean; refresh?: boolean; refreshError?: string };
/** 끝난 저장 하나의 실패 이유. 저장 잠금과 무관하게 남는다 — 화면에 이유를 보이기만 하고 아무것도 잠그지 않는다. */
type TierSaveFailure = { save: PendingMergedTierSave; message: string };
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

/** 같은 고객(panelScope)·소유자 목록(순서까지)·컨테이너마다 하나인 이름 — 저장 잠금과 실패 기록이 함께 쓴다. */
const scopeForOwners = (panelScope: string, ownerIds: readonly string[], key: string) => JSON.stringify([panelScope, ownerIds, key]);

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
 * 합친 목록의 차수 하나가 보여 줄 서버 수수료 대상을, 지금 받아 둔 줄 목록에서 **정확히 하나만** 고른다.
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

// 댓글 한 건의 id(문자열/숫자). 없으면 빈 문자열 = 어느 계약 댓글인지 기억할 수 없는 댓글.
function commentIdOf(c: UnifiedComment): string {
  const id = (c as unknown as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
}

/**
 * 현재 이력 소유 계약들의 댓글 통로. 수수료 저장 소유자와 별개로 유지한다.
 *  · fetch  : 소유 계약마다 읽어 한 목록으로 합친다. 한 곳이라도 실패하면 통째로 실패 — 일부만 보여 주지 않는다.
 *  · create : 대표 계약(primaryId)에만 쓴다. 소유 계약이 둘 이상인데 확정된 목록이 아직 전부 없으면
 *    쓰기 전에 먼저 전부 읽고, 하나라도 못 읽으면 아무것도 쓰지 않고 실패한다.
 *  · edit/remove : 그 댓글을 읽어 온 **원래 계약**으로만 보낸다. 소유 계약을 모르거나(미확인) 둘 이상이면(모호)
 *    다른 계약에 잘못 쓰지 않도록 쓰기 전에 실패시킨다.
 *  · 쓰기가 성공하면 쓴 계약의 응답 목록을 확정하고, 모든 소유 계약을 다시 읽어 합친 목록을 돌려준다.
 *    다시 읽기만 실패하면 거절하지 않고 「쓴 계약의 응답 목록 + 다른 계약의 마지막 확정 목록」을 합쳐 돌려준다 —
 *    쓰기는 이미 서버에 반영됐는데 거절하면 HistoryPanel 이 입력 초안을 되살려 같은 글을 다시 등록하게 만든다(중복 저장).
 *  · 확정 목록은 계약별로 「읽기 성공 | 쓰기 응답」일 때만 갈아 끼운다. 합친 목록과 댓글 소유 계약은 늘 이 목록에서
 *    다시 만든다. 읽기는 시작할 때, 쓰기 응답은 받을 때 시각표를 찍어, 더 늦게 확정된 것을 오래된 읽기 응답
 *    (5초 폴링이 쓰기 응답보다 늦게 도착하는 경우)이 덮지 못하게 한다.
 */
function createOwnerHistory(args: {
  ownerIds: string[];
  primaryId: string;
  commentsPath: (entryId: string) => string;
}): Pick<HistoryAdapter, "fetch" | "create" | "edit" | "remove"> & { ownerOf: (commentId: string) => string } {
  // 소유 계약별 마지막 확정 목록. 없으면 그 계약은 아직 한 번도 확정된 적이 없다.
  const lists = new Map<string, UnifiedComment[]>();
  // 계약별로 마지막 확정 시각표(단조 증가). 이보다 이르게 시작한 읽기 결과는 버린다.
  const settledAt = new Map<string, number>();
  let clock = 0;

  function settle(ownerId: string, comments: UnifiedComment[], at: number): void {
    if (at <= (settledAt.get(ownerId) ?? 0)) return;
    settledAt.set(ownerId, at);
    lists.set(ownerId, comments);
  }

  // 확정 목록에서 합친 목록과 소유 계약을 함께 다시 만든다(소유 계약 순서대로).
  // owners: 댓글 id → 그 댓글이 든 계약 entryId. null = 같은 id 가 둘 이상의 계약에 있음(소유자 모호).
  function view(): { merged: UnifiedComment[]; owners: Map<string, string | null> } {
    const owners = new Map<string, string | null>();
    const merged: UnifiedComment[] = [];
    for (const ownerId of args.ownerIds) {
      for (const c of lists.get(ownerId) ?? []) {
        const id = commentIdOf(c);
        // ERP는 같은 댓글을 한 번만 표시하되, 중복 소유자는 계속 모호한 것으로 기록한다.
        if (!id || !owners.has(id)) merged.push(c);
        if (!id) continue;
        owners.set(id, owners.has(id) && owners.get(id) !== ownerId ? null : ownerId);
      }
    }
    // 기존 ERP의 오래된 댓글부터 표시하는 순서를 유지한다.
    merged.sort((a, b) => Date.parse(a?.createdAt ?? "") - Date.parse(b?.createdAt ?? ""));
    return { merged, owners };
  }

  async function fetchAll(): Promise<UnifiedComment[]> {
    const results = await Promise.allSettled(
      args.ownerIds.map(async (ownerId) => {
        const at = ++clock;
        return { ownerId, at, comments: await commentsJson(await fetch(args.commentsPath(ownerId), { cache: "no-store" })) };
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    // 전부 성공했을 때만 확정한다(실패한 읽기가 이전 확정 목록을 지우거나 일부만 갈아 끼우지 않게).
    for (const r of results) {
      if (r.status === "fulfilled") settle(r.value.ownerId, r.value.comments, r.value.at);
    }
    return view().merged;
  }

  function ownerOf(commentId: string): string {
    const { owners } = view();
    const owner = owners.get(String(commentId));
    if (owner) return owner;
    throw new Error(
      owners.has(String(commentId))
        ? "여러 계약에 함께 표시된 기록의 원본을 확인하지 못했습니다. 원본 기록 화면에서 확인해 주세요."
        : "이 댓글이 어느 계약의 히스토리인지 확인하지 못했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.",
    );
  }

  let writeTail: Promise<void> = Promise.resolve();
  function writeThenRefresh(ownerId: string, method: string, payload: Record<string, unknown>): Promise<UnifiedComment[]> {
    // 작성·수정·삭제 버튼은 서로 겹쳐 눌릴 수 있다. 같은 어댑터의 쓰기 응답 순서를 지킨다.
    const pending = writeTail.then(async () => {
      const acked = await commentsJson(
        await fetch(args.commentsPath(ownerId), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      );
      // ERP 쓰기 응답은 옛 일루아 글·진행 정책 기록을 생략한다. 기존 읽기 목록과 합치고,
      // 직접 삭제한 글만 뺀다. 전체 목록 교체는 뒤의 성공한 GET이 맡는다.
      const deletedId = method === "DELETE" ? String(payload.commentId) : null;
      const retained = (lists.get(ownerId) ?? []).filter(c => deletedId === null || commentIdOf(c) !== deletedId);
      for (const comment of acked) {
        const id = commentIdOf(comment);
        const index = id ? retained.findIndex(c => commentIdOf(c) === id) : -1;
        if (index < 0) retained.push(comment); else retained[index] = comment;
      }
      // 여기부터 쓰기는 서버에 반영된 것 — 이후 조회 실패를 저장 실패로 바꾸지 않는다.
      settle(ownerId, retained, ++clock);
      try {
        return await fetchAll();
      } catch {
        return view().merged;
      }
    });
    writeTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  // 여러 소유 계약에 새 글을 쓰기 전: 다른 계약의 마지막 확정 목록이 있어야 쓴 뒤 다시 읽기가 실패해도
  // 합친 목록을 만들 수 있다. 없으면 먼저 읽고, 못 읽은 계약이 있으면 쓰기 전에 멈춘다.
  async function ensureSnapshot(): Promise<void> {
    if (args.ownerIds.length < 2 || args.ownerIds.every((id) => lists.has(id))) return;
    // 인증·통신 실패 종류를 보존해야 HistoryPanel이 올바른 복구 방법을 안내한다.
    await fetchAll();
    if (!args.ownerIds.every((id) => lists.has(id))) {
      throw new Error("다른 계약의 히스토리를 확인하지 못해 저장하지 않았습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.");
    }
  }

  return {
    ownerOf,
    fetch: async () => ({ comments: await fetchAll() }),
    create: async ({ text, category }) => {
      await ensureSnapshot();
      return writeThenRefresh(args.primaryId, "POST", { text, category });
    },
    edit: async ({ commentId, text }) => writeThenRefresh(ownerOf(commentId), "PATCH", { commentId, text }),
    remove: async ({ commentId }) => writeThenRefresh(ownerOf(commentId), "DELETE", { commentId }),
  };
}

/** 앱별 설정을 받아 정부지원금 섹션 패널 컴포넌트를 만든다(sectionPanels 에 주입). */
export function createGovSubsidyPanel(config: GovSubsidyPanelConfig) {
  // 바깥 도메인 탭이 패널을 없애도 같은 고객·소유자 순서·컨테이너의 미확인 저장은 유지한다.
  // 관측값은 각 마운트에서 현재 rows로만 읽는다. 여기에는 진행 중인 요청만 둔다.
  const pendingTierSaves = new Map<string, PendingMergedTierSave>();
  const tierSaveListeners = new Set<(notice: TierSaveNotice) => void>();
  // 끝난 저장의 실패 이유 — 패널이 닫혀 있어도, 화면이 그 사이 첫 저장이 만든 줄로 바뀌어도 읽을 수 있게 마운트와 따로 둔다.
  // 같은 고객(panelScope)·컨테이너·소유자 순서마다 가장 최근 하나만 둔다. 같은 곳에서 새 요청이 시작되면 지운다. 이 기록은 잠금이 아니다 — 화면에 이유를 보이기만 한다.
  const tierSaveFailures = new Map<string, TierSaveFailure>();
  let tierSaveSeq = 0;
  // 이 요청의 실패를 읽을 수 있는 이름들. 첫 줄을 만들던 저장(빈 소유자 목록)만 "빈 목록 → 방금 만든 그 줄 하나" 별칭이 하나 더 생긴다. 다른 목록·고객으로는 번지지 않는다.
  const failureScopesOf = (save: PendingMergedTierSave) => {
    const scopes = [scopeForOwners(save.panelScope, save.scopeOwnerIds, save.key)];
    if (save.scopeOwnerIds.length === 0 && save.createdOwnerId) scopes.push(scopeForOwners(save.panelScope, [save.createdOwnerId], save.key));
    return scopes;
  };
  const forgetTierFailure = (failure: TierSaveFailure) => {
    for (const scope of failureScopesOf(failure.save)) {
      if (tierSaveFailures.get(scope) === failure) tierSaveFailures.delete(scope);
    }
  };
  // 이 요청보다 먼저 시작한 요청의 실패만 지운다 — 새 요청을 시작할 때와 이 요청의 저장 확인이 도착할 때. 더 새 요청의 실패는 남긴다.
  const clearOlderTierFailures = (save: PendingMergedTierSave) => {
    for (const scope of failureScopesOf(save)) {
      const failure = tierSaveFailures.get(scope);
      if (failure && failure.save.seq < save.seq) forgetTierFailure(failure);
    }
  };
  const recordTierFailure = (save: PendingMergedTierSave, message: string) => {
    clearOlderTierFailures(save);
    const scopes = failureScopesOf(save);
    if (scopes.some((scope) => tierSaveFailures.has(scope))) return; // 남아 있는 것은 이 요청보다 새 요청의 실패다
    const failure: TierSaveFailure = { save, message };
    for (const scope of scopes) tierSaveFailures.set(scope, failure);
  };
  // 다시 읽기 실패는 이 요청 자신의 실패 이유 뒤에 이어 붙인다. 이 요청의 실패가 없으면 그것만 이 요청의 기록이 된다.
  const appendRefreshFailure = (save: PendingMergedTierSave, refreshError: string) => {
    const text = `저장된 값을 다시 불러오지 못했습니다. ${refreshError} 화면을 새로 고친 뒤 확인해 주세요.`;
    const own = failureScopesOf(save).map((scope) => tierSaveFailures.get(scope)).find((failure) => failure?.save === save);
    if (own) own.message = `${own.message} ${text}`;
    else recordTierFailure(save, text);
  };
  const notifyTierSave = (notice: TierSaveNotice) => {
    // 듣는 화면이 없어도 먼저 기록한다. 늦은 콜백은 호출하는 쪽의 요청 비교(pendingTierSaves)를 통과한 현재 요청만 여기까지 온다.
    if (notice.error === null) clearOlderTierFailures(notice.save);
    else if (notice.error !== undefined) recordTierFailure(notice.save, notice.error);
    if (notice.refreshError !== undefined) appendRefreshFailure(notice.save, notice.refreshError);
    for (const listener of tierSaveListeners) listener(notice);
  };
  const releaseTierSave = (scope: string, save: PendingMergedTierSave, notice: Omit<TierSaveNotice, "scope" | "save"> = {}) => {
    if (pendingTierSaves.get(scope) !== save) return;
    pendingTierSaves.delete(scope);
    notifyTierSave({ scope, save, ...notice });
  };
  // 첫 계약 줄을 만드는 요청도 같은 논리 패널(panelScope)의 마운트·컨테이너·히스토리 사이에 하나로 공유한다.
  // 진행 중인 요청과 끝난 새 줄 id 를 함께 둔다. 닫힘(unmount)만으로는 비우지 않는다 —
  // rows 가 그 새 줄을 보여 주고 이어서 쓰는 요청도 없을 때에만 정확히 그 항목만 비운다.
  const contractCreations = new Map<string, ContractCreation>();
  const creationListeners = new Set<(panelScope: string) => void>();
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
   * 만들기 응답으로 받은 줄 id(ownerId)가 현재 rows 에 나타나길 기다린다. 응답이 rows 보다 늦든 빠르든 같은 확인을 거친다.
   * 기한(20초)은 실패로만 끝낸다. 끝나면(확인·실패·기한) 타이머와 등록을 모두 푼다. 패널이 닫힌 것만으로는 끝나지 않는다.
   * 기한은 이 요청이 가진 남은 시간(remainingMs)으로 센다. 정확히 같은 panelScope 의 패널이 하나라도 마운트된 동안만 타이머가 돌고,
   * 하나도 없으면 타이머를 끄고 남은 시간만 보관한다. 같은 패널이 다시 열리면 그 남은 시간으로 이어 간다.
   */
  const awaitCreatedOwner = (scope: string, save: PendingMergedTierSave, ownerId: string, key: string): Promise<PolicyRow> => (
    new Promise<PolicyRow>((resolve, reject) => {
      let settled = false;
      let remainingMs = OWNER_OBSERVATION_DEADLINE_MS;
      let startAt = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter: OwnerWaiter = {
        panelScope: save.panelScope,
        evaluate: () => {
          if (settled) return;
          const observation = observeCreatedOwner(save.panelScope, ownerId, key);
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
  function GovSubsidyPanel({
    rows,
    primaryRow,
    isAdmin,
    onSaved,
    adapter,
    historyOnly,
    hiddenSubTabs,
    hideSubTabBar,
    subTab: subTabProp,
    onSubTabChange,
  }: SectionPanelProps & {
    /** true 면 히스토리만 그린다(3분할 오른쪽 패널용). 미전달이면 기존 전체 패널 그대로. */
    historyOnly?: boolean;
    /** 숨길 하위 탭 키(예: 3분할 가운데에서 히스토리를 오른쪽으로 옮길 때 ["history"]). 미전달이면 불변. */
    hiddenSubTabs?: string[];
    /** true 면 이 패널의 하위 탭 줄을 그리지 않는다 — 바깥(오른쪽 한 줄)으로 끌어올렸을 때. 미전달 불변. */
    hideSubTabBar?: boolean;
    /** 바깥이 하위 탭을 지정할 때. 제어 여부는 onSubTabChange 가 함수일 때만 — 이 값만 오면 무시(하이브·일루아 불변). */
    subTab?: string;
    /** 함수로 오면 제어 모드 — 바깥 탭 줄이 이 패널 내용을 바꾼다. 미전달이면 내부 상태만. */
    onSubTabChange?: (t: string) => void;
  }) {
    const policyRows = config.filterPolicyRows(rows) as PolicyRow[];
    const historyRows = config.filterHistoryRows?.(rows) ?? policyRows;
    const TIER_KEYS = ["계약정보_차수", "정산정보", "환불정보_차수"] as const;
    // ★policyRows 는 렌더마다 새 배열이라 그대로 의존성에 쓰면 이 계산이
    //   매 렌더 새로 만들어진다.
    //   그래서 「줄 id + 차수 원문」만 뽑은 글자를 기준으로 삼는다.
    const policyKey = policyRows
      .map((r) => `${r.entryId}:${TIER_KEYS.map((k) => JSON.stringify((r.row ?? {})[k] ?? null)).join("|")}`)
      .join("\u0001");
    const ownerIds = useMemo(() => policyRows.map((r) => r.entryId), [policyKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // 항목이 없어도 히스토리로 먼저 연다 — 첫 메모 입력칸(또는 안내)이 바로 보이게(재작업 2026-07-15).
    // 기존엔 항목 없으면 '계약정보'로 열려, 첫 메모 입력이 가능한지 알기 어려웠다.
    const [subTab, setSubTab] = useState<SubTab>("history");
    // 제어 모드 = 콜백이 있고 + 바깥이 탭 줄을 그린다(hideSubTabBar). 판정 근거는 resolveGovSubTab 주석.
    const isSubTabControlled = typeof onSubTabChange === "function" && hideSubTabBar === true;
    // ★ 폴백은 prop 을 넘긴 쪽(3분할)에서만 — 미전달이면 그대로(기존 앱 렌더 불변).
    const displaySubTabs = hiddenSubTabs?.length
      ? SUB_TABS.filter((t) => !hiddenSubTabs.includes(t.key))
      : SUB_TABS;
    const shownSubTab: SubTab = resolveGovSubTab({
      subTabProp,
      internal: subTab,
      controlled: isSubTabControlled,
      hiddenSubTabs,
      historyOnly,
    });
    // 알약을 없애 「보고 있는 계약 고르기」가 사라졌다. entryId·data 는 여전히 대표 줄을 가리키며
    // 미팅정보 저장처럼 **계약 줄 하나를 골라야 하는 일**의 기준으로 쓰인다.
    const sel = 0;
    const [err, setErr] = useState<string | null>(null);
    const [userName, setUserName] = useState("");
    const tierSavedObservationsRef = useRef(new Map<string, Map<string, string>>());
    const [tierSaveStates, setTierSaveStates] = useState<Record<string, MergedTierSaveState>>({});

    useEffect(() => {
      adapter.api.currentUser().then((u) => setUserName(u?.name ?? "")).catch(() => {});
    }, [adapter]);

    const anchorKey = String(primaryRow["15사업자번호"] ?? primaryRow["04사업자번호"] ?? primaryRow["_id"] ?? "");
    const panelScope = JSON.stringify([config.ownSource, primaryRow["_id"] ?? null, anchorKey]);

    const idx = policyRows.length ? Math.min(sel, policyRows.length - 1) : -1;
    const entry = idx >= 0 ? policyRows[idx] : null;
    const entryId = entry?.entryId ?? "";
    const historyEntryId = historyRows[0]?.entryId ?? "";
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
    // 상세창이 분야 행 목록을 못 불러왔나 — 상자가 없는 호출부는 항상 거짓이라 동작 그대로.
    const { rowsLoadFailed } = useDetailLoadState();
    // 첫 계약 줄을 기다리는 금액 저장이 읽을 이 마운트의 현재 값. 그려질 때마다 갱신하고 기다리는 요청에 확인을 맡긴다.
    const liveRef = useRef<MountedPanelView>({ panelScope, policyRows, rowsLoadFailed, onSaved });
    useEffect(() => {
      liveRef.current = { panelScope, policyRows, rowsLoadFailed, onSaved };
      pokeOwnerWaiters(panelScope);
    });
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
    const historyGate = resolveHistoryGate({ entryId: historyEntryId, canEditValues, canWriteHistory, hasCreateContract: Boolean(config.createContract), rowsLoadFailed });
    const MeetingsTab = adapter.components.MeetingsTab as ComponentType<{ rawValue: unknown; onSave: (json: string) => void; readOnly?: boolean }>;

    // 이 회사의 이력 줄 전부의 기록을 **한 목록**으로 보여 준다(기본은 계약 줄, 앱별로 추가 가능).
    //   왜: 알약을 없앴으므로, 합치지 않으면 계약 2·3 에 적혀 있던 기록이 화면에서 영영 안 보인다.
    //   쓰기: 새 글은 대표 줄에, 고치기·지우기는 **그 글이 실제로 있는 줄**에 보낸다(아래 지도).
    //   실패: 한 줄이라도 못 읽으면 조용히 「기록 없음」으로 만들지 않고 오류를 그대로 올린다
    //        (빈 목록 성공으로 바꾸면 글이 사라진 것처럼 보인다 — commentsJson 주석과 같은 이유).
    // 필터가 매 렌더 새 배열을 돌려줘도 소유자 id와 순서가 같으면 이력 어댑터·새로고침 타이머를 유지한다.
    const historyKey = JSON.stringify(historyRows.map((r) => r.entryId));
    const historyEntryIds = useMemo(
      () => JSON.parse(historyKey) as string[],
      [historyKey],
    );
    const historyAdapter = useMemo<HistoryAdapter & { ownerOf: (commentId: string) => string }>(() => {
      const ids = historyEntryIds;
      const primary = ids[0] ?? historyEntryId;
      const ro = config.commentsReadOnly === true;
      const blocked = async (): Promise<UnifiedComment[]> => {
        throw new Error("이 앱에서는 정부지원금 히스토리를 작성할 수 없습니다. ERP 또는 일루아에서 작성해 주세요.");
      };
      const owned = createOwnerHistory({ ownerIds: ids, primaryId: primary, commentsPath: config.commentsPath });
      return {
        ...owned,
        create: ro ? blocked : owned.create,
        edit: ro ? blocked : owned.edit,
        remove: ro ? blocked : owned.remove,
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
    }, [historyEntryIds, historyEntryId]);

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

    // ── 차수 합치기 ────────────────────────────────────────────────────────────
    // 그 회사의 계약 줄 전부에서 같은 종류 차수를 모아 한 목록으로 보여 준다(오래된 것부터 —
    // 번호를 그 자리로 매기고, 화면은 최신이 맨 위로 뒤집힌다). 합쳐 **보여 줄 뿐** 자료는 옮기지
    // 않는다: 차수 id 에 주인 줄 번호를 박아 두고, 저장할 때 원래 id·원래 줄로 되돌린다.
    const mergedTiers = useMemo(() => {
      const src = policyRows.map((r) => ({ entryId: r.entryId, row: (r.row ?? {}) as Record<string, unknown> }));
      const out: Record<string, string> = {};
      for (const key of TIER_KEYS) out[key] = JSON.stringify(mergeTiersAcrossRows(src, key).tiers);
      return out;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [policyKey]);

    // 고객의 실제 id도 묶는다 — 사업자번호가 같아도 옛 고객의 실패가 현재 입력을 초기화하지 않는다.
    // 소유자 순서는 합친 차수 id의 줄 번호와 연결되므로, 목록 순서가 바뀌면 화면 부품도 새로 연다.
    const tierSaveScopeFor = (key: string) => {
      const draftScope = scopeForOwners(panelScope, [], key);
      const draftSave = pendingTierSaves.get(draftScope);
      // 자동 생성한 첫 저장도 실제 서버 줄이 rows에 나타나 저장값이 확인될 때까지 같은 요청이다.
      if (draftSave && (!ownerIds.length || (ownerIds.length === 1 && draftSave.createdOwnerId === ownerIds[0]))) return draftScope;
      return scopeForOwners(panelScope, ownerIds, key);
    };

    const releaseObservedTierSaves = useCallback(() => {
      for (const [scope, save] of pendingTierSaves) {
        if (save.panelScope !== panelScope) continue;
        const observations = tierSavedObservationsRef.current.get(scope);
        for (const [ownerId, ownerSave] of save.owners) {
          const observed = observations?.get(ownerId);
          if (!ownerSave.succeeded || !observed) continue;
          // 돈 칸은 그 선택의 새 사건만 인정한다. 일반 칸은 실제 제출한 변경을 대조한다.
          if (ownerSave.feeEdit) {
            if (observed === ownerSave.savedBasis
              || !hasNewFeeEditObservation(observed, ownerSave.feeEdit)) continue;
          } else {
            const observedRaw = (JSON.parse(observed) as { raw?: unknown }).raw;
            // 환불 읽기 투영은 지금 rows 의 같은 소유자 줄이 켜졌을 때만 푼다. 정확히 한 줄이 아니면 엄격하게 대조한다.
            const currentOwners = liveRef.current.policyRows.filter((candidate) => candidate.entryId === ownerId);
            const refundContext = refundReadProjectionOf(currentOwners.length === 1 ? currentOwners[0] : null, save.key);
            if (!hasSavedTierMutation(ownerSave.beforeRaw, ownerSave.submittedRaw, observedRaw, ownerSave.ordinaryEdit, refundContext)) continue;
          }
          save.owners.delete(ownerId);
        }
        // 일부 줄이 먼저 확인돼도 나머지 요청·성공한 줄의 확인이 끝나기 전에는 다시 쓰지 않는다.
        if (!save.finished || save.owners.size > 0) continue;
        // 확인이 끝난 요청이 지우는 것은 자기보다 먼저 시작한 요청의 실패뿐이다 — 자기 실패와 더 새 요청의 실패는 남는다.
        releaseTierSave(scope, save, { error: null });
      }
    }, [panelScope]);
    useEffect(() => {
      // 다시 읽기 요청을 받은 것으로 먼저 표시한 뒤 부른다(다시 그려져도 반복하지 않게).
      const requestRefresh = (scope: string, save: PendingMergedTierSave) => {
        save.refreshPending = false;
        void Promise.resolve().then(() => onSaved?.()).catch((e) => {
          // 늦은 재조회 실패가 같은 범위의 새 저장을 초기화하지 않는다.
          if (pendingTierSaves.get(scope) !== save) return;
          notifyTierSave({
            scope, save, reset: true,
            refreshError: e instanceof Error ? e.message : "",
          });
        });
      };
      const listener = (notice: TierSaveNotice) => {
        if (notice.save.panelScope !== panelScope) return;
        setTierSaveStates((prev) => {
          const saving = pendingTierSaves.has(notice.scope);
          const previousError = prev[notice.scope]?.error ?? null;
          // 끝난 요청의 실패 이유(다시 읽기 실패 포함)는 여기(옛 scope)에 두지 않는다 — tierSaveFailures 에서 읽는다. 여기 남는 오류는 저장 중 안내(SAVE_BUSY_ERROR)뿐이다.
          const cleared = notice.error !== undefined || notice.refreshError !== undefined
            || (!saving && previousError === SAVE_BUSY_ERROR);
          const error = cleared ? null : previousError;
          return {
            ...prev,
            [notice.scope]: {
              saving,
              resetRevision: (prev[notice.scope]?.resetRevision ?? 0) + (notice.reset ? 1 : 0),
              error,
            },
          };
        });
        // 옛 인스턴스의 응답도 현재 마운트의 관측과 대조한다. unmount 때 구독은 제거한다.
        releaseObservedTierSaves();
        // 요청할 수 있는 마운트(onSaved 가 있는 쪽)만 신호를 받는다.
        if (notice.refresh && onSaved) requestRefresh(notice.scope, notice.save);
      };
      tierSaveListeners.add(listener);
      // 패널이 닫힌 사이 성공한 저장(또는 첫 계약 줄을 기다리는 저장)은 다시 읽기 요청을 받을 마운트가 없었다 — 같은 회사로 다시 열린 이 마운트가 한 번 대신 요청한다.
      // 이 신호는 다시 읽기 요청일 뿐이다 — 저장 잠금은 위 관측(releaseObservedTierSaves)이 실제 저장값을 볼 때에만 푼다.
      // onSaved 가 없는 마운트는 받은 것으로 치지 않는다.
      if (onSaved) {
        for (const [scope, save] of pendingTierSaves) {
          if (save.panelScope === panelScope && save.refreshPending) requestRefresh(scope, save);
        }
      }
      // 그리고 구독하는 사이에 끝난 실패도 놓치지 않는다 — 이 고객의 실패 기록이 있으면 한 번 더 그려 읽는다(읽기만, 요청은 없다).
      for (const failure of tierSaveFailures.values()) {
        if (failure.save.panelScope !== panelScope) continue;
        setTierSaveStates((prev) => ({ ...prev }));
        break;
      }
      return () => { tierSaveListeners.delete(listener); };
    }, [panelScope, onSaved, releaseObservedTierSaves]);
    // 부모가 실제 받은 저장본만 기록한다. 새 자료가 원격 성공보다 먼저 와도 성공 뒤에 대조할 수 있다.
    const observedTierSnapshots = JSON.stringify(TIER_KEYS.map((key) => [
      tierSaveScopeFor(key),
      policyRows.filter((owner) => policyRows.filter((candidate) => candidate.entryId === owner.entryId).length === 1)
        .map((owner) => [owner.entryId, ownerTierSavedBasis(owner, key)]),
    ]));
    useEffect(() => {
      const snapshots = JSON.parse(observedTierSnapshots) as Array<[string, Array<[string, string]>]>;
      tierSavedObservationsRef.current = new Map(snapshots.map(([scope, owners]) => [scope, new Map(owners)]));
      releaseObservedTierSaves();
    }, [observedTierSnapshots, releaseObservedTierSaves]);

    /** 합친 목록이 저장될 때 — 줄마다 나눠 저장한다. 바뀐 줄만 실제로 보낸다. */
    async function saveMergedTiers(key: string, json: string, editIntent?: TierFieldEditIntentV1) {
      // 요청을 시작한 고객·소유자 목록·컨테이너를 끝까지 유지한다.
      const scope = tierSaveScopeFor(key);
      if (pendingTierSaves.has(scope)) {
        setTierSaveStates((prev) => ({
          ...prev,
          [scope]: { saving: true, resetRevision: (prev[scope]?.resetRevision ?? 0) + 1, error: SAVE_BUSY_ERROR },
        }));
        return;
      }
      const pendingSave: PendingMergedTierSave = { panelScope, key, scopeOwnerIds: ownerIds, seq: ++tierSaveSeq, finished: false, owners: new Map() };
      pendingTierSaves.set(scope, pendingSave);
      notifyTierSave({ scope, save: pendingSave, error: null });
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
        let owners = ownerIds;
        let bindRows: ReadonlyArray<PolicyRow> = policyRows;
        if (owners.length === 0) {
          // 계약 줄이 아직 없다 — 기존처럼 첫 저장 때 자동 생성한다(같은 패널의 만들기는 한 번만).
          const created = await acquireOwner();
          releaseOwner = created.release;
          const id = created.id;
          pendingSave.createdOwnerId = id;
          if (!isSensitiveGovFeeEdit(key, editIntent)) {
            const ownerSave: PendingTierOwnerSave = {
              savedBasis: ownerTierSavedBasis(null, key), beforeRaw: undefined,
              submittedRaw: json, succeeded: false,
            };
            pendingSave.owners.set(id, ownerSave);
            await config.savePolicyField(id, key, json);
            ownerSave.succeeded = true;
            refresh = true;
            return;
          }
          // 금액 칸의 첫 저장은 만들어진 id 만으로 보내지 않는다. 그 줄이 rows 에 실제로 나타나 수수료 표시를 읽은 뒤에만
          // 아래 기존 소유자 경로(bindGovFeeEdit)로 이어 간다. 확인하지 못하면 세 인자 저장으로 낮추지 않고 실패한다.
          const target = await awaitCreatedOwner(scope, pendingSave, id, key);
          // 이제부터 소유자는 방금 읽은 이 줄 하나다 — 합친 다른 줄은 검증도, 저장도 하지 않는다.
          owners = [target.entryId];
          bindRows = [target];
        }
        // 한 소유자의 오류 때문에 다른 소유자만 먼저 저장되는 일이 없게 모두 쓰기 전에 검증한다.
        // 첫 줄을 만든 금액 저장도 방금 읽은 그 줄과 처음 캡처한 editIntent 로 같은 경로를 탄다(새 차수 id·요청 id·이전 값 그대로).
        const binding = bindGovFeeEdit(bindRows, key, saved, editIntent);
        const feeEdit = binding?.feeEdit;
        // 칸 하나를 직접 고친 저장은 고른 소유자의 줄만 쓴다 — 건드리지 않은 다른 줄은 나눠 보내지 않는다.
        //   (의도 없는 저장은 기존처럼 모든 줄을 나눠 저장한다.)
        const writes = [...splitMergedTiers(saved, owners)]
          .filter(([entryId]) => !binding || entryId === binding.entryId)
          .map(([entryId, tiers]) => {
            let ordinaryEdit: SavedTierFieldSelection | undefined;
            if (editIntent && !feeEdit) {
              // 합친 화면의 자리가 아닌 splitMergedTiers와 같은 실제 소유자 안의 자리로 확인한다.
              const ownerIndex = owners.indexOf(entryId);
              const selected = saved.filter((tier) => {
                const ref = parseMergedTierId(tier.id);
                return (ref && owners[ref.ownerIndex] ? ref.ownerIndex : 0) === ownerIndex;
              });
              const index = selected.findIndex((tier) => tier.id === editIntent.tierId);
              if (index < 0 || !tiers[index]) throw new Error("수정한 차수를 확인하지 못했습니다.");
              ordinaryEdit = { tierId: tierIdOf(tiers[index]), index, fieldKey: editIntent.fieldKey };
            }
            return { entryId, tiers, ordinaryEdit };
          });
        // ★어느 줄이 실제로 써졌는지 센다. 중간에 실패해도 **이미 써진 것은 화면에 반영**해야
        //   한다 — 안 그러면 화면은 옛 상태를 계속 보여 주고 서버만 바뀐 「반쪽 저장」이 된다
        //   (독립 리뷰 F5). 실패한 줄은 이름을 들어 알린다.
        const wrote: string[] = [];
        const failed: string[] = [];
        let firstError = "";
        for (const { entryId, tiers, ordinaryEdit } of writes) {
          const owner = bindRows.find((r) => r.entryId === entryId) ?? null;
          const before = JSON.stringify(parseTierArray((owner?.row ?? {})[key]));
          const after = JSON.stringify(tiers);
          const options = feeEdit ? { feeEdit } : undefined;
          if (before === after && !options) continue; // 같은 금액 확정도 선택한 소유자의 수정 기준은 저장한다.
          const savedBasis = ownerTierSavedBasis(owner, key);
          const ownerSave: PendingTierOwnerSave = {
            savedBasis,
            beforeRaw: (JSON.parse(savedBasis) as { raw?: unknown }).raw,
            submittedRaw: after, succeeded: false, feeEdit, ordinaryEdit,
          };
          pendingSave.owners.set(entryId, ownerSave);
          try {
            if (options) await config.savePolicyField(entryId, key, after, options);
            else await config.savePolicyField(entryId, key, after);
            ownerSave.succeeded = true;
            wrote.push(entryId);
            refresh = true;
          } catch (e) {
            // 실패한 주인·건드리지 않은 주인은 새 저장본을 영원히 기다리지 않는다.
            pendingSave.owners.delete(entryId);
            failed.push(entryId);
            if (!firstError) firstError = e instanceof Error ? e.message : "저장에 실패했습니다.";
          }
        }
        if (failed.length > 0) {
          throw new Error(
            `계약 ${failed.length}건의 차수를 저장하지 못했습니다${wrote.length > 0 ? ` (${wrote.length}건은 저장됨)` : ""}. ${firstError}`,
          );
        }
      } catch (e) {
        refresh = true;
        // 새 줄 저장 실패도 성공한 줄만 기다리는 기존 부분 성공 규칙을 따른다.
        for (const [ownerId, ownerSave] of pendingSave.owners) {
          if (!ownerSave.succeeded) pendingSave.owners.delete(ownerId);
        }
        if (pendingTierSaves.get(scope) === pendingSave) notifyTierSave({
          scope, save: pendingSave, reset: true,
          error: `${e instanceof Error ? e.message : "저장에 실패했습니다."} 저장된 값을 다시 불러옵니다. 확인한 뒤 다시 수정해 주세요.`,
        });
      } finally {
        try {
          // JSON·묶기·원격 저장 실패도 다시 읽는다. 복구 번호는 같은 문자열 응답에도 적용된다.
          // onSaved가 void로 재조회를 시작해도 성공한 주인은 실제 저장본이 확인될 때까지 잠근다.
          pendingSave.finished = true;
          // 응답을 받은 옛 마운트 대신 현재 구독자가 현재 rows와 대조하고 재조회한다.
          // 구독자가 없으면(패널이 닫힘) refreshPending 이 남아 같은 패널이 다시 열릴 때 전달된다.
          if (pendingTierSaves.get(scope) === pendingSave) {
            pendingSave.refreshPending = refresh;
            notifyTierSave({ scope, save: pendingSave, refresh });
          }
        } finally {
          // 이 저장이 쓰던 새 줄 id 는 마지막에 놓는다 — 위 알림이 모두 끝난 뒤에야 만들기 결과를 비울 수 있다.
          releaseOwner();
        }
      }
    }

    /** 합친 차수 id 에 박힌 주인 줄과 원래 차수 id. **자리(index)로 찾지 않는다** —
     *  차수를 지운 직후 자리가 밀려 엉뚱한 줄을 가리키던 문제(독립 리뷰 F6).
     *  파트너 정산 뱃지는 `entryId + 원래 tierId` 로 붙으므로 둘 다 되돌려 넘겨야 한다. */
    function ownerOfTier(mergedId: string): { entryId: string; tierId: string } {
      const ref = parseMergedTierId(mergedId);
      const owner = (ref && ownerIds[ref.ownerIndex]) || ownerIds[0] || entryId;
      return { entryId: owner, tierId: ref ? ref.originalId : mergedId };
    }

    /** 수수료 비율은 **그 차수가 실제로 속한 계약 줄** 기준으로 — 합치면서 대표 줄 비율이
     *  남의 줄 차수에 쓰이던 것을 막는다(독립 리뷰 F3, 돈 칸). */
    const rateRowForTier = (tier: Record<string, unknown>) => {
      const ref = parseMergedTierId(tier?.id);
      const owner = ref ? ownerIds[ref.ownerIndex] : undefined;
      const found = owner ? policyRows.find((r) => r.entryId === owner) : undefined;
      return found ? ({ ...evalBase, ...(found.row ?? {}) } as Record<string, unknown>) : null;
    };

    /** 계약·정산 컨테이너마다 따로 — 지금 받아 둔 줄 목록 기준으로 차수의 서버 수수료 대상을 고른다(표시 전용). 환불은 쓰지 않는다. */
    const feeTargetFor = (containerKey: "계약정보_차수" | "정산정보"): FeeTargetForTier => (tier) => (
      selectGovFeeTarget(policyRows, containerKey, tier)
    );

    const onSaveTiersFor = (key: string) => (canEditValues ? (json: string, editIntent?: TierFieldEditIntentV1) => { void saveMergedTiers(key, json, editIntent); } : () => {});
    const tierSavePropsFor = (key: string) => {
      const scope = tierSaveScopeFor(key);
      const state = tierSaveStates[scope];
      return {
        savedBasisVersion: JSON.stringify(policyRows.map((owner) => [owner.entryId, ownerTierSavedBasis(owner, key)])),
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
    const shownTierContainer = shownSubTab === "contract" ? "계약정보_차수"
      : shownSubTab === "settlement" ? "정산정보" : shownSubTab === "refund" ? "환불정보_차수" : null;
    const shownTierScope = shownTierContainer ? tierSaveScopeFor(shownTierContainer) : null;
    const shownTierSave = shownTierScope ? {
      ...tierSaveStates[shownTierScope], saving: pendingTierSaves.has(shownTierScope),
    } : undefined;
    // 끝난 저장의 실패 이유는 지금 보는 고객·컨테이너·소유자 순서와 정확히 같은 기록만 — 첫 저장이 만든 줄은 그 줄 하나만 보는 동안 같은 기록으로 읽힌다.
    const shownFailure = shownTierContainer ? tierSaveFailures.get(scopeForOwners(panelScope, ownerIds, shownTierContainer)) : undefined;
    // 저장은 끝났지만 저장된 값을 아직 확인하지 못한 채 상세창의 다시 읽기가 실패했다면 안내만 보인다. 잠금·실패 기록과 무관하고, 실제 저장값이 확인되어야만 잠금이 풀린다.
    const reloadFailedMessage = rowsLoadFailed && shownTierSave?.saving ? SAVED_RELOAD_FAILED_MESSAGE : undefined;
    const shownError = [err, shownTierSave?.error, shownFailure?.message, reloadFailedMessage].filter(Boolean).join(" ");
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
    const settlementCommon: Record<string, unknown> = {
      row: { ...evalBase, ...(data ?? {}) },
      isAdmin: canEditValues,
      readOnly: !canEditValues,
      allowStructureEdit: config.allowStructureEdit && isAdmin,
      columnScopeMode: config.allowStructureEdit ? "erp" : "off",
      // 반올림·내림 항 추가 단추 — 앱이 켤 때만. 안 켜면 단추가 안 뜬다(하이브·일루아).
      allowStepTerms: config.allowStepTerms === true,
      // 수동 수정은 값 편집 권한(canEditValues)이 아니라 실제 관리자에게만 — SettlementInfoTab 은 isAdmin prop 에
      // canEditValues 를 받으므로 여기서 실제 isAdmin 으로 한 번 더 좁힌다.
      allowFormulaOverride: config.allowFormulaOverride === true && isAdmin,
      ratioBaseKey: RATIO.baseKey,
      ratioFeeKey: RATIO.feeKey,
      ratioBaseLabel: RATIO.baseLabel,
      ratioFeeLabel: RATIO.feeLabel,
      configApiPath: config.configPath,
      defaultScoreCards: DEFAULT_SCORE_CARDS,
      seedDefaultCardsForAllPrefixes: true,
      addButtonSuffixOverride: "정산",
      enableConditionalFormula: config.enableConditionalFormula,
      conditionFieldOptions: condOpts,
      rateRowForTier,
    };

    return (
      <div className="flex flex-col">
        {shownError && (
          <div role="alert" className="mx-4 mt-3 rounded-xl border border-wedly-bd-red bg-wedly-bg-red px-3 py-2 text-[13px] text-wedly-red-ink">
            {shownError}
          </div>
        )}
        {shownTierSave?.saving && (
          <div role="status" className="mx-4 mt-2 text-[13px] text-wedly-muted">{SAVING_TIERS_MESSAGE}</div>
        )}

        {/* 계약 알약 줄(계약 1·2·3 + 추가)은 없앴다 — 사장님 지시 2026-09-17.
            한 회사의 계약 줄 여러 개를 알약으로 나눠 보여 주는 바람에, 표는 「계약 한 건 = 한 줄」로
            합쳐 보는데 상세창만 나뉘어 같은 회사의 담당 컨설턴트가 서로 다르게 보였다(이번 요청의 뿌리).
            이제 아래에서 차수·기록을 한 목록으로 합쳐 보여 준다. */}

        {/* 하위 탭 바 — 알약형 (히스토리 전용 모드에서는 탭 자체가 없다) */}
        {!historyOnly && !hideSubTabBar && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-wedly-bd/60 bg-wedly-bg-gray/50 px-4 py-2">
            {displaySubTabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  // 제어 모드여도 내부 상태를 같이 바꾼다 — 바깥이 값을 안 받아 줘도 이 패널이 멈추지 않게.
                  setSubTab(key);
                  if (typeof onSubTabChange === "function") onSubTabChange(key);
                }}
                className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  shownSubTab === key ? "bg-wedly-bg-blue text-wedly-accent-ink" : "text-wedly-t2 hover:bg-wedly-bg-gray hover:text-wedly-t2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1">
          {shownSubTab === "history" && (
            <div className="p-4">
              {historyGate === "panel" ? (
                <HistoryPanel
                  pageId={historyEntryId}
                  adapter={historyAdapter}
                  buildKakaoReport={
                    config.buildKakaoReport
                      ? async (c) => (await config.buildKakaoReport!(historyAdapter.ownerOf(String(c.id)), c.id)) ?? ""
                      : undefined
                  }
                  currentUserName={userName}
                  isAdmin={config.editable || canWriteHistory ? isAdmin : false}
                  ownSource={config.ownSource}
                  enableImagePaste={!config.commentsReadOnly}
                  readOnly={config.commentsReadOnly === true}
                  timeFormatter={timeAgo}
                  pollingIntervalMs={5000}
                  shareEnabled={false}
                  hideCategories
                  draftId={historyEntryId}
                  composerExtra={config.historyComposerExtra ? config.historyComposerExtra(historyEntryId) : undefined}
                  onSent={config.onHistorySent ? (text: string) => config.onHistorySent!(historyEntryId, text) : undefined}
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

          {shownSubTab === "contract" && (
            <div className="p-4">
              {config.renderSubTabHeader?.({ subTab: "contract", entryId })}
              <SettlementInfoTab key={tierSaveScopeFor("계약정보_차수")} {...settlementCommon} {...tierSavePropsFor("계약정보_차수")} rawValue={mergedTiers["계약정보_차수"] ?? null} onSave={onSaveTiersFor("계약정보_차수")} feeTargetForTier={feeTargetFor("계약정보_차수")} storagePrefix="contract" ensureFirstTier addButtonSuffixOverride="계약" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => { const o = ownerOfTier(tid); return config.renderTierBadge!({ entryId: o.entryId, kind: "contract", index: i, tierId: o.tierId, tierIdDuplicated: dup }); } : undefined} fieldsApiPath={config.contractFieldsPath} sectionTitle="계약정보" colorFamilies={config.colorFamilies} />
            </div>
          )}

          {shownSubTab === "settlement" && (
            <div className="p-4">
              {config.renderSubTabHeader?.({ subTab: "settlement", entryId })}
              <SettlementInfoTab key={tierSaveScopeFor("정산정보")} {...settlementCommon} {...tierSavePropsFor("정산정보")} rawValue={mergedTiers["정산정보"] ?? null} onSave={onSaveTiersFor("정산정보")} feeTargetForTier={feeTargetFor("정산정보")} storagePrefix="settlement" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => { const o = ownerOfTier(tid); return config.renderTierBadge!({ entryId: o.entryId, kind: "settlement", index: i, tierId: o.tierId, tierIdDuplicated: dup }); } : undefined} fieldsApiPath={config.settlementFieldsPath} sectionTitle="정산정보" colorFamilies={config.colorFamilies} />
            </div>
          )}

          {shownSubTab === "refund" && (
            <div className="p-4">
              {config.renderSubTabHeader?.({ subTab: "refund", entryId })}
              <SettlementInfoTab key={tierSaveScopeFor("환불정보_차수")} {...settlementCommon} {...tierSavePropsFor("환불정보_차수")} rawValue={mergedTiers["환불정보_차수"] ?? null} onSave={onSaveTiersFor("환불정보_차수")} storagePrefix="refund" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => { const o = ownerOfTier(tid); return config.renderTierBadge!({ entryId: o.entryId, kind: "refund", index: i, tierId: o.tierId, tierIdDuplicated: dup }); } : undefined} fieldsApiPath={config.refundFieldsPath} sectionTitle="환불정보" colorFamilies={config.colorFamilies} />
            </div>
          )}

          {shownSubTab === "meetings" && (
            <div className="p-4">
              {/* 미팅 부품은 앱이 주입한다 — 안 넣은 앱에서 그대로 그리면 상세창이 통째로 흰 화면이 된다.
                  NO.190 전에는 이 탭이 3분할에서 아예 안 열려 드러날 일이 없었다(적대적 리뷰 지적). */}
              {MeetingsTab ? (
                <MeetingsTab readOnly={!canEditValues} rawValue={data["_meetings"] ?? null} onSave={canEditValues ? (json: string) => saveOrCreate("_meetings", json) : () => {}} />
              ) : (
                <p className="text-[13px] text-wedly-muted">이 앱에서는 미팅정보를 볼 수 없습니다.</p>
              )}
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
