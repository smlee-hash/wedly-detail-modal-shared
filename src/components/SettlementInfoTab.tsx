"use client";

// 경정청구 정산정보 탭 — 정책자금(policy-fund/SettlementInfoTab.tsx) 와 동일한 UX/로직.
// 차이점: 자동 비율 계산에 사용하는 row 키를 경정청구 컬럼에 맞춰 매핑.
//   - 정책자금: 07계약금 / 13컨설턴트수수료 비율
//   - 경정청구: 10총환급금 / 20확정수수료 비율 (없으면 자동 OFF)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { tierFieldsEqual } from "./tier-fields-equal";
import { displayOrderNewestFirst } from "./tier-render-order";
import { roundTermIssue, chainKind, applyTermPatch } from "./round-term-rules";
import { createPortal } from "react-dom";
import {
  type FieldDef,
  type FieldType,
  type TierData,
  type ScoreCardDef,
  type ScoreCardColor,
  type FormulaTerm,
  type FormulaResultFormat,
  type ConditionalRule,
  type ConditionClause,
  type ConditionCombine,
  type ConditionCompare,
  type ConditionOp,
  type DateFormulaSpec,
  SCORECARD_COLOR_CLASSES,
  ORDINAL_KO,
  makeEmptyTier,
  makeScoreCardId,
  parseTiers,
  parseScoreCards,
  relabelTiers,
  generateFieldKey,
  parseFormulaTerms,
  evalFormulaForTier,
  evalDateFormulaForTier,
  parseDateFormula,
  formatFormulaResult,
  isNumericFieldType,
  isStepOp,
} from "@wedly/ui-shared";
import CustomSelect from "./CustomSelect";
import DateFormulaEditor from "./DateFormulaEditor";
import SelectDropdownBody from "./SelectDropdown";
import { buildCondTargets } from "./cond-targets-helpers";

type RowData = Record<string, string | number | boolean | null>;

// 조건 편집 초안 타입 — 규칙별 조건 절 목록(clauses) + 묶음(combine) + 식.
type DraftClause = { leftKey: string; right: ConditionCompare; op: ConditionOp };
type DraftCondRule = { clauses: DraftClause[]; combine: ConditionCombine; formula: FormulaTerm[] };
type DraftConditional = { rules: DraftCondRule[] };

// 저장된 conditional(새/옛 형식) → 편집 초안. 없으면 null.
// 새 형식(clauses) 우선, 옛 단일(leftKey/right/op·conditionFieldKey/whenValue)은 절 1개로 흡수.
function loadConditionalDraft(cond: FieldDef["conditional"]): DraftConditional | null {
  if (!cond || !Array.isArray(cond.rules) || cond.rules.length === 0) return null;
  const rules: DraftCondRule[] = cond.rules.map((r) => {
    const clauses: DraftClause[] = Array.isArray(r.clauses) && r.clauses.length > 0
      ? r.clauses.map((c) => ({
          leftKey: c.leftKey ?? "",
          right: c.right ?? ({ kind: "text" as const, value: "" }),
          op: (c.op ?? "eq") as ConditionOp,
        }))
      : [{
          leftKey: r.leftKey ?? cond.conditionFieldKey ?? "",
          right: r.right ?? ({ kind: "text" as const, value: r.whenValue ?? "" }),
          op: (r.op ?? "eq") as ConditionOp,
        }];
    return { clauses, combine: (r.combine ?? "and") as ConditionCombine, formula: parseFormulaTerms(r.formula) };
  });
  return { rules };
}

// 설정(config) 모듈 레벨 캐시 + 탭 다시 보기 자동 갱신.
// configApiPath 는 앱마다 다름(하이브 /api/hive-config, 일루아 /api/illua-config, ERP 는 분야마다 다름) — prop 으로 주입.
// ⚠️ 캐시는 반드시 configApiPath(분야) 별로 따로 보관한다.
//    ERP 처럼 한 화면에서(새로고침 없이 분야 이동) 서로 다른 경로를 쓰는 앱은, 캐시를 하나로만 두면
//    먼저 연 분야의 설정이 나중에 연 다른 분야에 잘못 적용된다(합계 카드 기준 칸이 뒤바뀜).
const _configPromiseByPath = new Map<string, Promise<unknown>>();
function fetchConfigCached(configApiPath: string, forceRefresh = false): Promise<unknown> {
  if (forceRefresh || !_configPromiseByPath.has(configApiPath)) {
    _configPromiseByPath.set(
      configApiPath,
      fetch(configApiPath).then((r) => r.json()).catch(() => null),
    );
  }
  return _configPromiseByPath.get(configApiPath)!;
}

function fmtCurrency(n: number | null): string {
  if (n === null || !isFinite(n)) return "";
  // 돈 표시는 정수로 반올림(소수점 제거) — 스코어카드 합계·돈 칸 가독성. 퍼센트는 별도 경로라 영향 없음.
  return Math.round(n).toLocaleString("ko-KR");
}

// 계약정보 기준 비율 — 경정청구 도메인에서는 (10총환급금 : 20확정수수료) 비율의 반대를 적용.
// 정책자금에서 (07계약금 : 13컨설턴트수수료) 와 동일한 의미.
type RateInfo = {
  ok: boolean;
  rate: number | null;
  ratio: number | null;
  baseAmt: number;
  feeAmt: number;
  rawBase: unknown;
  rawFee: unknown;
  reason: string;
};

function toNum(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).replace(/[^\d.\-]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function getReversedFeeRate(
  row: RowData | null,
  baseKey: string,
  feeKey: string,
  baseLabel: string,
  feeLabel: string,
): RateInfo {
  const rawBase = row?.[baseKey] ?? null;
  const rawFee = row?.[feeKey] ?? null;
  const baseAmt = toNum(rawBase);
  const feeAmt = toNum(rawFee);
  const base = { baseAmt, feeAmt, rawBase, rawFee };
  if (!row) return { ok: false, rate: null, ratio: null, ...base, reason: "row 없음" };
  if (!baseAmt || baseAmt <= 0) return { ok: false, rate: null, ratio: null, ...base, reason: `계약정보의 '${baseLabel}' 값이 비어있거나 0입니다` };
  if (!feeAmt || feeAmt <= 0) return { ok: false, rate: null, ratio: null, ...base, reason: `계약정보의 '${feeLabel}' 값이 비어있거나 0입니다` };
  const ratio = feeAmt / baseAmt;
  if (!isFinite(ratio)) return { ok: false, rate: null, ratio: null, ...base, reason: "비율 계산 오류" };
  if (ratio >= 1) return { ok: false, rate: null, ratio: null, ...base, reason: `${feeLabel}가 ${baseLabel}보다 크거나 같습니다` };
  return { ok: true, rate: 1 - ratio, ratio, ...base, reason: "" };
}

export default function SettlementInfoTab({
  rawValue,
  row,
  onSave,
  readOnly = false,
  isAdmin = false,
  // 합계 스코어카드(전체 합계) 블록을 통째로 숨김 — 작은 임베드 카드(통합협업 정책 섹션)용. 기본 false=기존 동작.
  hideSummaryCards = false,
  // 차수 카드/컬럼 "구조 편집"(전체 합계 카드의 '편집' 버튼) 허용 여부 — 기본 false.
  //   본부(ERP)만 true 로 켠다. 파트너 앱(하이브·일루아)은 값 입력만 하고, 구조는 ERP 에서만 바꾼다.
  //   기본이 false 라서 파트너 앱이 실수로 isAdmin=true 를 넘겨도 구조 편집 버튼은 안 나온다(안전장치).
  allowStructureEdit = false,
  // 칸(컬럼) 목록 편집만 허용 — 세부섹션/차수접미사(allowStructureEdit)와 분리. 미지정 시 allowStructureEdit 폴백.
  allowColumnEdit,
  // 칸 범위 모드: off(현행·토글없음) | erp(공통/커스텀 선택) | partner-custom(커스텀고정·공통잠금)
  columnScopeMode = "off",
  // 이 차수 칸을 도메인 "표"에 차수별 줄로 노출하는 "표 노출" 토글 버튼 허용 여부 — 기본 false.
  //   실제 표 렌더가 구현된 도메인(1단계=경정청구)에서만 true 로 켠다. 다른 도메인은 버튼 자체가 안 뜬다.
  allowTableExpose = false,
  // ── 영역 분리 prop (A-1 모듈화) ──
  // 정산정보 외 계약·환불 같은 다른 영역에서도 같은 차수 카드 부품 재사용 가능
  // 기본값은 정산 — 기존 호출 호환
  storagePrefix = "settlement",        // hive-config 키 prefix (settlement / contract / refund)
  fieldsApiPath = "/api/entries/settlement-fields", // 컬럼 정의 받는 쪽
  sectionTitle = "정산정보",            // 화면 표시 제목 (사용 안 함 — 섹션 헤더는 부모에서)
  // ── 세부 섹션 (단계 A) ──
  // 같은 영역 안에서 경정청구·정부지원금·인증제도 등 영역별로 차수 묶음을 나눌 수 있게.
  // 단계 A1 : prop 만 수신·통로 확보. UI 변경은 단계 A2 에서.
  subSections,
  onUpdateSubSections,
  // ── 도메인 차이 주입 (④-c 정산탭 공용화) ──
  // 앱마다 다른 값만 prop 으로 받음. 계산 로직 자체는 공용(동일).
  ratioBaseKey,
  ratioFeeKey,
  ratioBaseLabel,
  ratioFeeLabel,
  configApiPath,
  defaultScoreCards,
  seedDefaultCardsForAllPrefixes = false,
  addButtonSuffixOverride,
  conditionFieldOptions,
  enableConditionalFormula,
  renderTierBadge,
}: {
  rawValue: unknown;
  row?: RowData | null;
  onSave: (jsonValue: string) => void;
  readOnly?: boolean;
  isAdmin?: boolean;
  // 합계 스코어카드 블록 숨김(임베드용).
  hideSummaryCards?: boolean;
  // 구조(차수 카드·컬럼) 편집 허용 — 본부(ERP) 전용. 미지정 시 false (파트너 앱 = 값 입력만).
  allowStructureEdit?: boolean;
  // 칸 목록 편집 게이트(세부섹션·차수접미사와 분리). 미지정 시 allowStructureEdit 폴백.
  allowColumnEdit?: boolean;
  // 칸 범위 모드(공통/커스텀). 기본 off = 현행 동작.
  columnScopeMode?: "off" | "erp" | "partner-custom";
  // "표 노출" 토글 버튼 허용(표 렌더 구현 도메인 전용). 기본 false = 버튼 숨김.
  allowTableExpose?: boolean;
  storagePrefix?: string;
  fieldsApiPath?: string;
  sectionTitle?: string;
  subSections?: Array<{ id: string; label: string }>;
  onUpdateSubSections?: (list: Array<{ id: string; label: string }>) => void;
  // 자동 비율 계산에 쓰는 계약정보 row 키 (하이브 "10총환급금"/"20확정수수료", 일루아 "07계약금"/"13컨설턴트수수료")
  ratioBaseKey: string;
  ratioFeeKey: string;
  // 비율 오류 안내문에 쓰는 사람용 라벨 (하이브 "총환급금"/"확정수수료", 일루아 "계약금"/"컨설턴트수수료")
  ratioBaseLabel: string;
  ratioFeeLabel: string;
  // 설정 저장/조회 API 경로 (하이브 "/api/hive-config", 일루아 "/api/illua-config")
  configApiPath: string;
  // 합계카드 기본값 (도메인별로 다름)
  defaultScoreCards: ScoreCardDef[];
  // 정산 외 prefix(계약/환불)에서도 기본 합계카드를 시드할지 (하이브 옛 동작 보존=true, 일루아=false)
  seedDefaultCardsForAllPrefixes?: boolean;
  // 차수추가 버튼 꼬리표 고정값 (하이브 "정산" 고정, 일루아 미지정→tierSuffix 사용)
  addButtonSuffixOverride?: string;
  // 조건별 수식의 "기준 필드" 후보 (기본정보 평면 필드). ERP만 주입 → 주입될 때만 조건 UI 노출.
  //   미주입(파트너 앱)이면 조건 UI 자체가 안 보이고 기존과 100% 동일.
  conditionFieldOptions?: Array<{
    key: string;
    label: string;
    /** 이 칸에 설정된 선택지 목록(+색). 있으면 "직접 입력" 자리를 드롭다운으로. 없으면 자유 입력. */
    options?: Array<{ value: string; badgeClass?: string }>;
  }>;
  /** 조건별 수식 UI 표시 게이트 — ERP만 true. (기본정보 후보가 비어도 정산 칸만으로 조건 작성 가능하게 분리) */
  enableConditionalFormula?: boolean;
  /**
   * 차수 카드 제목 옆에 그릴 것(선택). index 는 0부터 세는 차수 번호.
   * 미주입이면 지금과 100% 동일 — 주입하는 앱에서만 보인다(ERP 파트너 정산 뱃지용).
   */
  renderTierBadge?: (index: number, tierId: string, tierIdDuplicated?: boolean) => ReactNode;
}) {
  // 단계 A2 + B (구조 개선) — 세부 섹션을 탭 형태로 표시.
  //   subSections 가 비어 있으면 옛 동작 그대로 (탭 줄 안 보임)
  //   1개 이상이면 "통합" + 각 세부 섹션 탭 줄. 활성 탭만 본문 노출.
  // 세부 섹션(선택 줄) 미사용 — 항상 빈 배열로 두어 selector·영역별 합계·분기 블록을 전부 숨긴다(통합 표시).
  const subSectionsSafe = useMemo<Array<{ id: string; label: string }>>(() => [], [subSections]);
  // 활성 탭 — "__all" 은 통합 탭, 그 외는 세부 섹션 id.
  const [activeSubSectionId, setActiveSubSectionId] = useState<string>("__all");
  // 활성 탭이 옛 세부 섹션을 가리키는 상태가 안 되도록 — subSections 변경 시 가드.
  useEffect(() => {
    if (activeSubSectionId === "__all") return;
    if (subSectionsSafe.some((s) => s.id === activeSubSectionId)) return;
    setActiveSubSectionId("__all");
  }, [subSectionsSafe, activeSubSectionId]);
  // 어드민이 "+ 세부 섹션 추가" 클릭 시 라벨 입력 모달.
  const [subSectionAddOpen, setSubSectionAddOpen] = useState(false);
  const [subSectionDraftLabel, setSubSectionDraftLabel] = useState("");
  // 단계 B — 어드민 편집 (이름 수정·삭제·이동).
  //   "세부 섹션 편집" 버튼으로 편집 모드 ON → 활성 탭에 ⋮ 등장.
  //   ⋮ 누르면 탭 줄 아래 인라인 편집 바 펼침 (가로 스크롤 박스에 안 잘림).
  const [editSubMode, setEditSubMode] = useState(false);
  const [editMenuOpenForId, setEditMenuOpenForId] = useState<string | null>(null);
  // 이름 수정 모달 (편집 메뉴 → "이름 수정" 선택 시 열림).
  const [subSectionRename, setSubSectionRename] = useState<{ id: string; label: string } | null>(null);
  // 삭제 확인 모달.
  const [subSectionDeleteConfirm, setSubSectionDeleteConfirm] = useState<{ id: string; label: string } | null>(null);
  // 식별값 생성 — 추가·복원 두 곳에서 같은 형식 보장.
  const makeSubSectionId = useCallback(() => `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, []);
  const commitSubSectionAdd = useCallback(() => {
    if (!onUpdateSubSections) return;
    const label = subSectionDraftLabel.trim();
    if (!label) return;
    onUpdateSubSections([...subSectionsSafe, { id: makeSubSectionId(), label }]);
    setSubSectionAddOpen(false);
  }, [onUpdateSubSections, subSectionDraftLabel, subSectionsSafe, makeSubSectionId]);
  // 어드민 — 세부 섹션 이름 갱신
  const commitSubSectionRename = useCallback(() => {
    if (!subSectionRename || !onUpdateSubSections) return;
    const label = subSectionRename.label.trim();
    if (!label) return;
    const next = subSectionsSafe.map((s) => s.id === subSectionRename.id ? { ...s, label } : s);
    onUpdateSubSections(next);
    setSubSectionRename(null);
  }, [subSectionRename, onUpdateSubSections, subSectionsSafe]);
  // 어드민 — 세부 섹션 좌/우 이동 (탭 줄 안에서 순서 변경)
  const moveSubSection = useCallback((id: string, dir: -1 | 1) => {
    if (!onUpdateSubSections) return;
    const idx = subSectionsSafe.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= subSectionsSafe.length) return;
    const next = [...subSectionsSafe];
    [next[idx], next[target]] = [next[target], next[idx]];
    onUpdateSubSections(next);
  }, [onUpdateSubSections, subSectionsSafe]);
  // persist 가 아래에서 정의되므로 ref 로 우회 — 호출 시점엔 항상 최신 함수 참조.
  const persistRef = useRef<((next: TierData[]) => void) | null>(null);
  // 어드민 — 세부 섹션 삭제. 그 영역에 속한 차수는 첫 번째 영역으로 자동 이동(데이터 보호).
  const commitSubSectionDelete = useCallback(() => {
    if (!subSectionDeleteConfirm || !onUpdateSubSections) return;
    const deletingId = subSectionDeleteConfirm.id;
    const remaining = subSectionsSafe.filter((s) => s.id !== deletingId);
    setTiers((prev) => {
      const moved = prev.map((t) => {
        if (t._subSectionId === deletingId) {
          const copy = { ...t };
          delete copy._subSectionId;
          return copy;
        }
        return t;
      });
      persistRef.current?.(moved);
      return moved;
    });
    onUpdateSubSections(remaining);
    setSubSectionDeleteConfirm(null);
  }, [subSectionDeleteConfirm, onUpdateSubSections, subSectionsSafe]);
  // 편집 모드를 끄면 펼쳐둔 인라인 편집 바도 함께 닫는다.
  useEffect(() => {
    if (!editSubMode) setEditMenuOpenForId(null);
  }, [editSubMode]);
  // 다른 탭으로 옮기면 편집 바도 닫는다 — ⋮ 는 활성 탭에만 있으므로 일관성 유지.
  useEffect(() => { setEditMenuOpenForId(null); }, [activeSubSectionId]);
  // Escape 키로 편집 바 닫기 — 키보드 사용자 편의.
  useEffect(() => {
    if (!editMenuOpenForId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditMenuOpenForId(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editMenuOpenForId]);
  // 자체 위들리 알림 모달 (브라우저 기본 alert 금지) — 앱 내부 useWedlyDialog 의존 제거
  const [noticeMsg, setNoticeMsg] = useState<{ title: string; body: string } | null>(null);
  const showNotice = useCallback((body: string, title: string) => setNoticeMsg({ body, title }), []);
  // hive-config 키들 — prefix 별로 분리 저장
  const cardsKey = `${storagePrefix}Cards`;   // settlement → settlementCards, contract → contractCards
  const sectionTitleSafe = sectionTitle; // 변수 placeholder — 추후 헤더 표시에 활용 가능
  void sectionTitleSafe;
  // 구조 편집(전체 합계 카드 '편집' 버튼)은 본부(ERP)에서만 — allowStructureEdit 가 명시적으로 켜져야 한다.
  // (기본 꺼짐 → 파트너 앱은 isAdmin 이 참이어도 값 입력만 가능.)
  const canEditColumns = !readOnly && isAdmin && (allowColumnEdit ?? allowStructureEdit);
  // 세부섹션·차수접미사 등 "무거운 구조" 편집 — 본부(ERP)만(allowStructureEdit).
  const canEditStructure = !readOnly && isAdmin && allowStructureEdit;
  // ⚠️ 마운트 시 초기값을 빈 배열로 — 서버 fetch 응답 전까지 옛 기본 컬럼이 잠깐 보이는
  // 깜빡임 방지. 서버 응답이 진실의 원천.
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [tiers, setTiers] = useState<TierData[]>(() => parseTiers(rawValue, []));
  const [fieldsLoaded, setFieldsLoaded] = useState(false);
  // ERP 가 설정한 스코어카드 제목 + 합산 소스 컬럼을 미러 (편집은 ERP 에서만)
  const [cardLabels, setCardLabels] = useState({
    refund: "총 환급금", success: "성공보수 총액", fee: "컨설턴트 수수료 총액", revenue: "매출",
  });
  const [cardSources, setCardSources] = useState<{ refund?: string; success?: string; fee?: string; revenue?: string }>({});
  // 차수 카드 공통 꼬리표 — 어드민이 한 번 수정하면 모든 차수에 적용
  // 예: tierSuffix = "정산" → "1차 정산", "2차 정산", "3차 정산"
  // 저장 위치: hive-config 의 `${storagePrefix}TierSuffix` (settlement / contract / refund 별로 분리)
  const [tierSuffix, setTierSuffix] = useState<string>(() => {
    if (storagePrefix === "contract") return "계약";
    if (storagePrefix === "refund") return "환불";
    return "정산";
  });
  const tierSuffixKey = `${storagePrefix}TierSuffix`;
  // 차수 카드 칸 배치 — 줄마다 가로 칸 수(1·2·3)를 따로 정한다. 관리자가 줄별로 선택, 분야별로 분리 저장.
  // 예: [3,2,1] = 첫 줄 3칸, 둘째 줄 2칸, 셋째 줄 1칸. 칸은 위에서부터 순서대로 채우고, 남는 칸은 한 줄 1칸씩.
  const rowLayoutKey = `${storagePrefix}RowLayout`;
  const [rowLayout, setRowLayout] = useState<number[]>([]);
  // 스코어카드 정의 — 하이브 자체 저장이 있으면 그걸 우선, 없으면 ERP 값/기본값 fallback
  const [scoreCards, setScoreCards] = useState<ScoreCardDef[]>(
    (storagePrefix === "settlement" || seedDefaultCardsForAllPrefixes) ? defaultScoreCards : []
  );
  const [editCards, setEditCards] = useState(false);
  useEffect(() => {
    const apply = (raw: unknown) => {
      const j = raw as { data?: Record<string, unknown> } | null;
      // 1) hive-config 의 cardsKey (settlementCards / contractCards / refundCards) 가 있으면 최우선
      const localCards = j?.data?.[cardsKey];
      const erpL = j?.data?.erpSettlementCardLabels as Record<string, unknown> | undefined;
      // 차수 카드 공통 꼬리표 — 저장된 값 있으면 적용
      const savedSuffix = j?.data?.[tierSuffixKey];
      if (typeof savedSuffix === "string" && savedSuffix.trim()) {
        setTierSuffix(savedSuffix.trim());
      }
      // 칸 배치 — 줄별 칸 수 배열(rowLayout) 저장값이 있으면 적용(각 항목을 1·2·3 으로 보정)
      const savedRL = j?.data?.[rowLayoutKey];
      if (Array.isArray(savedRL)) {
        setRowLayout(
          savedRL
            .filter((n) => typeof n === "number")
            .map((n) => (n === 3 ? 3 : n === 2 ? 2 : 1)),
        );
      }
      const parsed = parseScoreCards(localCards);
      const l = erpL;
      if (parsed && parsed.length > 0) {
        setScoreCards(parsed);
      } else if (l && typeof l === "object") {
        // settlementCards 가 없으면 ERP cardLabels 를 DEFAULT_SCORECARDS 의 label 에 마이그레이션
        setScoreCards((prev) => prev.map((c) => {
          const labelFromErp = (l as Record<string, unknown>)[c.id];
          if (typeof labelFromErp === "string" && labelFromErp.trim()) {
            return { ...c, label: labelFromErp };
          }
          return c;
        }));
      }
      if (l && typeof l === "object") {
        setCardLabels((prev) => ({
          refund: typeof l.refund === "string" && (l.refund as string).trim() ? (l.refund as string) : prev.refund,
          success: typeof l.success === "string" && (l.success as string).trim() ? (l.success as string) : prev.success,
          fee: typeof l.fee === "string" && (l.fee as string).trim() ? (l.fee as string) : prev.fee,
          revenue: typeof l.revenue === "string" && (l.revenue as string).trim() ? (l.revenue as string) : prev.revenue,
        }));
      }
      const s = j?.data?.erpSettlementCardSources;
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        setCardSources({
          refund: typeof o.refund === "string" ? o.refund : undefined,
          success: typeof o.success === "string" ? o.success : undefined,
          fee: typeof o.fee === "string" ? o.fee : undefined,
          revenue: typeof o.revenue === "string" ? o.revenue : undefined,
        });
      }
    };

    fetchConfigCached(configApiPath).then(apply).catch(() => { /* 기본값 유지 */ });

    // 1분마다 자동 새로고침 — ERP 관리자가 바꾼 값을 사용자가 새로고침 없이 받아봄
    const interval = setInterval(() => {
      fetchConfigCached(configApiPath, true).then(apply).catch(() => {});
    }, 60000);

    // 탭을 다시 보거나 창에 포커스 올 때 즉시 새로고침
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchConfigCached(configApiPath, true).then(apply).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [configApiPath]);
  const [editFields, setEditFields] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  // 자동 갱신 effect 가 항상 최신 편집/저장 상태를 보도록 ref 동기(effect 의존성에서 분리).
  const editFieldsRef = useRef(editFields);
  const savingFieldsRef = useRef(savingFields);
  useEffect(() => { editFieldsRef.current = editFields; }, [editFields]);
  useEffect(() => { savingFieldsRef.current = savingFields; }, [savingFields]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const rateInfo = useMemo(
    () => getReversedFeeRate(row || null, ratioBaseKey, ratioFeeKey, ratioBaseLabel, ratioFeeLabel),
    [row, ratioBaseKey, ratioFeeKey, ratioBaseLabel, ratioFeeLabel]
  );
  const reversedRate = rateInfo.ok ? rateInfo.rate : null;

  const successField = useMemo(() => {
    return fields.find((f) =>
      f.type === "number" &&
      (f.key === "성공보수총액" || /성공\s*보수/.test(f.label) || /성공\s*보수/.test(f.key))
    );
  }, [fields]);

  const consultFeeField = useMemo(() => {
    return fields.find((f) =>
      f.type === "number" &&
      (f.key === "컨설턴트수수료" || ((/컨설턴트/.test(f.label) && /수수료/.test(f.label)) && !/매출/.test(f.label)) || ((/컨설턴트/.test(f.key) && /수수료/.test(f.key)) && !/매출/.test(f.key)))
    );
  }, [fields]);

  const revenueVatField = useMemo(() => {
    return fields.find((f) =>
      f.type === "number" &&
      (f.key === "매출VAT포함" || /매출.*포함|매출.*VAT.*포함/i.test(f.label) || /매출.*포함/.test(f.key))
    );
  }, [fields]);

  const revenueNetField = useMemo(() => {
    return fields.find((f) =>
      f.type === "number" &&
      (f.key === "매출VAT제외" || /매출.*제외|매출.*별도|매출.*VAT.*제외/i.test(f.label) || /매출.*제외/.test(f.key))
    );
  }, [fields]);

  // Hive 전용 — WEDLY 자체 매출 컬럼은 파트너인 Hive 화면에 노출하지 않음
  const REVENUE_KEYS_TO_HIDE = ["매출VAT포함", "매출VAT제외"];
  const isHiddenRevenueField = (f: FieldDef) =>
    REVENUE_KEYS_TO_HIDE.includes(f.key) ||
    /WEDLY\s*매출/i.test(f.label) ||
    /매출.*VAT/.test(f.label);

  // 칸 목록 자동 갱신 — config(합계카드 설정)와 동일하게 최초 1회 + 1분 간격 + 앱 복귀(visibilitychange/focus) 시 재요청.
  // PWA 처럼 화면이 오래 떠 있어도 관리자가 바꾼 칸이 자동 반영되게 함.
  // 표(tiers)는 아래 useEffect([rawValue, fields])가 재계산하므로 여기선 setFields 만 한다.
  useEffect(() => {
    let cancelled = false;
    const loadFields = (isInitial: boolean) => {
      // 칸 편집/저장 중엔 자동 갱신 건너뜀(작업 덮어쓰기 방지). 단 최초 1회는 항상 로드.
      if (!isInitial && (editFieldsRef.current || savingFieldsRef.current)) return;
      fetch(fieldsApiPath, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          if (j.success && Array.isArray(j.data)) {
            // 서버 값을 그대로 신뢰. Hive 화면에서는 WEDLY 매출 컬럼만 시각적으로 제외.
            const visible = (j.data as FieldDef[]).filter((f) => !isHiddenRevenueField(f));
            // 바뀐 게 없으면 setState 생략 — 불필요한 재렌더/입력 흔들림 방지.
            setFields((prev) =>
              tierFieldsEqual(
                prev as unknown as Record<string, unknown>[],
                visible as unknown as Record<string, unknown>[],
              )
                ? prev
                : visible,
            );
          }
        })
        .catch(() => { /* 유지 */ })
        .finally(() => { if (isInitial && !cancelled) setFieldsLoaded(true); });
    };
    loadFields(true);
    const interval = setInterval(() => loadFields(false), 60000);
    const onVisible = () => { if (document.visibilityState === "visible") loadFields(false); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsApiPath]);

  useEffect(() => {
    setTiers(parseTiers(rawValue, fields));
  }, [rawValue, fields]);

  const persist = useCallback((next: TierData[]) => {
    onSave(JSON.stringify(next));
  }, [onSave]);
  // persistRef 동기 — 위에서 정의된 commitSubSectionDelete 가 호이스팅 없이 참조할 수 있게.
  useEffect(() => { persistRef.current = persist; }, [persist]);

  const persistFields = useCallback(async (next: FieldDef[]) => {
    setSavingFields(true);
    try {
      const res = await fetch(fieldsApiPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const reason = json?.error || `HTTP ${res.status}`;
        console.warn("[persistFields] failed:", reason);
        showNotice(`컬럼 편집 저장 실패: ${reason}. 새로고침 후 다시 시도해주세요.`, "저장 실패");
      }
    } catch (err) {
      console.warn("[persistFields]", err);
      showNotice("컬럼 편집 저장 중 연결 오류가 발생했습니다.", "연결 오류");
    } finally {
      setSavingFields(false);
    }
  // dialog 는 안정된 클로저 — 의존성에 안 넣어도 OK
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!successField || !consultFeeField) return;
    let changed = false;
    const next = tiers.map((t) => {
      const success = t[successField.key];
      const successNum = typeof success === "number" ? success : Number(success);
      if (!isFinite(successNum) || successNum <= 0) return t;

      let fee = t[consultFeeField.key];
      const updated: TierData = { ...t };

      if (reversedRate !== null && (fee === null || fee === undefined || fee === "")) {
        fee = Math.round(successNum * reversedRate);
        updated[consultFeeField.key] = fee;
        changed = true;
      }

      const feeNum = typeof fee === "number" ? fee : Number(fee || 0);
      if (revenueVatField) {
        const cur = updated[revenueVatField.key];
        if (cur === null || cur === undefined || cur === "") {
          updated[revenueVatField.key] = Math.round(successNum - (isFinite(feeNum) ? feeNum : 0));
          changed = true;
        }
      }

      if (revenueNetField) {
        const cur = updated[revenueNetField.key];
        if (cur === null || cur === undefined || cur === "") {
          const vat = typeof updated[revenueVatField?.key || ""] === "number"
            ? (updated[revenueVatField!.key] as number)
            : Math.round(successNum - (isFinite(feeNum) ? feeNum : 0));
          updated[revenueNetField.key] = Math.round(vat / 1.1);
          changed = true;
        }
      }

      return updated;
    });
    if (changed) {
      setTiers(next);
      persist(next);
    }
  }, [successField, consultFeeField, revenueVatField, revenueNetField, reversedRate, tiers, persist]);

  const updateField = useCallback((idx: number, key: string, value: string | number | null) => {
    setTiers((prev) => {
      const next = prev.map((t, i) => i === idx ? { ...t, [key]: value } : t);
      if (successField && key === successField.key) {
        const m = typeof value === "number" ? value : (value === "" || value === null ? null : Number(value));
        const updated: TierData = { ...next[idx], [successField.key]: m };

        let feeNum: number | null = null;
        if (consultFeeField && reversedRate !== null) {
          feeNum = m === null ? null : Math.round(m * reversedRate);
          updated[consultFeeField.key] = feeNum;
        } else if (consultFeeField) {
          const cur = updated[consultFeeField.key];
          feeNum = typeof cur === "number" ? cur : Number(cur || 0);
        }

        if (revenueVatField) {
          updated[revenueVatField.key] = m === null ? null : Math.round(m - (feeNum || 0));
        }

        if (revenueNetField) {
          const vat = revenueVatField && typeof updated[revenueVatField.key] === "number"
            ? (updated[revenueVatField.key] as number)
            : (m === null ? null : Math.round(m - (feeNum || 0)));
          updated[revenueNetField.key] = vat === null ? null : Math.round(vat / 1.1);
        }

        next[idx] = updated;
      }

      if (consultFeeField && key === consultFeeField.key && successField) {
        const successVal = next[idx][successField.key];
        const successNum = typeof successVal === "number" ? successVal : Number(successVal || 0);
        const feeVal = typeof value === "number" ? value : Number(value || 0);
        if (isFinite(successNum) && successNum > 0) {
          if (revenueVatField) next[idx][revenueVatField.key] = Math.round(successNum - (isFinite(feeVal) ? feeVal : 0));
          if (revenueNetField) {
            const vat = revenueVatField && typeof next[idx][revenueVatField.key] === "number"
              ? (next[idx][revenueVatField.key] as number)
              : Math.round(successNum - (isFinite(feeVal) ? feeVal : 0));
            next[idx][revenueNetField.key] = Math.round(vat / 1.1);
          }
        }
      }

      persist(next);
      return next;
    });
  }, [persist, successField, consultFeeField, revenueVatField, revenueNetField, reversedRate]);

  const updateTierLabel = useCallback((idx: number, newLabel: string) => {
    setTiers((prev) => {
      const next = prev.map((t, i) => i === idx ? { ...t, label: newLabel } : t);
      persist(next);
      return next;
    });
  }, [persist]);

  // 세부 섹션 인식 차수 추가 — subSectionId 가 주어지면 그 묶음에 배정, 없으면 옛 동작.
  const addTier = useCallback((subSectionId?: string) => {
    setTiers((prev) => {
      // 같은 세부 섹션 안의 차수 개수로 라벨(1차/2차…) 결정.
      const sameGroupCount = subSectionId
        ? prev.filter((t) => t._subSectionId === subSectionId).length
        : prev.length;
      const newTier: TierData = makeEmptyTier(sameGroupCount, fields);
      if (subSectionId) newTier._subSectionId = subSectionId;
      const next = [...prev, newTier];
      persist(next);
      return next;
    });
  }, [persist, fields]);

  const removeTier = useCallback((idx: number) => {
    setTiers((prev) => {
      const next = relabelTiers(prev.filter((_, i) => i !== idx));
      persist(next);
      return next;
    });
  }, [persist]);

  // 정산 컬럼 편집 — prompt 대신 위들리 디자인 모달
  const [fieldEditModal, setFieldEditModal] = useState<
    | { mode: "add" }
    | { mode: "rename"; key: string; label: string }
    | { mode: "changeType"; key: string; type: FieldType }
    | null
  >(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<FieldType>("text");
  // 새 칸 범위(공통/커스텀) — erp 모드 추가창에서만 사용.
  const [draftScope, setDraftScope] = useState<"common" | "custom">("common");
  // 수식 컬럼 편집용 — 항(term)들과 결과 표시 형식, 검증 오류 메시지
  const [draftFormula, setDraftFormula] = useState<FormulaTerm[]>([]);
  const [draftFormulaResult, setDraftFormulaResult] = useState<FormulaResultFormat>("number");
  const [draftDateFormula, setDraftDateFormula] = useState<DateFormulaSpec>({ mode: "offset", baseKey: "", offsets: [{ amount: 1, unit: "day" }] });
  const [draftOptions, setDraftOptions] = useState<string[]>([]); // type==="select" 보기 목록 초안
  const [formulaError, setFormulaError] = useState<string>("");
  // 조건별 수식 편집 상태. null = 조건 안 씀(기본 식만). 객체면 "값에 따라 다른 식" 켠 상태.
  //   rules: 규칙별 기준 칸(leftKey) + 비교 대상(right: 글자/다른 칸) + 식.
  const [draftConditional, setDraftConditional] = useState<DraftConditional | null>(null);

  const openAddField = useCallback(() => {
    setDraftLabel("");
    setDraftType("text");
    setDraftFormula([]);
    setDraftFormulaResult("number");
    setDraftDateFormula({ mode: "offset", baseKey: "", offsets: [{ amount: 1, unit: "day" }] });
    setDraftOptions([]);
    setFormulaError("");
    setDraftConditional(null);
    setDraftScope("common");
    setFieldEditModal({ mode: "add" });
  }, []);
  const openRenameField = useCallback((key: string) => {
    const cur = fields.find((f) => f.key === key);
    if (!cur) return;
    setDraftLabel(cur.label);
    setFieldEditModal({ mode: "rename", key, label: cur.label });
  }, [fields]);
  const openChangeType = useCallback((key: string) => {
    const cur = fields.find((f) => f.key === key);
    if (!cur) return;
    setDraftType(cur.type);
    setDraftFormula(cur.type === "formula" ? parseFormulaTerms(cur.formula) : []);
    setDraftFormulaResult(cur.formulaResult === "percent" ? "percent" : cur.formulaResult === "date" ? "date" : "number");
    setDraftDateFormula(parseDateFormula(cur.dateFormula) ?? { mode: "offset", baseKey: "", offsets: [{ amount: 1, unit: "day" }] });
    setDraftOptions(cur.type === "select" && Array.isArray(cur.options) ? [...cur.options] : []);
    setFormulaError("");
    setDraftConditional(loadConditionalDraft(cur.conditional));
    setFieldEditModal({ mode: "changeType", key, type: cur.type });
  }, [fields]);

  const addFieldDef = openAddField;
  const renameFieldDef = openRenameField;

  const changeFieldType = openChangeType;

  // 수식 검증 — 항이 1개 이상이고, 컬럼 항은 계산 가능한(숫자·퍼센트·수식) 컬럼을 가리켜야 함.
  const validateDraftFormula = useCallback((): { ok: true; terms: FormulaTerm[] } | { ok: false; msg: string } => {
    const terms = parseFormulaTerms(draftFormula);
    if (terms.length === 0) return { ok: false, msg: "계산할 항목을 한 개 이상 추가하세요." };
    for (const t of terms) {
      const e = checkFormulaTermColumns(t, fields);
      if (e) return { ok: false, msg: e };
    }
    const rIssue = roundTermIssue(terms, fields, draftFormulaResult);
    if (rIssue) return { ok: false, msg: rIssue };
    return { ok: true, terms };
  }, [draftFormula, draftFormulaResult, fields]);

  // 조건 설정 검증 — null 이면 통과(조건 안 씀). 켜져 있으면 기준필드·각 규칙(기준값·식)이 모두 유효해야 함.
  //   유효 규칙만 추려 돌려준다(빈 규칙 자동 제외). 규칙이 하나도 없으면 conditional 없이 저장(기본식만).
  const validateDraftConditional = useCallback((): { ok: true; conditional?: FieldDef["conditional"] } | { ok: false; msg: string } => {
    if (!draftConditional) return { ok: true };
    const cleaned: ConditionalRule[] = [];
    for (const r of draftConditional.rules) {
      const terms = parseFormulaTerms(r.formula);
      const hasTerms = terms.length > 0;
      // 절별 정리: 완전 빈 절 제거, 반만 찬 절은 오류.
      const cleanClauses: ConditionClause[] = [];
      for (const c of r.clauses) {
        const hasLeft = !!c.leftKey;
        const hasRight = c.right.kind === "field" ? !!c.right.key : c.right.value.trim() !== "";
        if (!hasLeft && !hasRight) continue; // 완전 빈 절 건너뜀
        if (!hasLeft) return { ok: false, msg: "조건의 기준 칸을 고르세요." };
        if (!hasRight) return { ok: false, msg: "조건의 비교 값(글자 또는 다른 칸)을 채우세요." };
        cleanClauses.push({ leftKey: c.leftKey, right: c.right, op: c.op });
      }
      if (cleanClauses.length === 0 && !hasTerms) continue; // 완전 빈 규칙 건너뜀
      if (cleanClauses.length === 0) return { ok: false, msg: "조건을 한 개 이상 채우세요." };
      if (!hasTerms) return { ok: false, msg: "조건이 맞을 때 쓸 계산 항목을 한 개 이상 추가하세요." };
      for (const t of terms) {
        const e = checkFormulaTermColumns(t, fields);
        if (e) return { ok: false, msg: `조건 식에 ${e}` };
      }
      const rIssue = roundTermIssue(terms, fields, draftFormulaResult);
      if (rIssue) return { ok: false, msg: `조건 식에 ${rIssue}` };
      // 절 1개 → 옛 형식(전 앱 호환), 2개+ → clauses 형식(새 계산기 필요).
      if (cleanClauses.length === 1) {
        const c = cleanClauses[0];
        cleaned.push({ leftKey: c.leftKey, right: c.right, op: c.op, formula: terms });
      } else {
        cleaned.push({ clauses: cleanClauses, combine: r.combine, formula: terms });
      }
    }
    if (cleaned.length === 0) return { ok: true }; // 켰지만 규칙 없음 → 기본식만(conditional 없이)
    return { ok: true, conditional: { rules: cleaned } };
  }, [draftConditional, draftFormulaResult, fields]);

  // 모달 confirm 처리
  const confirmFieldEdit = useCallback(() => {
    if (!fieldEditModal) return;
    const cleanedOptions = draftOptions.map((o) => o.trim()).filter((o) => o !== "");
    if (fieldEditModal.mode === "add") {
      const label = draftLabel.trim();
      if (!label) return;
      let newField: FieldDef;
      if (draftType === "formula") {
        if (draftFormulaResult === "date") {
          newField = { key: generateFieldKey(label, fields), label, type: "formula", formulaResult: "date", dateFormula: draftDateFormula };
        } else {
          const v = validateDraftFormula();
          if (!v.ok) { setFormulaError(v.msg); return; }
          const vc = validateDraftConditional();
          if (!vc.ok) { setFormulaError(vc.msg); return; }
          newField = { key: generateFieldKey(label, fields), label, type: "formula", formula: v.terms, formulaResult: draftFormulaResult };
          if (vc.conditional) newField.conditional = vc.conditional;
        }
      } else if (draftType === "select") {
        newField = { key: generateFieldKey(label, fields), label, type: "select", options: cleanedOptions };
      } else {
        newField = { key: generateFieldKey(label, fields), label, type: draftType };
      }
      // 칸 범위(scope) 부여 — 서버가 공통/커스텀 저장소를 가른다. off 모드는 scope 없음(현행).
      const newScope =
        columnScopeMode === "partner-custom" ? "custom"
        : columnScopeMode === "erp" ? draftScope
        : undefined;
      if (newScope) (newField as unknown as Record<string, unknown>).scope = newScope;
      const key = newField.key;
      const next = [...fields, newField];
      setFields(next);
      persistFields(next);
      setTiers((prev) => {
        const empty = (draftType === "number" || draftType === "percent" || draftType === "formula") ? null : "";
        const updated = prev.map((t) => ({ ...t, [key]: empty }));
        persist(updated);
        return updated;
      });
    } else if (fieldEditModal.mode === "rename") {
      const label = draftLabel.trim();
      if (!label || label === fieldEditModal.label) { setFieldEditModal(null); return; }
      const next = fields.map((f) => f.key === fieldEditModal.key ? { ...f, label } : f);
      setFields(next);
      persistFields(next);
    } else if (fieldEditModal.mode === "changeType") {
      const newType = draftType;
      const key = fieldEditModal.key;
      // 수식이 아니고 타입도 그대로면 변경 없음 (수식은 식 내용이 바뀌었을 수 있어 항상 저장)
      if (newType !== "formula" && newType === fieldEditModal.type) { setFieldEditModal(null); return; }
      let formulaTerms: FormulaTerm[] = [];
      let formulaConditional: FieldDef["conditional"] | undefined;
      if (newType === "formula" && draftFormulaResult !== "date") {
        const v = validateDraftFormula();
        if (!v.ok) { setFormulaError(v.msg); return; }
        const vc = validateDraftConditional();
        if (!vc.ok) { setFormulaError(vc.msg); return; }
        formulaTerms = v.terms;
        formulaConditional = vc.conditional;
      }
      const next = fields.map((f) => {
        if (f.key !== key) return f;
        const keepScope = (f as { scope?: "common" | "custom" }).scope;
        const keepTableExposed = (f as { tableExposed?: boolean }).tableExposed;
        if (newType === "formula") {
          const nf: FieldDef = draftFormulaResult === "date"
            ? { key: f.key, label: f.label, type: "formula" as FieldType, formulaResult: "date", dateFormula: draftDateFormula }
            : { key: f.key, label: f.label, type: "formula" as FieldType, formula: formulaTerms, formulaResult: draftFormulaResult };
          if (draftFormulaResult !== "date" && formulaConditional) nf.conditional = formulaConditional;
          if (keepScope) (nf as unknown as Record<string, unknown>).scope = keepScope;
          if (keepTableExposed) (nf as unknown as Record<string, unknown>).tableExposed = keepTableExposed;
          return nf;
        }
        // select 로 바꾸면 보기 목록을 싣는다 (범위 scope 는 유지)
        if (newType === "select") {
          const sel = { key: f.key, label: f.label, type: "select" as FieldType, options: cleanedOptions };
          if (keepScope) (sel as unknown as Record<string, unknown>).scope = keepScope;
          if (keepTableExposed) (sel as unknown as Record<string, unknown>).tableExposed = keepTableExposed;
          return sel;
        }
        // 수식이 아닌 타입으로 바꾸면 수식·조건 옵션은 제거 (범위 scope 는 유지)
        const convField: FieldDef = { key: f.key, label: f.label, type: newType };
        if (keepScope) (convField as unknown as Record<string, unknown>).scope = keepScope;
        if (keepTableExposed) (convField as unknown as Record<string, unknown>).tableExposed = keepTableExposed;
        return convField;
      });
      setFields(next);
      persistFields(next);
      setTiers((prev) => {
        const updated = prev.map((t) => {
          const v = t[key];
          let conv: string | number | null;
          if (newType === "number" || newType === "percent") {
            conv = typeof v === "number" ? v : (v === "" || v == null ? null : Number(v) || null);
          } else if (newType === "formula") {
            conv = null; // 수식 컬럼은 자동 계산이라 저장값을 비워둠 (잔존 숫자 정리)
          } else {
            conv = v == null ? "" : String(v);
          }
          return { ...t, [key]: conv };
        });
        persist(updated);
        return updated;
      });
    }
    setFieldEditModal(null);
  }, [fieldEditModal, draftLabel, draftType, draftFormula, draftFormulaResult, draftDateFormula, draftOptions, validateDraftFormula, validateDraftConditional, fields, persistFields, persist, columnScopeMode, draftScope]);

  // ── 수식 빌더 도우미 ──
  // 수식 항에서 고를 수 있는 컬럼 목록 (숫자·퍼센트·수식만, 편집 중인 자기 자신은 제외)
  const editingFieldKey = fieldEditModal?.mode === "changeType" ? fieldEditModal.key : null;
  const formulaColumnOptions = useMemo(
    () =>
      fields
        .filter((f) => isNumericFieldType(f.type) && f.key !== editingFieldKey)
        .map((f) => ({
          value: f.key,
          label: f.label + (f.type === "percent" ? " (%)" : f.type === "formula" ? " (수식)" : ""),
        })),
    [fields, editingFieldKey],
  );
  // (수식 항목 추가·수정·삭제는 FormulaTermsEditor 컴포넌트로 이동 — 기본 식·조건 규칙별 식 공용)
  // 특정 컬럼(key)을 항으로 참조하는 수식 컬럼들 — 삭제·타입변경 시 영향 경고에 사용
  const formulasReferencing = useCallback((key: string | null): FieldDef[] => {
    if (!key) return [];
    return fields.filter(
      (f) => f.type === "formula" && Array.isArray(f.formula) && f.formula.some((t) => t.unit === "column" && t.columnKey === key),
    );
  }, [fields]);

  const [pendingDeleteFieldKey, setPendingDeleteFieldKey] = useState<string | null>(null);
  const removeFieldDef = useCallback((key: string) => {
    setPendingDeleteFieldKey(key);
  }, []);
  const confirmDeleteField = useCallback(() => {
    const key = pendingDeleteFieldKey;
    if (!key) return;
    const next = fields.filter((f) => f.key !== key);
    setFields(next);
    persistFields(next);
    setTiers((prev) => {
      const updated = prev.map((t) => {
        const copy = { ...t };
        delete copy[key];
        return copy;
      });
      persist(updated);
      return updated;
    });
    setPendingDeleteFieldKey(null);
  }, [pendingDeleteFieldKey, fields, persistFields, persist]);

  // ── 칸 범위(공통↔커스텀) 변경 — 삭제 후 재생성 없이 그 자리에서 토글(ERP 편집기 전용) ──
  // 저장 시 서버가 공통/커스텀 보관함을 다시 가르므로 칸이 알맞은 보관함으로 옮겨진다. 입력값은 그대로 유지.
  const [pendingScopeToggleKey, setPendingScopeToggleKey] = useState<string | null>(null);
  const changeFieldScope = useCallback((key: string) => {
    setPendingScopeToggleKey(key);
  }, []);
  const confirmScopeToggle = useCallback(() => {
    const key = pendingScopeToggleKey;
    if (!key) return;
    const next = fields.map((f) => {
      if (f.key !== key) return f;
      const cur = (f as { scope?: string }).scope === "custom" ? "custom" : "common";
      const nextScope = cur === "custom" ? "common" : "custom";
      const nf = { ...f } as FieldDef;
      (nf as unknown as Record<string, unknown>).scope = nextScope;
      return nf;
    });
    setFields(next);
    persistFields(next);
    setPendingScopeToggleKey(null);
  }, [pendingScopeToggleKey, fields, persistFields]);

  // ── 차수 칸 "표 노출" 토글 — 이 칸을 도메인 표(경정청구 등)에 차수별 줄로 노출(ERP 전용) ──
  const [pendingExposeKey, setPendingExposeKey] = useState<string | null>(null);
  const toggleTableExpose = useCallback((key: string) => {
    setPendingExposeKey(key);
  }, []);
  const confirmToggleExpose = useCallback(() => {
    const key = pendingExposeKey;
    if (!key) return;
    const next = fields.map((f) => {
      if (f.key !== key) return f;
      const cur = !!(f as { tableExposed?: boolean }).tableExposed;
      const nf = { ...f } as FieldDef;
      (nf as unknown as Record<string, unknown>).tableExposed = !cur;
      return nf;
    });
    setFields(next);
    persistFields(next);
    setPendingExposeKey(null);
  }, [pendingExposeKey, fields, persistFields]);

  // ── 드래그 앤 드롭으로 컬럼 순서 변경 ──
  const moveField = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= fields.length || toIdx >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setFields(next);
    persistFields(next);
  }, [fields, persistFields]);

  const handleDragStart = useCallback((idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    // 일부 브라우저(Firefox)에서 드래그가 시작되려면 dataTransfer.setData 호출 필요
    try { e.dataTransfer.setData("text/plain", String(idx)); } catch { /* ignore */ }
  }, []);

  const handleDragOver = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx !== null) moveField(dragIdx, idx);
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, moveField]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const refundField = useMemo(() => {
    return fields.find((f) =>
      f.type === "number" &&
      (f.key === "총환급금" || /환급금/.test(f.label) || /환급금/.test(f.key))
    );
  }, [fields]);

  // 서버 저장만 담당 — 실패 시 rollback 콜백 호출. 화면 state 변경은 호출자가.
  const saveCardsToServer = useCallback(async (next: ScoreCardDef[], rollback: () => void) => {
    try {
      const res = await fetch(configApiPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [cardsKey]: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        rollback();
        showNotice("스코어카드 저장에 실패했습니다. 권한과 연결을 확인해주세요.", "저장 실패");
        return;
      }
      // 모듈 캐시도 새로고침 — 다른 부품이 옛 값 보는 일 방지
      fetchConfigCached(configApiPath, true).catch(() => {});
    } catch (err) {
      console.warn("[saveCardsToServer]", err);
      rollback();
      showNotice("스코어카드 저장 중 오류가 발생했습니다.", "저장 오류");
    }
  // dialog 는 안정된 클로저 — 의존성에 안 넣어도 OK
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 함수형 업데이트로 stale closure 방지. setScoreCards 안에서 next 계산 → 외부에서 PUT.
  const applyAndSave = useCallback((mutator: (prev: ScoreCardDef[]) => ScoreCardDef[]) => {
    let prevSnapshot: ScoreCardDef[] = [];
    let nextSnapshot: ScoreCardDef[] = [];
    setScoreCards((prev) => {
      prevSnapshot = prev;
      nextSnapshot = mutator(prev);
      return nextSnapshot;
    });
    // setState 처리 후 마이크로태스크로 PUT — 같은 stack 의 set 폭주 방지
    queueMicrotask(() => {
      saveCardsToServer(nextSnapshot, () => setScoreCards(prevSnapshot));
    });
  }, [saveCardsToServer]);

  const updateCardField = useCallback((id: string, patch: Partial<ScoreCardDef>) => {
    applyAndSave((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, [applyAndSave]);

  const updateCardFormula = useCallback((id: string, key: "plus" | "minus", action: "add" | "remove", columnKey: string) => {
    applyAndSave((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const list = c.formula[key];
      const updated = action === "add"
        ? (list.includes(columnKey) ? list : [...list, columnKey])
        : list.filter((k) => k !== columnKey);
      return { ...c, formula: { ...c.formula, [key]: updated } };
    }));
  }, [applyAndSave]);

  // 직접 수식 항목 추가/수정/제거 — slot 으로 어느 영역(합산/차감/전체)에 적용할지 선택
  type CustomSlot = "custom" | "plusCustom" | "minusCustom";
  const addCustomFormula = useCallback((id: string, slot: CustomSlot = "custom") => {
    applyAndSave((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const cur = Array.isArray(c.formula[slot]) ? c.formula[slot]! : [];
      return { ...c, formula: { ...c.formula, [slot]: [...cur, { op: "*" as const, value: 0, unit: "number" as const }] } };
    }));
  }, [applyAndSave]);
  const updateCustomFormula = useCallback((id: string, idx: number, patch: Partial<{ op: "+" | "-" | "*" | "/"; value: number; unit: "number" | "percent" | "column"; columnKey: string }>, slot: CustomSlot = "custom") => {
    applyAndSave((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const cur = Array.isArray(c.formula[slot]) ? c.formula[slot]! : [];
      const updated = cur.map((item, i) => i === idx ? { ...item, ...patch } : item);
      return { ...c, formula: { ...c.formula, [slot]: updated } };
    }));
  }, [applyAndSave]);
  const removeCustomFormula = useCallback((id: string, idx: number, slot: CustomSlot = "custom") => {
    applyAndSave((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const cur = Array.isArray(c.formula[slot]) ? c.formula[slot]! : [];
      return { ...c, formula: { ...c.formula, [slot]: cur.filter((_, i) => i !== idx) } };
    }));
  }, [applyAndSave]);

  const addScoreCard = useCallback(() => {
    const newCard: ScoreCardDef = {
      id: makeScoreCardId(),
      label: "새 카드",
      color: "purple",
      formula: { plus: [], minus: [] },
    };
    applyAndSave((prev) => [...prev, newCard]);
  }, [applyAndSave]);

  const [pendingDeleteCardId, setPendingDeleteCardId] = useState<string | null>(null);
  const removeScoreCard = useCallback((id: string) => {
    setPendingDeleteCardId(id);
  }, []);
  const confirmDeleteCard = useCallback(() => {
    const id = pendingDeleteCardId;
    if (!id) return;
    applyAndSave((prev) => prev.filter((c) => c.id !== id));
    setPendingDeleteCardId(null);
  }, [pendingDeleteCardId, applyAndSave]);

  // 한 세부 섹션 안의 차수만 골라내는 함수.
  //   subId === undefined 또는 "__all" → 모든 차수
  //   세부 섹션 id → 그 id 의 차수 + (옛 차수는 첫 번째 세부 섹션 으로 자동 배정)
  const tiersInSubSection = useCallback((subId?: string): TierData[] => {
    if (!subId || subId === "__all" || subSectionsSafe.length === 0) return tiers;
    const firstSubId = subSectionsSafe[0]?.id;
    return tiers.filter((t) => {
      const tid = t._subSectionId;
      if (typeof tid === "string" && tid.length > 0) return tid === subId;
      return subId === firstSubId; // 옛 차수 fallback
    });
  }, [tiers, subSectionsSafe]);
  // 한 카드의 값 계산 — sum(plus) - sum(minus). 원본 숫자 그대로 합산.
  // (percent 변환은 직접 수식 unit=column 분기에서만 적용해 합산/차감 회귀 차단)
  // ★ 세부 섹션 인식 — 인자 없으면 옛 동작(전체), 있으면 그 영역만.
  const sumColumnIn = useCallback((k: string, subId?: string) => {
    const target = tiersInSubSection(subId);
    // 수식 컬럼은 저장값이 없으므로 차수마다 계산해서 합산.
    const field = fields.find((f) => f.key === k);
    if (field?.type === "formula") {
      // 날짜 수식 칸은 숫자 합계에 포함하지 않음 (문자열 날짜이므로 0 처리)
      if (field.formulaResult === "date") return 0;
      return target.reduce((a, t) => {
        const r = evalFormulaForTier(field, t, fields, undefined, row ?? undefined);
        return a + (typeof r === "number" && Number.isFinite(r) ? r : 0);
      }, 0);
    }
    return target.reduce((a, t) => a + (typeof t[k] === "number" ? (t[k] as number) : 0), 0);
  }, [tiersInSubSection, fields, row]);
  // 옛 호출 호환 — 인자 1개. 항상 전체 합산.
  const sumColumn = useCallback((k: string) => sumColumnIn(k), [sumColumnIn]);
  // NO.132 — 이 칸에 '실제로 더할 값'이 하나라도 있었나. 합계 카드가 0원을 보여줄지 '-'를
  // 보여줄지 가르는 판정이다. 옛 경정청구 업체는 수수료율 칸이 아예 없어(옛 노션 DB에 없던
  // 항목) 수식이 계산 불가(null)인데, 합계는 그걸 0으로 세어 "총 예상 수수료 0원"이라는
  // 틀린 사실을 큰 카드에 띄웠다. 값이 하나라도 있으면 종전대로 합계를 보여준다.
  const columnHasValueIn = useCallback((k: string, subId?: string): boolean => {
    const target = tiersInSubSection(subId);
    const field = fields.find((f) => f.key === k);
    if (field?.type === "formula") {
      if (field.formulaResult === "date") return false;
      return target.some((t) => {
        const r = evalFormulaForTier(field, t, fields, undefined, row ?? undefined);
        return typeof r === "number" && Number.isFinite(r);
      });
    }
    return target.some((t) => typeof t[k] === "number");
  }, [tiersInSubSection, fields, row]);
  // 직접 수식 항목 배열을 base 에 순차 적용 — 합산/차감/전체 3 곳에서 공통 사용
  // unit=column 이면 그 컬럼 합계를 값으로 사용.
  //   ★ subId 가 있으면 그 영역 차수만 합산 (통합 탭 = subId 없음 → 전체)
  //   참조 컬럼이 percent 타입이면 곱셈에서 30%가 30으로 잘못 적용되지 않도록 /100 처리.
  const applyCustoms = (base: number, customs: ReadonlyArray<{ op: "+" | "-" | "*" | "/"; value: number; unit: "number" | "percent" | "column"; columnKey?: string }> | undefined, subId?: string): number => {
    if (!customs || customs.length === 0) return base;
    let cur = base;
    for (const c of customs) {
      let v: number;
      if (c.unit === "percent") v = c.value / 100;
      else if (c.unit === "column" && c.columnKey) {
        v = sumColumnIn(c.columnKey, subId);
        // 참조 컬럼이 percent 타입이면 비율로 변환 (예: 30 → 0.3)
        const refField = fields.find((f) => f.key === c.columnKey);
        if (refField?.type === "percent") v = v / 100;
      }
      else v = c.value;
      if (c.op === "+") cur = cur + v;
      else if (c.op === "-") cur = cur - v;
      else if (c.op === "*") cur = cur * v;
      else if (c.op === "/") cur = (v === 0 ? cur : cur / v);
    }
    return cur;
  };

  // 한 카드 계산 — 세부 섹션 필터링 인식.
  //   subId 없으면 전체. 있으면 그 영역의 차수만 합산.
  const evalCardIn = useCallback((card: ScoreCardDef, subId?: string): number => {
    const numberFieldKeys = new Set(fields.filter((f) => f.type === "number" || f.type === "percent" || f.type === "formula").map((f) => f.key));
    const sumIfNumber = (keys: string[]) => keys.reduce((a, k) => a + (numberFieldKeys.has(k) ? sumColumnIn(k, subId) : 0), 0);
    // applyCustoms 에도 subId 전달 — 직접 수식 unit=column 도 영역 필터링 따라감.
    const plusResult = applyCustoms(sumIfNumber(card.formula.plus), card.formula.plusCustom, subId);
    const minusResult = applyCustoms(sumIfNumber(card.formula.minus), card.formula.minusCustom, subId);
    return applyCustoms(plusResult - minusResult, card.formula.custom, subId);
  }, [fields, sumColumnIn]);
  // 옛 호환 — 인자 1개. 전체 합계.
  const evalCard = useCallback((card: ScoreCardDef): number => evalCardIn(card), [evalCardIn]);
  // NO.132 — 카드에 보탤 실제 값이 하나도 없으면 true(화면에 '0원' 대신 '-').
  // 직접 수식(숫자·퍼센트 상수)이 걸려 있으면 사람이 넣은 값이므로 '값 있음'으로 본다.
  const cardIsEmpty = useCallback((card: ScoreCardDef, subId?: string): boolean => {
    const numberFieldKeys = new Set(fields.filter((f) => f.type === "number" || f.type === "percent" || f.type === "formula").map((f) => f.key));
    const customs = [card.formula.plusCustom, card.formula.minusCustom, card.formula.custom];
    const referenced = [
      ...[...card.formula.plus, ...card.formula.minus].filter((k) => numberFieldKeys.has(k)),
      ...customs.flatMap((list) => (list ?? [])
        .filter((c) => c.unit === "column" && c.columnKey)
        .map((c) => c.columnKey as string)),
    ];
    // 칸을 하나라도 참조하면, 그 칸들에 이 회사의 실제 값이 있는지로만 판정한다.
    // 카드 설정의 상수(예: 부가세율 110%)는 '이 회사의 데이터'가 아니므로 값으로 치지 않는다
    // — 상수를 값으로 치면 상수가 붙은 카드에서 가짜 0원이 그대로 남는다(코드리뷰 F6).
    if (referenced.length > 0) return !referenced.some((k) => columnHasValueIn(k, subId));
    // 칸을 하나도 참조하지 않는 '순수 상수' 카드는 그 상수가 곧 값이다.
    return !customs.some((list) => (list ?? []).length > 0);
  }, [fields, columnHasValueIn]);

  // 옛 4-카드 totals 계산 제거 — 동적 scoreCards/evalCard 가 모든 카드 값을 계산.
  // cardLabels/cardSources 는 hive-config 마이그레이션 시 settlementCards 미존재 fallback 으로만 사용됨.

  // 활성 탭 컨텍스트 — "__all" 통합 / 그 외 세부 섹션 id
  const isUnifiedTab = activeSubSectionId === "__all";
  const activeSubFilter = isUnifiedTab ? undefined : activeSubSectionId;
  const tiersInActive = useMemo(() => tiersInSubSection(activeSubFilter), [tiersInSubSection, activeSubFilter]);
  const activeSubLabel = isUnifiedTab
    ? "전체 합계"
    : (subSectionsSafe.find((s) => s.id === activeSubSectionId)?.label || "이 세부 섹션");

  return (
    <div className="space-y-4">
      {/* ── 세부 섹션 선택 영역 ──
          박스로 감싸 "여기서 영역을 선택한다" 는 신호를 강하게.
          상단 안내 라벨 + 알약 모양 활성 탭으로 시각 위계 분명히. */}
      {subSectionsSafe.length > 0 && (
        <div className="rounded-xl border border-wedly-bd bg-wedly-bg-blue/20 px-3 pt-2.5 pb-2.5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold text-wedly-accent uppercase tracking-wider">📂 세부 섹션 선택</span>
            <span className="text-[10px] text-wedly-muted">탭을 눌러 영역별 합계와 차수를 봅니다</span>
            {/* 어드민 — "세부 섹션 편집" 토글. 켜면 활성 탭에 ⋮ 등장.
                디자인 통일: 히스토리/상세정보 "탭 편집" 과 같은 작은 테두리 버튼 + 연필 아이콘. */}
            {canEditStructure && onUpdateSubSections && (
              <button
                type="button"
                onClick={() => setEditSubMode((v) => !v)}
                className={`ml-auto flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors whitespace-nowrap ${
                  editSubMode
                    ? "border-wedly-accent text-wedly-accent bg-wedly-bg-blue/40"
                    : "border-wedly-bd text-wedly-t2 hover:bg-wedly-bg-gray hover:text-wedly-t1"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 2L14 4.5L5.5 13L2 14L3 10.5L11.5 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                {editSubMode ? "편집 완료" : "세부 섹션 편집"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto" role="tablist" aria-label="세부 섹션 탭">
            {/* 통합 탭 — 항상 첫 번째, 시스템 기본. 알약 형태로 강조. */}
            <button
              type="button"
              role="tab"
              aria-selected={isUnifiedTab}
              onClick={() => setActiveSubSectionId("__all")}
              className={`flex-shrink-0 px-4 py-2 text-[14px] sm:text-[13px] font-bold whitespace-nowrap rounded-full min-h-[40px] sm:min-h-[34px] transition-all border ${
                isUnifiedTab
                  ? "bg-wedly-accent text-white border-wedly-accent shadow-md"
                  : "bg-white text-wedly-t2 border-wedly-bd hover:border-wedly-accent/50 hover:text-wedly-t1"
              }`}
            >
              🌐 통합
            </button>
            {subSectionsSafe.map((s) => {
              const isActive = activeSubSectionId === s.id;
              // 세부 섹션 편집(구조)도 본부(ERP) 전용 — canEditColumns(=allowStructureEdit 포함) 로 묶는다.
              const canEditSub = canEditStructure && onUpdateSubSections;
              const showDots = isActive && canEditSub && editSubMode;
              // 편집 모드에서 활성 탭 — 라벨과 ⋮ 를 한 알약 컨테이너에 넣어 모서리 끊김 방지.
              if (showDots) {
                return (
                  <div key={s.id} className="relative flex-shrink-0">
                    <div className="flex items-stretch rounded-full bg-wedly-accent border border-wedly-accent shadow-md overflow-hidden">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={true}
                        onClick={() => setActiveSubSectionId(s.id)}
                        className="px-4 py-2 text-[14px] sm:text-[13px] font-bold whitespace-nowrap text-white min-h-[40px] sm:min-h-[34px]"
                      >
                        {s.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditMenuOpenForId(editMenuOpenForId === s.id ? null : s.id)}
                        aria-label="세부 섹션 편집 메뉴"
                        aria-expanded={editMenuOpenForId === s.id}
                        aria-controls={`subsec-editbar-${s.id}`}
                        className="px-2.5 text-[15px] font-bold text-white border-l border-white/30 hover:bg-white/15 transition-colors min-h-[40px] sm:min-h-[34px]"
                      >⋮</button>
                    </div>
                  </div>
                );
              }
              // 그 외 — 단순 알약 한 개.
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveSubSectionId(s.id)}
                  className={`flex-shrink-0 px-4 py-2 text-[14px] sm:text-[13px] font-bold whitespace-nowrap rounded-full min-h-[40px] sm:min-h-[34px] transition-all border ${
                    isActive
                      ? "bg-wedly-accent text-white border-wedly-accent shadow-md"
                      : "bg-white text-wedly-t2 border-wedly-bd hover:border-wedly-accent/50 hover:text-wedly-t1"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          {/* 어드민용 — 탭 줄 끝의 "+ 세부 섹션 추가" */}
          {canEditColumns && onUpdateSubSections && (
            <button
              type="button"
              onClick={() => { setSubSectionDraftLabel(""); setSubSectionAddOpen(true); }}
              className="flex-shrink-0 px-3.5 py-2 text-[13px] sm:text-[12px] font-bold text-wedly-accent bg-white border-2 border-dashed border-wedly-bd-blue/70 rounded-full hover:bg-wedly-bg-blue/30 hover:border-wedly-accent transition-colors min-h-[40px] sm:min-h-[34px]"
              title="세부 섹션 추가"
              role="presentation"
            >
              + 추가
            </button>
          )}
          </div>
          {/* ── 인라인 편집 바 — ⋮ 누른 세부 섹션 대상. 탭 줄(가로 스크롤) 밖이라 안 잘림. ── */}
          {editSubMode && editMenuOpenForId && (() => {
            const target = subSectionsSafe.find((s) => s.id === editMenuOpenForId);
            if (!target) return null;
            const tIdx = subSectionsSafe.findIndex((s) => s.id === editMenuOpenForId);
            return (
              <div id={`subsec-editbar-${target.id}`} role="toolbar" aria-label={`${target.label} 편집`} className="mt-2.5 pt-2.5 border-t border-wedly-bd/60 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-wedly-t2 mr-1">&quot;{target.label}&quot; 편집:</span>
                <button
                  type="button"
                  onClick={() => { setSubSectionRename({ id: target.id, label: target.label }); }}
                  className="px-3 py-1.5 text-[12px] font-medium text-wedly-t1 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-blue/30 hover:border-wedly-accent/50 transition-colors min-h-[40px] sm:min-h-[34px]"
                >✏️ 이름 수정</button>
                <button
                  type="button"
                  disabled={tIdx === 0}
                  onClick={() => moveSubSection(target.id, -1)}
                  className="px-3 py-1.5 text-[12px] font-medium text-wedly-t1 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-blue/30 hover:border-wedly-accent/50 transition-colors min-h-[40px] sm:min-h-[34px] disabled:opacity-40 disabled:cursor-not-allowed"
                >← 왼쪽으로</button>
                <button
                  type="button"
                  disabled={tIdx === subSectionsSafe.length - 1}
                  onClick={() => moveSubSection(target.id, 1)}
                  className="px-3 py-1.5 text-[12px] font-medium text-wedly-t1 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-blue/30 hover:border-wedly-accent/50 transition-colors min-h-[40px] sm:min-h-[34px] disabled:opacity-40 disabled:cursor-not-allowed"
                >오른쪽으로 →</button>
                <button
                  type="button"
                  onClick={() => setSubSectionDeleteConfirm({ id: target.id, label: target.label })}
                  className="px-3 py-1.5 text-[12px] font-medium text-wedly-red bg-white border border-wedly-bd-red/70 rounded-lg hover:bg-wedly-bg-red/40 transition-colors min-h-[40px] sm:min-h-[34px]"
                >🗑 삭제</button>
                <button
                  type="button"
                  onClick={() => setEditMenuOpenForId(null)}
                  className="ml-auto px-2.5 py-1.5 text-[12px] text-wedly-muted hover:text-wedly-t2 transition-colors min-h-[40px] sm:min-h-[34px]"
                >닫기</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* 합계 카드 — 활성 탭에 맞게 합산. hideSummaryCards 면 통째로 숨김(작은 임베드 카드용). */}
      {!hideSummaryCards && (
      <div className="rounded-2xl border border-wedly-bd bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] font-semibold text-wedly-muted uppercase tracking-wider">{activeSubLabel}</p>
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-wedly-muted">{tiersInActive.length}개 차수 · {scoreCards.length}개 카드</p>
            {/* 통합 편집 버튼 (카드 편집 + 컬럼 편집을 한 번에 ON/OFF) — 전체 합계 카드 머리에 배치 */}
            {canEditColumns && (
              <button
                type="button"
                onClick={() => { const next = !(editCards || editFields); setEditCards(next); setEditFields(next); }}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors whitespace-nowrap ${
                  (editCards || editFields)
                    ? "border-wedly-accent text-wedly-accent bg-wedly-bg-blue/40"
                    : "border-wedly-bd text-wedly-t2 hover:bg-wedly-bg-gray hover:text-wedly-t1"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M11.5 2L14 4.5L5.5 13L2 14L3 10.5L11.5 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                {(editCards || editFields) ? "편집 종료" : "편집"}
              </button>
            )}
          </div>
        </div>
        <div className={`grid gap-3 ${scoreCards.length <= 2 ? "grid-cols-1 md:grid-cols-2" : scoreCards.length === 3 ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4"}`}>
          {scoreCards.map((card) => {
            const colors = SCORECARD_COLOR_CLASSES[card.color];
            const value = evalCardIn(card, activeSubFilter);
            const empty = cardIsEmpty(card, activeSubFilter); // NO.132 — 더할 값이 없으면 '-'
            return (
              <div key={card.id} className={`rounded-xl ${colors.bg} px-3 py-2.5`}>
                <p className={`text-[10px] font-bold ${colors.labelText}`}>{card.label || "(이름 없음)"}</p>
                <p className={`text-[16px] font-black ${colors.valueText} tabular-nums mt-0.5`}>
                  {empty ? "-" : (
                    <>
                      {fmtCurrency(value) || "0"}
                      <span className={`text-[10px] font-bold ${colors.labelText} ml-1`}>원</span>
                    </>
                  )}
                </p>
              </div>
            );
          })}
          {scoreCards.length === 0 && (
            <div className="col-span-full text-center text-[12px] text-wedly-muted py-6">
              카드가 없습니다. 어드민이 카드 편집에서 추가할 수 있습니다.
            </div>
          )}
        </div>
        {/* 통합 탭 — 세부 섹션별 합계 행 (각 영역 카드 한 줄씩) */}
        {isUnifiedTab && subSectionsSafe.length > 0 && (
          <div className="mt-4 pt-4 border-t border-wedly-bd/60 space-y-2">
            <p className="text-[11px] font-semibold text-wedly-muted uppercase tracking-wider">세부 섹션별 합계</p>
            {subSectionsSafe.map((sub) => {
              const subTiers = tiersInSubSection(sub.id);
              return (
                <div key={sub.id} className="rounded-xl border border-wedly-bd/60 bg-wedly-bg-gray/30 px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[12px] font-bold text-wedly-navy">{sub.label}</p>
                    <p className="text-[10px] text-wedly-muted">{subTiers.length}개 차수</p>
                  </div>
                  <div className={`grid gap-2 ${scoreCards.length <= 2 ? "grid-cols-2" : scoreCards.length === 3 ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4"}`}>
                    {scoreCards.map((card) => {
                      const colors = SCORECARD_COLOR_CLASSES[card.color];
                      const value = evalCardIn(card, sub.id);
                      const empty = cardIsEmpty(card, sub.id); // NO.132 — 더할 값이 없으면 '-'
                      return (
                        <div key={card.id} className={`rounded-lg ${colors.bg} px-2 py-1.5`}>
                          <p className={`text-[10px] font-medium ${colors.labelText}`}>{card.label || "(이름 없음)"}</p>
                          <p className={`text-[13px] font-bold ${colors.valueText} tabular-nums`}>
                            {empty ? "-" : (
                              <>
                                {fmtCurrency(value) || "0"}
                                <span className={`text-[10px] font-medium ${colors.labelText} ml-1`}>원</span>
                              </>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* 합계 카드 아래 안내 텍스트 — 사용자 요청으로 모두 제거 (자동 계산 상태/컬럼 식별 안내) */}
      </div>
      )}

      {/* 어드민 카드 편집 패널 */}
      {editCards && canEditColumns && (
        <div className="rounded-2xl border-2 border-wedly-accent/30 bg-wedly-bg-blue/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-wedly-accent">스코어카드 편집 (전체 사용자에게 적용됨)</p>
            <button
              onClick={addScoreCard}
              className="text-[11px] font-bold text-white bg-wedly-accent px-2.5 py-1 rounded-lg hover:brightness-110"
            >
              + 카드 추가
            </button>
          </div>
          <div className="space-y-3">
            {scoreCards.map((card) => {
              const colors = SCORECARD_COLOR_CLASSES[card.color];
              // 합산/차감 컬럼, 직접 수식의 컬럼값 후보 — number·percent·formula(수식) 모두 포함
              const numberFields = fields.filter((f) => f.type === "number" || f.type === "percent" || f.type === "formula");
              const COLOR_OPTIONS: Array<{ value: ScoreCardColor; label: string }> = [
                { value: "gray", label: "회색" },
                { value: "blue", label: "파랑" },
                { value: "yellow", label: "노랑" },
                { value: "green", label: "초록" },
                { value: "purple", label: "보라" },
                { value: "red", label: "빨강" },
              ];
              return (
                <div key={card.id} className="bg-white border border-wedly-bd rounded-xl p-3 space-y-2.5">
                  {/* 미리보기 + 기본 정보 */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className={`rounded-lg ${colors.bg} px-3 py-2 sm:min-w-[120px]`}>
                      <p className={`text-[9px] font-bold ${colors.labelText}`}>{card.label || "(이름 없음)"}</p>
                      <p className={`text-[14px] font-black ${colors.valueText} tabular-nums`}>
                        {cardIsEmpty(card) ? "-" : `${fmtCurrency(evalCard(card)) || "0"}원`}
                      </p>
                    </div>
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] font-semibold text-wedly-muted">제목</span>
                        <input
                          type="text"
                          value={card.label}
                          onChange={(e) => updateCardField(card.id, { label: e.target.value })}
                          className="mt-1 block w-full px-2.5 py-1.5 text-[12px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent transition-colors"
                        />
                      </label>
                      <div>
                        <span className="text-[10px] font-semibold text-wedly-muted">색상</span>
                        <div className="mt-1">
                          <CustomSelect
                            size="sm"
                            value={card.color}
                            onChange={(v) => updateCardField(card.id, { color: v as ScoreCardColor })}
                            options={COLOR_OPTIONS}
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeScoreCard(card.id)}
                      className="self-start text-[11px] px-2 py-1 rounded text-wedly-red hover:bg-wedly-bg-red"
                      title="카드 삭제"
                    >
                      ✕ 삭제
                    </button>
                  </div>
                  {/* 계산식 */}
                  <div className="border-t border-wedly-bd/50 pt-2">
                    <p className="text-[10px] font-semibold text-wedly-muted mb-1.5">
                      계산식: 합산 컬럼 − 차감 컬럼 (각 차수의 값을 모두 더함)
                    </p>
                    <div className="grid grid-cols-2 gap-2 items-stretch">
                      {(["plus", "minus"] as const).map((sign) => (
                        <div key={sign} className="flex flex-col">
                          <p className="text-[10px] font-bold text-wedly-t2 mb-1">
                            {sign === "plus" ? "+ 합산 컬럼" : "− 차감 컬럼"}
                          </p>
                          {/* min-h 로 칩 영역 높이 통일 — 한 쪽 칩이 비어 있어도 양쪽 select 위치 어긋나지 않음 */}
                          <div className="flex flex-wrap gap-1 mb-1.5 flex-1 min-h-[24px]">
                            {card.formula[sign].length === 0 ? (
                              <span className="text-[10px] text-wedly-muted italic">없음</span>
                            ) : (
                              card.formula[sign].map((k) => {
                                const f = numberFields.find((x) => x.key === k);
                                return (
                                  <button
                                    key={k}
                                    onClick={() => updateCardFormula(card.id, sign, "remove", k)}
                                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-wedly-bd bg-white hover:bg-wedly-bg-red/40 hover:border-wedly-red hover:text-wedly-red transition"
                                    title="제거"
                                  >
                                    {f?.label || k}
                                    <span className="text-wedly-muted">✕</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                          <CustomSelect
                            size="sm"
                            value=""
                            onChange={(v) => v && updateCardFormula(card.id, sign, "add", v)}
                            placeholder={`+ ${sign === "plus" ? "합산" : "차감"} 컬럼 추가`}
                            options={[
                              { value: "", label: `+ ${sign === "plus" ? "합산" : "차감"} 컬럼 추가` },
                              ...numberFields
                                .filter((f) => !card.formula[sign].includes(f.key))
                                .map((f) => ({ value: f.key, label: f.label })),
                            ]}
                          />
                          {/* 합산/차감 결과에만 적용되는 직접 수식 — 한 줄 그리드 3:2:3 으로 균형 잡힘 */}
                          {(() => {
                            const slot: "plusCustom" | "minusCustom" = sign === "plus" ? "plusCustom" : "minusCustom";
                            const items = (sign === "plus" ? card.formula.plusCustom : card.formula.minusCustom) || [];
                            const sumLabel = sign === "plus" ? "합산" : "차감";
                            return (
                              <div className="mt-2 pt-1.5 border-t border-wedly-bd/30 space-y-1.5">
                                {items.map((item, idx) => (
                                  <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 items-center">
                                    <CustomSelect
                                      size="sm"
                                      value={item.op}
                                      onChange={(v) => updateCustomFormula(card.id, idx, { op: v as "+" | "-" | "*" | "/" }, slot)}
                                      options={[
                                        { value: "*", label: "×" },
                                        { value: "/", label: "÷" },
                                        { value: "+", label: "+" },
                                        { value: "-", label: "−" },
                                      ]}
                                    />
                                    {item.unit === "column" ? (
                                      <CustomSelect
                                        size="sm"
                                        value={item.columnKey || ""}
                                        onChange={(v) => updateCustomFormula(card.id, idx, { columnKey: v }, slot)}
                                        placeholder="컬럼 선택"
                                        options={[
                                          { value: "", label: "컬럼 선택" },
                                          ...numberFields.map((f) => ({ value: f.key, label: f.label })),
                                        ]}
                                      />
                                    ) : (
                                      <input
                                        type="number"
                                        value={Number.isFinite(item.value) ? String(item.value) : ""}
                                        onChange={(e) => updateCustomFormula(card.id, idx, { value: Number(e.target.value) || 0 }, slot)}
                                        className="w-full px-2 py-1.5 text-[11px] border border-wedly-bd rounded-md focus:outline-none focus:ring-1 focus:ring-wedly-accent/20 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        placeholder="0"
                                      />
                                    )}
                                    <CustomSelect
                                      size="sm"
                                      value={item.unit}
                                      onChange={(v) => updateCustomFormula(card.id, idx, { unit: v as "number" | "percent" | "column" }, slot)}
                                      options={[
                                        { value: "number", label: "숫자" },
                                        { value: "percent", label: "%" },
                                        { value: "column", label: "컬럼값" },
                                      ]}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeCustomFormula(card.id, idx, slot)}
                                      className="text-[10px] text-wedly-muted hover:text-wedly-red w-5 h-5 flex items-center justify-center rounded hover:bg-wedly-bg-red"
                                      title="제거"
                                    >✕</button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => addCustomFormula(card.id, slot)}
                                  className="w-full py-1 text-[10px] font-medium text-wedly-accent border border-dashed border-wedly-accent/30 rounded hover:bg-wedly-bg-blue/30"
                                >
                                  + {sumLabel} 직접 수식
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    {/* 전체 직접 수식 — 합산/차감과 동일한 3등분 그리드로 균형 통일 */}
                    <div className="mt-3 pt-2 border-t border-wedly-bd/40">
                      <p className="text-[10px] font-bold text-wedly-t2 mb-1.5">
                        직접 수식 (위 결과에 순차 적용 — 곱·나누기·더하기·빼기)
                      </p>
                      <div className="space-y-1.5">
                        {(card.formula.custom || []).map((item, idx) => (
                          <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-center">
                            <CustomSelect
                              size="sm"
                              value={item.op}
                              onChange={(v) => updateCustomFormula(card.id, idx, { op: v as "+" | "-" | "*" | "/" }, "custom")}
                              options={[
                                { value: "*", label: "× 곱하기" },
                                { value: "/", label: "÷ 나누기" },
                                { value: "+", label: "+ 더하기" },
                                { value: "-", label: "− 빼기" },
                              ]}
                            />
                            {item.unit === "column" ? (
                              <CustomSelect
                                size="sm"
                                value={item.columnKey || ""}
                                onChange={(v) => updateCustomFormula(card.id, idx, { columnKey: v }, "custom")}
                                placeholder="컬럼 선택"
                                options={[
                                  { value: "", label: "컬럼 선택" },
                                  ...numberFields.map((f) => ({ value: f.key, label: f.label })),
                                ]}
                              />
                            ) : (
                              <input
                                type="number"
                                value={Number.isFinite(item.value) ? String(item.value) : ""}
                                onChange={(e) => updateCustomFormula(card.id, idx, { value: Number(e.target.value) || 0 }, "custom")}
                                className="w-full px-2 py-1.5 text-[12px] border border-wedly-bd rounded-md focus:outline-none focus:ring-2 focus:ring-wedly-accent/20 focus:border-wedly-accent text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                placeholder="0"
                              />
                            )}
                            <CustomSelect
                              size="sm"
                              value={item.unit}
                              onChange={(v) => updateCustomFormula(card.id, idx, { unit: v as "number" | "percent" | "column" }, "custom")}
                              options={[
                                { value: "number", label: "숫자" },
                                { value: "percent", label: "%" },
                                { value: "column", label: "컬럼값" },
                              ]}
                            />
                            <button
                              type="button"
                              onClick={() => removeCustomFormula(card.id, idx, "custom")}
                              className="text-[10px] text-wedly-muted hover:text-wedly-red w-6 h-6 flex items-center justify-center rounded hover:bg-wedly-bg-red"
                              title="이 수식 제거"
                            >✕</button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addCustomFormula(card.id, "custom")}
                          className="w-full py-1.5 text-[11px] font-medium text-wedly-accent border border-dashed border-wedly-accent/40 rounded-md hover:bg-wedly-bg-blue/30 transition-colors"
                        >
                          + 전체 직접 수식 추가
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {scoreCards.length === 0 && (
              <p className="text-[12px] text-wedly-muted text-center py-4">
                카드가 없습니다. 위 &quot;+ 카드 추가&quot; 버튼으로 시작하세요.
              </p>
            )}
          </div>
        </div>
      )}

      {savingFields && canEditColumns && (
        <div className="flex justify-end">
          <span className="text-[11px] text-wedly-muted">저장 중...</span>
        </div>
      )}

      {editFields && canEditColumns && (
        <div className="rounded-2xl border-2 border-wedly-accent/30 bg-wedly-bg-blue/10 p-4 space-y-2">
          <p className="text-[12px] font-semibold text-wedly-accent mb-2">
            컬럼 정의 (전체 차수에 적용됨)
            <span className="ml-2 text-[10px] font-normal text-wedly-muted">⋮⋮ 드래그하여 순서 변경</span>
          </p>
          {/* 줄별 칸 수 — 줄마다 가로 칸 수(1·2·3)를 따로 고른다. 위에서부터 순서대로 칸을 채움. 위들리 디자인 드롭다운 사용. */}
          {(() => {
            const saveLayout = (next: number[]) => {
              setRowLayout(next);
              fetch(configApiPath, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [rowLayoutKey]: next }),
              })
                .then(() => {
                  // 모듈 설정 캐시 새로고침 — 안 하면 창을 다시 열 때 옛 배치를 보여줘 되돌아간 것처럼 보임
                  // (saveCardsToServer 와 동일 패턴)
                  fetchConfigCached(configApiPath, true).catch(() => {});
                })
                .catch(() => { /* ignore */ });
            };
            const rowGroups = groupFieldsByRowLayout(fields, rowLayout);
            return (
              <div className="mb-3 rounded-lg border border-wedly-bd bg-white p-3 space-y-2">
                <p className="text-[11px] font-semibold text-wedly-t2">
                  줄별 칸 수
                  <span className="ml-1.5 font-normal text-wedly-muted">— 줄마다 가로로 1·2·3칸 중 골라요. 위에서부터 순서대로 채워집니다.</span>
                </p>
                {rowLayout.length === 0 ? (
                  <p className="text-[12px] text-wedly-muted py-1">
                    지금은 모든 칸이 <b>한 줄에 1칸씩(세로)</b>으로 표시됩니다. 아래 &quot;+ 줄 추가&quot;로 가로 묶음을 만드세요.
                  </p>
                ) : (
                  rowLayout.map((w, ri) => {
                    const grp = rowGroups[ri];
                    const names = grp ? grp.items.map((f) => f.label).join(", ") : "";
                    return (
                      <div key={ri} className="flex items-center gap-2">
                        <span className="text-[12px] text-wedly-t2 w-16 flex-shrink-0">{ri + 1}번째 줄</span>
                        <CustomSelect
                          value={String(w === 3 ? 3 : w === 2 ? 2 : 1)}
                          onChange={(next) => {
                            const n = Number(next);
                            const v = n === 2 ? 2 : n === 3 ? 3 : 1;
                            const arr = [...rowLayout];
                            arr[ri] = v;
                            saveLayout(arr);
                          }}
                          options={[
                            { value: "1", label: "1칸" },
                            { value: "2", label: "2칸" },
                            { value: "3", label: "3칸" },
                          ]}
                          size="sm"
                          fullWidth={false}
                          className="min-w-[84px]"
                        />
                        <span className="text-[11px] text-wedly-muted truncate flex-1 min-w-0" title={names}>
                          {names ? `→ ${names}` : "→ (이 줄에 들어갈 칸 없음)"}
                        </span>
                        <button
                          type="button"
                          onClick={() => saveLayout(rowLayout.filter((_, k) => k !== ri))}
                          className="p-1 rounded-md text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition-colors flex-shrink-0"
                          title="이 줄 삭제"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })
                )}
                <button
                  type="button"
                  onClick={() => saveLayout([...rowLayout, 1])}
                  className="w-full py-1.5 text-[11px] font-medium text-wedly-accent border border-dashed border-wedly-accent/40 rounded-md hover:bg-wedly-bg-blue/30 transition-colors"
                >
                  + 줄 추가
                </button>
              </div>
            );
          })()}
          {fields.map((f, idx) => {
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;
            const rowCn = [
              "flex items-center gap-2 bg-white rounded-lg px-3 py-2 border transition-all",
              isDragging ? "opacity-40 border-wedly-accent" : "border-wedly-bd",
              isDragOver ? "border-wedly-accent ring-2 ring-wedly-accent/20 -translate-y-0.5 shadow-md" : "",
            ].join(" ");
            return (
              <div
                key={f.key}
                draggable
                onDragStart={handleDragStart(idx)}
                onDragOver={handleDragOver(idx)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(idx)}
                onDragEnd={handleDragEnd}
                className={rowCn}
              >
                <span
                  className="cursor-grab active:cursor-grabbing text-wedly-muted hover:text-wedly-accent select-none px-1 -mx-1 text-[14px] leading-none"
                  title="드래그하여 순서 변경"
                  aria-label="드래그 핸들"
                >
                  ⋮⋮
                </span>
                <span className="text-[13px] font-medium text-wedly-t1 flex-1 min-w-0 truncate">{f.label}</span>
                <span className="text-[10px] uppercase font-mono text-wedly-muted bg-wedly-bg-gray px-1.5 py-0.5 rounded">{f.type}</span>
                {columnScopeMode !== "off" && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded text-wedly-muted bg-wedly-bg-gray"
                    title={
                      (f as { scope?: string }).scope === "custom"
                        ? "커스텀 — 이 분야 모든 회사 공통 · ERP에서만 표시(하이브·일루아엔 안 보임)"
                        : "공통 — 이 분야 모든 회사 공통 · 다른 앱(하이브·일루아)에도 표시"
                    }
                  >
                    {(f as { scope?: string }).scope === "custom" ? "커스텀" : "공통"}
                  </span>
                )}
                {(columnScopeMode !== "partner-custom" || (f as { scope?: string }).scope === "custom") && (
                  <>
                    <button onClick={() => renameFieldDef(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-accent hover:bg-wedly-bg-blue">이름 변경</button>
                    <button onClick={() => changeFieldType(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-purple hover:bg-wedly-bg-purple">타입</button>
                    {columnScopeMode === "erp" && (
                      <button onClick={() => changeFieldScope(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-green hover:bg-wedly-bg-green">범위</button>
                    )}
                    {columnScopeMode === "erp" && allowTableExpose && (
                      <button
                        onClick={() => toggleTableExpose(f.key)}
                        className={
                          (f as { tableExposed?: boolean }).tableExposed
                            ? "text-[11px] px-2 py-1 rounded text-wedly-orange hover:bg-wedly-bg-yellow"
                            : "text-[11px] px-2 py-1 rounded text-wedly-accent hover:bg-wedly-bg-blue"
                        }
                        title="이 칸을 경정청구 표에 차수별 줄로 노출/취소 (ERP 전용)"
                      >
                        {(f as { tableExposed?: boolean }).tableExposed ? "표 노출 취소" : "표 노출"}
                      </button>
                    )}
                    <button onClick={() => removeFieldDef(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-red hover:bg-wedly-bg-red">삭제</button>
                  </>
                )}
              </div>
            );
          })}
          <button
            onClick={addFieldDef}
            className="w-full py-2 rounded-lg border-2 border-dashed border-wedly-accent/40 text-[12px] font-bold text-wedly-accent hover:bg-wedly-bg-blue transition-colors"
          >
            + 컬럼 추가
          </button>
        </div>
      )}

      {/* ── 차수 카드 본체 ──
          1) 세부 섹션 없음 + 통합 탭 = 옛 동작 (모든 차수 + 추가 버튼)
          2) 세부 섹션 있음 + 통합 탭 = 차수 카드 안 보임 (영역별 합계만 위에서 표시)
          3) 세부 섹션 있음 + 세부 섹션 탭 = 그 영역의 차수만 + 추가 버튼 */}
      {(() => {
        // 겹친 차수 고유 id 찾기 — 등록 병합이 만드는 id 는 배열 길이에서 나와서, 가운데 차수를 지웠다
        // 다시 등록하면 이미 쓰던 id 가 되살아난다. 그대로 두면 한쪽에 붙은 표시가 아직 안 준 다른
        // 차수까지 "정산완료"로 보이게 한다(정산표는 이미 막고 있는데 카드만 안 막고 있었다 — 코드리뷰 지적).
        const dupTierIds = (() => {
          const count = new Map<string, number>();
          for (const t of tiers) {
            const id = String(t?.id ?? "");
            if (id) count.set(id, (count.get(id) ?? 0) + 1);
          }
          return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id));
        })();

        const renderTierCard = (tier: TierData, idx: number) => (
          <TierCard
            key={tier.id}
            tier={tier}
            fields={fields}
            index={idx}
            canRemove={!readOnly && tiers.length > 1}
            readOnly={readOnly}
            autoFeeKey={consultFeeField && reversedRate !== null ? consultFeeField.key : null}
            autoRevenueVatKey={revenueVatField?.key || null}
            autoRevenueNetKey={revenueNetField?.key || null}
            successKey={successField?.key || null}
            onChange={(key, value) => updateField(idx, key, value)}
            onLabelChange={(label) => updateTierLabel(idx, label)}
            onRemove={() => removeTier(idx)}
            renderTierBadge={renderTierBadge}
            tierIdDuplicated={dupTierIds.has(String(tier?.id ?? ""))}
            tierSuffix={tierSuffix}
            onTierSuffixChange={canEditStructure ? (next) => {
              setTierSuffix(next);
              fetch(configApiPath, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [tierSuffixKey]: next }),
              })
                .then(() => {
                  // 모듈 설정 캐시 새로고침 — 꼬리표도 창 재오픈 시 되돌아가는 것 예방(saveLayout 과 동일)
                  fetchConfigCached(configApiPath, true).catch(() => {});
                })
                .catch(() => { /* ignore */ });
            } : undefined}
            rowLayout={rowLayout}
            conditionValues={row ?? undefined}
          />
        );

        // 세부 섹션이 있는데 통합 탭 — 차수 카드는 보여주지 않고 영역별 카드를 위에서 끝.
        if (subSectionsSafe.length > 0 && isUnifiedTab) {
          return (
            <div className="rounded-xl border border-dashed border-wedly-bd p-6 text-center text-[12px] text-wedly-muted">
              통합 탭에서는 합계 카드만 보입니다. 차수 카드를 보거나 추가하려면 위 세부 섹션 탭을 선택하세요.
            </div>
          );
        }

        // 세부 섹션 탭 — 그 영역의 차수만 렌더.
        if (subSectionsSafe.length > 0 && !isUnifiedTab) {
          const itemsInGroup = tiers
            .map((t, i) => ({ tier: t, idx: i }))
            .filter(({ tier }) => {
              const tid = tier._subSectionId;
              if (typeof tid === "string" && tid.length > 0) return tid === activeSubSectionId;
              return activeSubSectionId === subSectionsSafe[0]?.id;
            });
          return (
            <div className="space-y-2">
              {itemsInGroup.slice().reverse().map(({ tier, idx }) => renderTierCard(tier, idx))}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => addTier(activeSubSectionId)}
                  className="w-full py-3 rounded-2xl border-2 border-dashed border-wedly-bd hover:border-wedly-accent hover:bg-wedly-bg-blue/30 transition-colors text-[13px] font-bold text-wedly-muted hover:text-wedly-accent flex items-center justify-center gap-1.5"
                >
                  + {ORDINAL_KO[itemsInGroup.length] || `${itemsInGroup.length + 1}차`} 추가
                </button>
              )}
            </div>
          );
        }

        // 세부 섹션 없음 — 옛 동작 그대로 + 어드민에게 "+ 세부 섹션으로 나눠 관리 시작" 진입점 노출
        return (
          <>
            {displayOrderNewestFirst(tiers).map(({ tier, idx }) => renderTierCard(tier, idx))}
            {!readOnly && (
              <button
                onClick={() => addTier()}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-wedly-bd hover:border-wedly-accent hover:bg-wedly-bg-blue/30 transition-colors text-[13px] font-bold text-wedly-muted hover:text-wedly-accent flex items-center justify-center gap-1.5"
              >
                + {ORDINAL_KO[tiers.length] || `${tiers.length + 1}차`} {addButtonSuffixOverride ?? tierSuffix} 추가
              </button>
            )}
            {canEditStructure && onUpdateSubSections && (
              <button
                type="button"
                onClick={() => { setSubSectionDraftLabel(""); setSubSectionAddOpen(true); }}
                className="w-full mt-1 py-2 rounded-xl border border-dashed border-wedly-bd-blue/60 text-[12px] font-medium text-wedly-accent hover:bg-wedly-bg-blue/30 transition-colors min-h-[40px] sm:min-h-[32px]"
              >
                + 세부 섹션으로 나눠 관리 시작
              </button>
            )}
          </>
        );
      })()}

      {/* 세부 섹션 추가 모달 — 라벨만 입력 (이름 수정·삭제·이동은 단계 B 에서) */}
      {subSectionAddOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSubSectionAddOpen(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">세부 섹션 추가</h3>
              <p className="mt-1 text-[11px] text-wedly-muted">예: 경정청구 / 정부지원금 / 기업인증제도</p>
            </div>
            <div className="px-5 py-4">
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">이름</span>
                <input
                  type="text"
                  autoFocus
                  value={subSectionDraftLabel}
                  onChange={(e) => setSubSectionDraftLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSubSectionAdd();
                    if (e.key === "Escape") setSubSectionAddOpen(false);
                  }}
                  placeholder="세부 섹션 이름"
                  maxLength={40}
                  className="mt-1 block w-full px-3 py-2 text-[16px] sm:text-[13px] min-h-[44px] sm:min-h-[36px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent"
                />
              </label>
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubSectionAddOpen(false)}
                className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
              >취소</button>
              <button
                type="button"
                disabled={!subSectionDraftLabel.trim() || !onUpdateSubSections}
                onClick={commitSubSectionAdd}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed"
              >추가</button>
            </div>
          </div>
        </div>
      )}

      {/* 세부 섹션 이름 수정 모달 (단계 B) */}
      {subSectionRename && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSubSectionRename(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">세부 섹션 이름 수정</h3>
            </div>
            <div className="px-5 py-4">
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">새 이름</span>
                <input
                  type="text"
                  autoFocus
                  value={subSectionRename.label}
                  onChange={(e) => setSubSectionRename({ ...subSectionRename, label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSubSectionRename();
                    if (e.key === "Escape") setSubSectionRename(null);
                  }}
                  maxLength={40}
                  className="mt-1 block w-full px-3 py-2 text-[16px] sm:text-[13px] min-h-[44px] sm:min-h-[36px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent"
                />
              </label>
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubSectionRename(null)}
                className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
              >취소</button>
              <button
                type="button"
                disabled={!subSectionRename.label.trim()}
                onClick={commitSubSectionRename}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed"
              >저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 세부 섹션 삭제 확인 모달 (단계 B) */}
      {subSectionDeleteConfirm && (() => {
        const targetTiers = tiers.filter((t) => t._subSectionId === subSectionDeleteConfirm.id);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSubSectionDeleteConfirm(null)} />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
              <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
                <h3 className="text-[15px] font-bold text-wedly-navy">세부 섹션 삭제</h3>
              </div>
              <div className="px-5 py-4 text-[13px] text-wedly-t2 space-y-2">
                <p>&quot;{subSectionDeleteConfirm.label}&quot; 세부 섹션을 삭제하시겠습니까?</p>
                {targetTiers.length > 0 && (
                  <p className="text-[12px] text-wedly-orange bg-wedly-bg-yellow/40 border border-wedly-orange/30 rounded p-2">
                    이 영역의 차수 {targetTiers.length}개는 첫 번째 영역으로 자동 이동됩니다. 데이터는 보존됩니다.
                  </p>
                )}
              </div>
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSubSectionDeleteConfirm(null)}
                  className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
                >취소</button>
                <button
                  type="button"
                  onClick={commitSubSectionDelete}
                  className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-red rounded-lg hover:bg-wedly-red/90 transition-colors"
                >삭제</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 정산 컬럼 편집 모달 — 위들리 디자인 */}
      {fieldEditModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setFieldEditModal(null)} />
          <div className={`relative w-full ${fieldEditModal.mode !== "rename" && draftType === "formula" ? "max-w-lg" : "max-w-sm"} bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in`}>
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">
                {fieldEditModal.mode === "add" ? "새 컬럼 추가"
                  : fieldEditModal.mode === "rename" ? "컬럼 이름 변경"
                  : "컬럼 타입 변경"}
              </h3>
            </div>
            <div className={`px-5 py-4 space-y-3 ${fieldEditModal.mode !== "rename" && draftType === "formula" ? "max-h-[68vh] overflow-y-auto" : ""}`}>
              {fieldEditModal.mode !== "changeType" && (
                <label className="block">
                  <span className="text-[11px] font-semibold text-wedly-t2">컬럼 이름</span>
                  <input
                    type="text"
                    autoFocus
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmFieldEdit(); if (e.key === "Escape") setFieldEditModal(null); }}
                    className="mt-1 block w-full px-3 py-2 text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent hover:border-wedly-accent/50 transition-colors"
                    placeholder="예: 비고"
                  />
                </label>
              )}
              {fieldEditModal.mode !== "rename" && (
                <label className="block">
                  <span className="text-[11px] font-semibold text-wedly-t2">컬럼 타입</span>
                  <div className="mt-1">
                    <CustomSelect
                      value={draftType}
                      onChange={(v) => { setDraftType(v as FieldType); setFormulaError(""); }}
                      options={[
                        { value: "text", label: "텍스트" },
                        { value: "date", label: "날짜" },
                        { value: "number", label: "숫자" },
                        { value: "select", label: "드롭다운" },
                        { value: "percent", label: "퍼센트 (%)" },
                        { value: "formula", label: "수식 (자동 계산)" },
                      ]}
                    />
                  </div>
                </label>
              )}
              {columnScopeMode === "erp" && fieldEditModal.mode === "add" && (
                <label className="block">
                  <span className="text-[11px] font-semibold text-wedly-t2">칸 범위</span>
                  <div className="mt-1">
                    <CustomSelect
                      value={draftScope}
                      onChange={(v) => setDraftScope(v as "common" | "custom")}
                      options={[
                        { value: "common", label: "공통 (전 앱 공유)" },
                        { value: "custom", label: "커스텀 (ERP 전용)" },
                      ]}
                    />
                  </div>
                </label>
              )}

              {/* ── 보기 목록 편집기 (type === "select" 일 때) ── */}
              {fieldEditModal.mode !== "rename" && draftType === "select" && (
                <div className="rounded-xl border border-wedly-accent/30 bg-wedly-bg-blue/10 p-3 space-y-2">
                  <span className="text-[11px] font-bold text-wedly-accent">📋 보기 목록 (하나 고르기)</span>
                  <div className="space-y-1.5">
                    {draftOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => setDraftOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                          placeholder="예: 진행"
                          className="flex-1 px-2.5 py-1.5 text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 focus:outline-none focus:ring-2 focus:ring-wedly-accent/30"
                        />
                        <button
                          type="button"
                          onClick={() => setDraftOptions((prev) => prev.filter((_, j) => j !== i))}
                          className="px-2 py-1.5 text-[12px] text-wedly-red hover:bg-wedly-bg-red/40 rounded-lg"
                        >삭제</button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraftOptions((prev) => [...prev, ""])}
                    className="text-[12px] font-semibold text-wedly-accent hover:underline"
                  >+ 보기 추가</button>
                </div>
              )}

              {/* 참조 중인 컬럼을 글자·날짜로 바꾸면 그 수식이 깨질 수 있음 — 사전 경고 */}
              {fieldEditModal.mode === "changeType" && (draftType === "text" || draftType === "date") && formulasReferencing(fieldEditModal.key).length > 0 && (
                <div className="rounded-lg bg-wedly-bg-yellow border border-wedly-gold/40 px-3 py-2">
                  <p className="text-[12px] font-semibold text-wedly-orange">⚠️ 이 컬럼을 쓰는 수식 컬럼이 있습니다</p>
                  <p className="text-[11px] text-wedly-t2 mt-0.5">{formulasReferencing(fieldEditModal.key).map((f) => f.label).join(", ")} — 글자/날짜로 바꾸면 그 수식이 이 컬럼을 더 이상 계산에 쓸 수 없습니다.</p>
                </div>
              )}

              {/* ── 수식 빌더 (type === "formula" 일 때) ── */}
              {fieldEditModal.mode !== "rename" && draftType === "formula" && (
                <div className="rounded-xl border border-wedly-accent/30 bg-wedly-bg-blue/10 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-wedly-accent">🧮 수식 만들기</span>
                    <span className="text-[10px] text-wedly-muted">같은 차수의 컬럼끼리 자동 계산</span>
                  </div>

                  <label className="block">
                    <span className="text-[10px] font-semibold text-wedly-t2">결과 표시</span>
                    <div className="mt-1">
                      <CustomSelect
                        size="sm"
                        value={draftFormulaResult}
                        onChange={(v) => { setDraftFormulaResult(v === "percent" ? "percent" : v === "date" ? "date" : "number"); setFormulaError(""); }}
                        options={[
                          { value: "number", label: "숫자 (원)" },
                          { value: "percent", label: "퍼센트 (%)" },
                          { value: "date", label: "날짜" },
                        ]}
                      />
                    </div>
                  </label>

                  {draftFormulaResult === "date" ? (
                    <DateFormulaEditor
                      value={draftDateFormula}
                      onChange={(next) => { setDraftDateFormula(next); setFormulaError(""); }}
                      fields={fields}
                      editingFieldKey={editingFieldKey}
                    />
                  ) : (
                    <FormulaTermsEditor
                      terms={draftFormula}
                      onChange={(next) => { setDraftFormula(next); setFormulaError(""); }}
                      fields={fields}
                      editingFieldKey={editingFieldKey}
                      columnOptions={formulaColumnOptions}
                      resultFormat={draftFormulaResult}
                    />
                  )}

                  {formulaError && <p className="text-[11px] text-wedly-red px-1">{formulaError}</p>}

                  {/* ── 값에 따라 다른 식(조건별 수식) — ERP(enableConditionalFormula)에서만, 날짜 수식은 제외 ── */}
                  {draftFormulaResult !== "date" && enableConditionalFormula && (() => {
                    // 비교에 고를 수 있는 칸: 정산정보 칸(this tab) + 기본정보 평면 칸(주입)
                    // — 두 그룹을 섹션 헤더("정산 정보" / "기본정보")로 묶어 표시
                    const condTargets = buildCondTargets(fields, editingFieldKey, conditionFieldOptions);
                    const firstTargetKey = condTargets.find((o) => !o.isHeader)?.value ?? "";
                    const newClause = (): DraftClause => ({ leftKey: firstTargetKey, right: { kind: "text" as const, value: "" }, op: "eq" });
                    const newRule = (): DraftCondRule => ({ clauses: [newClause()], combine: "and", formula: [] });
                    const updateClause = (ri: number, ci: number, patch: Partial<DraftClause>) => {
                      setFormulaError("");
                      setDraftConditional((prev) => prev ? { ...prev, rules: prev.rules.map((r, i) => i === ri ? { ...r, clauses: r.clauses.map((c, j) => j === ci ? { ...c, ...patch } : c) } : r) } : prev);
                    };
                    const setCombine = (ri: number, combine: ConditionCombine) => {
                      setDraftConditional((prev) => prev ? { ...prev, rules: prev.rules.map((r, i) => i === ri ? { ...r, combine } : r) } : prev);
                    };
                    const addClause = (ri: number) => {
                      setFormulaError("");
                      setDraftConditional((prev) => prev ? { ...prev, rules: prev.rules.map((r, i) => i === ri ? { ...r, clauses: [...r.clauses, newClause()] } : r) } : prev);
                    };
                    const removeClause = (ri: number, ci: number) => {
                      setFormulaError("");
                      setDraftConditional((prev) => {
                        if (!prev) return prev;
                        const rule = prev.rules[ri];
                        if (rule && rule.clauses.length <= 1) return { ...prev, rules: prev.rules.filter((_, i) => i !== ri) }; // 마지막 절 → 경우 삭제
                        return { ...prev, rules: prev.rules.map((r, i) => i === ri ? { ...r, clauses: r.clauses.filter((_, j) => j !== ci) } : r) };
                      });
                    };
                    const setClauseFormula = (ri: number, next: FormulaTerm[]) => {
                      setFormulaError("");
                      setDraftConditional((prev) => prev ? { ...prev, rules: prev.rules.map((r, i) => i === ri ? { ...r, formula: next } : r) } : prev);
                    };
                    // 기준 칸(leftKey)의 설정 선택지 찾기: 정산 select 칸(this tab) 우선, 없으면 기본정보 주입 칸.
                    //   선택지가 있으면 "직접 입력" 자리를 드롭다운(색 배지)으로, 없으면 자유 입력 유지.
                    const optionsForKey = (key: string): Array<{ value: string; badgeClass?: string }> => {
                      const f = fields.find((x) => x.key === key);
                      if (f && f.type === "select" && Array.isArray(f.options) && f.options.length > 0) {
                        // 정산 select 칸: 값만 제공(평문). optionColors 는 셀에서 인라인 style 로 쓰는 CSS 색상값({bg,text})이라
                        //   className 인 badgeClass 와 형식이 달라 색을 입히지 않는다(현재 정산 select 엔 optionColors 설정 경로도 없음).
                        return f.options.map((v) => ({ value: v }));
                      }
                      const cf = (conditionFieldOptions ?? []).find((x) => x.key === key);
                      return cf?.options ?? [];
                    };
                    return (
                    <div className="rounded-lg border border-wedly-gold/40 bg-wedly-bg-yellow/40 p-2.5 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!draftConditional}
                          onChange={(e) => {
                            setFormulaError("");
                            setDraftConditional(e.target.checked ? { rules: [newRule()] } : null);
                          }}
                          className="w-4 h-4 accent-wedly-accent"
                        />
                        <span className="text-[11px] font-bold text-wedly-orange">값에 따라 다른 식 쓰기</span>
                      </label>
                      <p className="text-[10px] text-wedly-muted px-0.5">한 경우에 조건을 여러 개 걸 수 있습니다(“+ 조건 더하기”). 조건이 2개 이상이면 “모두 만족(그리고)” 또는 “하나라도 만족(또는)”을 고르세요. 어디에도 안 맞으면 위의 기본 식으로 계산하며, 여러 경우는 위에서부터 먼저 맞는 것이 적용됩니다.</p>

                      {draftConditional && (
                        <div className="space-y-2.5">
                          {draftConditional.rules.map((rule, ri) => (
                            <div key={ri} className="rounded-lg border border-wedly-bd bg-white p-2 space-y-2">
                              {rule.clauses.length >= 2 && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] px-0.5">
                                  <span className="font-semibold text-wedly-t2">이 조건들을</span>
                                  <label className="flex items-center gap-1 cursor-pointer select-none">
                                    <input type="radio" name={`combine-${ri}`} checked={rule.combine !== "or"} onChange={() => setCombine(ri, "and")} className="w-3.5 h-3.5 accent-wedly-accent" />
                                    <span className="text-wedly-t1">모두 만족(그리고)</span>
                                  </label>
                                  <label className="flex items-center gap-1 cursor-pointer select-none">
                                    <input type="radio" name={`combine-${ri}`} checked={rule.combine === "or"} onChange={() => setCombine(ri, "or")} className="w-3.5 h-3.5 accent-wedly-accent" />
                                    <span className="text-wedly-t1">하나라도 만족(또는)</span>
                                  </label>
                                </div>
                              )}
                              {rule.clauses.map((clause, ci) => (
                                <div key={ci} className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-wedly-t2 flex-shrink-0 w-8 text-right">{ci === 0 ? "만약" : (rule.combine === "or" ? "또는" : "그리고")}</span>
                                  <div className="min-w-[110px] flex-1">
                                    <CustomSelect
                                      size="sm"
                                      value={clause.leftKey}
                                      onChange={(v) => updateClause(ri, ci, { leftKey: v })}
                                      placeholder="기준 칸"
                                      options={condTargets}
                                    />
                                  </div>
                                  <span className="text-[10px] text-wedly-muted flex-shrink-0">이(가)</span>
                                  <div className="w-[84px] flex-shrink-0">
                                    <CustomSelect
                                      size="sm"
                                      value={clause.right.kind}
                                      onChange={(v) => updateClause(ri, ci, { right: v === "field" ? { kind: "field", key: firstTargetKey } : { kind: "text", value: "" } })}
                                      options={[{ value: "text", label: "직접 입력" }, { value: "field", label: "다른 칸" }]}
                                    />
                                  </div>
                                  {clause.right.kind === "field" ? (
                                    <div className="min-w-[110px] flex-1">
                                      <CustomSelect
                                        size="sm"
                                        value={clause.right.key}
                                        onChange={(v) => updateClause(ri, ci, { right: { kind: "field", key: v } })}
                                        placeholder="비교할 칸"
                                        options={condTargets}
                                      />
                                    </div>
                                  ) : (() => {
                                    const opts = optionsForKey(clause.leftKey);
                                    const cur = clause.right.kind === "text" ? clause.right.value : "";
                                    if (opts.length === 0) {
                                      return (
                                        <input
                                          type="text"
                                          value={clause.right.kind === "text" ? clause.right.value : ""}
                                          onChange={(e) => updateClause(ri, ci, { right: { kind: "text", value: e.target.value } })}
                                          placeholder="예: 하이브"
                                          className="flex-1 min-w-[90px] px-2.5 py-1.5 text-[16px] sm:text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent transition-colors"
                                        />
                                      );
                                    }
                                    // 기존에 적어둔 값이 목록에 없으면 보존(맨 위에 끼움) — 사라지지 않게.
                                    const merged = cur && !opts.some((o) => o.value === cur) ? [{ value: cur }, ...opts] : opts;
                                    return (
                                      <div className="flex-1 min-w-[110px]">
                                        <CustomSelect
                                          size="sm"
                                          value={cur}
                                          onChange={(v) => updateClause(ri, ci, { right: { kind: "text", value: v } })}
                                          placeholder="값 선택"
                                          options={merged.map((o) => ({ value: o.value, label: o.value, badgeClass: o.badgeClass }))}
                                        />
                                      </div>
                                    );
                                  })()}
                                  <div className="w-[150px] flex-shrink-0">
                                    <CustomSelect
                                      size="sm"
                                      value={clause.op}
                                      onChange={(v) => updateClause(ri, ci, { op: v as ConditionOp })}
                                      options={[
                                        { value: "eq", label: "와 같으면" },
                                        { value: "neq", label: "와 다르면" },
                                        { value: "contains", label: "를 포함하면" },
                                        { value: "notContains", label: "를 포함 안 하면" },
                                        // 크기 비교 — 날짜·숫자 칸에서만 판정된다(글자는 매칭 안 함).
                                        { value: "gte", label: "이후(당일 포함)" },
                                        { value: "lte", label: "이전(당일 포함)" },
                                      ]}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeClause(ri, ci)}
                                    className="flex-shrink-0 p-1 rounded text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition-colors"
                                    title={rule.clauses.length <= 1 ? "이 경우 삭제" : "이 조건 삭제"}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => addClause(ri)}
                                className="w-full py-1 rounded-lg border border-dashed border-wedly-accent/50 text-[10px] font-semibold text-wedly-accent hover:bg-wedly-bg-blue transition-colors"
                              >
                                + 조건 더하기
                              </button>
                              <FormulaTermsEditor
                                terms={rule.formula}
                                onChange={(next) => setClauseFormula(ri, next)}
                                fields={fields}
                                editingFieldKey={editingFieldKey}
                                columnOptions={formulaColumnOptions}
                                resultFormat={draftFormulaResult}
                              />
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => { setFormulaError(""); setDraftConditional((prev) => prev ? { ...prev, rules: [...prev.rules, newRule()] } : prev); }}
                            className="w-full py-1.5 rounded-lg border-2 border-dashed border-wedly-gold/50 text-[11px] font-bold text-wedly-orange hover:bg-wedly-bg-yellow transition-colors"
                          >
                            + 다른 경우 추가
                          </button>
                        </div>
                      )}
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
              <button onClick={() => setFieldEditModal(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
              <button onClick={confirmFieldEdit} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 스코어카드 삭제 확인 모달 */}
      {pendingDeleteCardId && (() => {
        const target = scoreCards.find((c) => c.id === pendingDeleteCardId);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setPendingDeleteCardId(null)} />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-wedly-bg-red flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-wedly-red">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-wedly-navy">스코어카드 삭제</h3>
                  <p className="mt-1 text-[12px] text-wedly-muted truncate">{target?.label || pendingDeleteCardId}</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <p className="text-[13px] text-wedly-t2 leading-relaxed">
                  이 카드를 삭제하시겠습니까?
                  <br />
                  <span className="text-wedly-muted">모든 사용자에게 적용되며 되돌릴 수 없습니다.</span>
                </p>
              </div>
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
                <button onClick={() => setPendingDeleteCardId(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
                <button onClick={confirmDeleteCard} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-red rounded-lg hover:brightness-110 transition-colors">삭제</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 정산 컬럼 삭제 확인 모달 */}
      {pendingDeleteFieldKey && (() => {
        const target = fields.find((f) => f.key === pendingDeleteFieldKey);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setPendingDeleteFieldKey(null)} />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-wedly-bg-red flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-wedly-red">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-wedly-navy">정산 컬럼 삭제</h3>
                  <p className="mt-1 text-[12px] text-wedly-muted truncate">{target?.label || pendingDeleteFieldKey}</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <p className="text-[13px] text-wedly-t2 leading-relaxed">
                  이 컬럼을 삭제하시겠습니까?
                  <br />
                  <span className="text-wedly-muted">해당 컬럼의 기존 입력값도 모두 사라지며 되돌릴 수 없습니다.</span>
                </p>
                {(() => {
                  const refs = formulasReferencing(pendingDeleteFieldKey);
                  if (refs.length === 0) return null;
                  return (
                    <div className="mt-2.5 rounded-lg bg-wedly-bg-yellow border border-wedly-gold/40 px-3 py-2">
                      <p className="text-[12px] font-semibold text-wedly-orange">⚠️ 이 컬럼을 쓰는 수식 컬럼 {refs.length}개가 영향을 받습니다</p>
                      <p className="text-[11px] text-wedly-t2 mt-0.5">{refs.map((f) => f.label).join(", ")} — 삭제 후 해당 수식을 다시 확인·수정하세요.</p>
                    </div>
                  );
                })()}
              </div>
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
                <button onClick={() => setPendingDeleteFieldKey(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
                <button onClick={confirmDeleteField} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-red rounded-lg hover:brightness-110 transition-colors">삭제</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 칸 범위(공통↔커스텀) 변경 확인창 — ERP 편집기 전용 */}
      {pendingScopeToggleKey && (() => {
        const target = fields.find((f) => f.key === pendingScopeToggleKey);
        const cur = (target as { scope?: string } | undefined)?.scope === "custom" ? "custom" : "common";
        const toCustom = cur === "common"; // 공통 → 커스텀 으로 바뀌는 방향
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setPendingScopeToggleKey(null)} />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-wedly-bg-green flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-wedly-green">
                    <path d="M3 12h18M3 6h18M3 18h18" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-wedly-navy">칸 범위 변경</h3>
                  <p className="mt-1 text-[12px] text-wedly-muted truncate">{target?.label || pendingScopeToggleKey}</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <p className="text-[13px] text-wedly-t2 leading-relaxed">
                  이 칸을 <b className="text-wedly-t1">{toCustom ? "커스텀 (ERP 전용)" : "공통 (전 앱 공유)"}</b> 으로 바꿀까요?
                  <br />
                  <span className="text-wedly-muted">
                    {toCustom
                      ? "ERP에서만 보이고 하이브·일루아에는 안 보이는 칸이 됩니다. 입력값은 그대로 유지됩니다."
                      : "하이브·일루아 등 다른 앱에서도 함께 보이는 공통 칸이 됩니다. 입력값은 그대로 유지됩니다."}
                  </span>
                </p>
                <p className="mt-2 text-[12px] text-wedly-gold bg-wedly-bg-yellow border border-[var(--wedly-gold)]/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
                  ※ 이 칸은 이 분야의 <b>모든 회사가 함께 쓰는 칸</b>입니다. 범위를 바꾸면 모든 회사 상세창에 똑같이 적용됩니다. (회사마다 따로 두는 설정이 아닙니다)
                </p>
              </div>
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
                <button onClick={() => setPendingScopeToggleKey(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
                <button onClick={confirmScopeToggle} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors">바꾸기</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 차수 칸 "표 노출" 토글 확인창 — ERP 전용 */}
      {pendingExposeKey && (() => {
        const target = fields.find((f) => f.key === pendingExposeKey);
        const on = !!(target as { tableExposed?: boolean } | undefined)?.tableExposed;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setPendingExposeKey(null)} />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-wedly-bg-blue flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-wedly-accent">
                    <path d="M3 9h18M3 15h18M9 3v18" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-wedly-navy">{on ? "표 노출 취소" : "표 노출"}</h3>
                  <p className="mt-1 text-[12px] text-wedly-muted truncate">{target?.label || pendingExposeKey}</p>
                </div>
              </div>
              <div className="px-5 pb-4">
                <p className="text-[13px] text-wedly-t2 leading-relaxed">
                  이 칸을 <b className="text-wedly-t1">경정청구 표</b> 에 {on ? "더 이상 노출하지 않을까요?" : "차수별 줄로 노출할까요?"}
                  <br />
                  <span className="text-wedly-muted">
                    {on
                      ? "표에서 이 차수 칸이 사라집니다. 입력값은 그대로 유지됩니다."
                      : "표에 이 차수 칸이 나타나고, 여러 차수는 줄로 나뉘어 표시·편집됩니다. 입력값은 그대로 유지됩니다."}
                  </span>
                </p>
                <p className="mt-2 text-[12px] text-wedly-gold bg-wedly-bg-yellow border border-[var(--wedly-gold)]/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
                  ※ 이 설정은 이 분야 <b>모든 회사 표</b>에 함께 적용됩니다. (ERP에서만 보이고 하이브·일루아엔 영향 없음)
                </p>
              </div>
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
                <button onClick={() => setPendingExposeKey(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
                <button onClick={confirmToggleExpose} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors">{on ? "노출 취소" : "노출하기"}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 자체 위들리 알림 모달 (브라우저 기본 alert 대체 — 앱 내부 대화상자 의존 없이 자체 완결) */}
      {noticeMsg && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setNoticeMsg(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-wedly-bd bg-white shadow-2xl animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">{noticeMsg.title}</h3>
            </div>
            <div className="px-5 py-4 text-[13px] text-wedly-t2 whitespace-pre-line">{noticeMsg.body}</div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end">
              <button onClick={() => setNoticeMsg(null)} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 줄별 칸 수(rowLayout)에 따라 컬럼을 줄 그룹으로 나눈다.
// 위에서부터 각 줄의 칸 수만큼 채우고, rowLayout 이 모자라면 남는 칸은 한 줄에 1칸씩.
function groupFieldsByRowLayout<T>(items: T[], rowLayout: number[]): { cols: 1 | 2 | 3; items: T[] }[] {
  const groups: { cols: 1 | 2 | 3; items: T[] }[] = [];
  let i = 0;
  for (const raw of rowLayout) {
    if (i >= items.length) break;
    const cols = (raw === 3 ? 3 : raw === 2 ? 2 : 1) as 1 | 2 | 3;
    groups.push({ cols, items: items.slice(i, i + cols) });
    i += cols;
  }
  while (i < items.length) {
    groups.push({ cols: 1, items: [items[i]] });
    i += 1;
  }
  return groups;
}

function TierCard({
  tier, fields, index, canRemove, readOnly, autoFeeKey, autoRevenueVatKey, autoRevenueNetKey, successKey, onChange, onLabelChange, onRemove,
  tierSuffix, onTierSuffixChange, rowLayout = [], conditionValues, renderTierBadge, tierIdDuplicated,
}: {
  tier: TierData;
  fields: FieldDef[];
  index: number;
  canRemove: boolean;
  readOnly: boolean;
  autoFeeKey: string | null;
  autoRevenueVatKey: string | null;
  autoRevenueNetKey: string | null;
  successKey: string | null;
  onChange: (key: string, value: string | number | null) => void;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  /** 모든 차수 카드에 공통 적용되는 꼬리표 (예: "정산", "계약", "환불") */
  tierSuffix?: string;
  /** 어드민이 공통 꼬리표 변경 시 호출 — 한 번 변경하면 모든 차수에 같이 반영 */
  onTierSuffixChange?: (next: string) => void;
  /** 줄별 가로 칸 수 배열 (예: [3,2,1]) — 비어 있으면 모두 한 줄 1칸(세로). 위에서부터 순서대로 채움 */
  rowLayout?: number[];
  /** 조건별 수식의 기준값 — 이 행의 평면 값(row). 없으면 기존(조건 미적용)과 동일 */
  conditionValues?: RowData | null;
  /** 차수 카드 제목 옆에 그릴 것(선택). tierId 는 차수 고유 id — 배열 위치와 달리 삭제·순서변경에 안 흔들린다 */
  renderTierBadge?: (index: number, tierId: string, tierIdDuplicated?: boolean) => ReactNode;
  /** 이 차수의 고유 id 가 형제 차수와 겹치는가(겹치면 받는 쪽이 표시를 감춰 오표시를 막는다) */
  tierIdDuplicated?: boolean;
}) {
  const [open, setOpen] = useState(true);
  // 공통 꼬리표 inline edit
  const [editingSuffix, setEditingSuffix] = useState(false);
  const [suffixDraft, setSuffixDraft] = useState(tierSuffix || "");
  useEffect(() => { setSuffixDraft(tierSuffix || ""); }, [tierSuffix]);

  const success = successKey && typeof tier[successKey] === "number" ? (tier[successKey] as number) : null;

  // 차수 라벨 = ORDINAL_KO[idx] (고정) + " " + tierSuffix (공통, 어드민 편집)
  const ordinal = ORDINAL_KO[index] || `${index + 1}차`;

  const commitSuffix = () => {
    const v = suffixDraft.trim();
    if (v && v !== tierSuffix && onTierSuffixChange) {
      onTierSuffixChange(v);
    } else {
      setSuffixDraft(tierSuffix || "");
    }
    setEditingSuffix(false);
  };

  // 변수 미사용 경고 차단 (옛 onLabelChange 는 이제 안 호출 — 차수별 라벨 편집 폐기)
  void onLabelChange;

  return (
    <div className="rounded-2xl border border-wedly-bd bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-wedly-bd/40 bg-wedly-bg-gray/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button onClick={() => setOpen(!open)} className="flex items-center gap-2 group flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-wedly-muted transition-transform ${open ? "rotate-90" : ""}`}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-black bg-wedly-bg-blue text-wedly-accent">
              {index + 1}
            </span>
          </button>
          {/* 차수 라벨 — "1차"(고정) + 공통 꼬리표(어드민이 한 번 수정하면 모든 차수에 적용) */}
          <h4 className="text-[13px] font-bold text-wedly-navy flex-1 min-w-0 flex items-center gap-1 truncate">
            <span className="flex-shrink-0">{ordinal}</span>
            {editingSuffix && onTierSuffixChange ? (
              <input
                autoFocus
                value={suffixDraft}
                onChange={(e) => setSuffixDraft(e.target.value)}
                onBlur={commitSuffix}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") { setSuffixDraft(tierSuffix || ""); setEditingSuffix(false); }
                }}
                placeholder="예: 정산 / 계약"
                className="min-w-0 flex-1 px-2 py-1 text-[13px] font-bold border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
              />
            ) : (
              <span
                onClick={onTierSuffixChange ? () => setEditingSuffix(true) : undefined}
                className={`min-w-0 truncate ${onTierSuffixChange ? "cursor-pointer hover:text-wedly-accent transition-colors" : ""}`}
                title={onTierSuffixChange ? "클릭하여 공통 꼬리표 수정 — 모든 차수에 같이 적용됩니다" : ""}
              >
                {tierSuffix || ""}{onTierSuffixChange && <span className="ml-0.5 text-wedly-muted/60 text-[10px]">✎</span>}
              </span>
            )}
          </h4>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {renderTierBadge?.(index, tier.id, tierIdDuplicated)}
          {success != null && success > 0 && (
            <span className="text-[11px] font-bold text-wedly-accent tabular-nums">성공보수 {fmtCurrency(success)}원</span>
          )}
          {!readOnly && canRemove && (
            <button onClick={onRemove} className="p-1 rounded-md text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition-colors" title="이 차수 삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
              </svg>
            </button>
          )}
        </div>
      </div>
      {/* 차수 카드 칸 배치 — 줄별 칸 수(rowLayout)대로 가로 묶음. 위에서부터 채우고, 남는 칸은 한 줄 1칸씩. */}
      {open && (
        <div className="p-3 space-y-2">
          {fields.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-wedly-muted">
              컬럼이 없습니다. 위의 &quot;컬럼 편집&quot;에서 추가하세요.
            </div>
          ) : (
            groupFieldsByRowLayout(fields, rowLayout).map((grp, gi) => (
              <div
                key={gi}
                className={`grid ${grp.cols === 3 ? "grid-cols-3" : grp.cols === 2 ? "grid-cols-2" : "grid-cols-1"} gap-2`}
              >
                {grp.items.map((f) => {
                  const isFormula = f.type === "formula";
                  const isDateFormula = isFormula && f.formulaResult === "date";
                  return (
                    <FieldRow
                      key={f.key}
                      label={f.label}
                      type={f.type}
                      value={isDateFormula ? null : (isFormula ? evalFormulaForTier(f, tier, fields, undefined, conditionValues ?? undefined) : (tier[f.key] ?? null))}
                      dateValue={isDateFormula ? evalDateFormulaForTier(f, tier, fields, undefined, conditionValues ?? undefined) : undefined}
                      readOnly={readOnly}
                      isAuto={!isFormula && (autoFeeKey === f.key || autoRevenueVatKey === f.key || autoRevenueNetKey === f.key)}
                      formulaResult={f.formulaResult}
                      options={f.options}
                      optionColors={f.optionColors}
                      onChange={(v) => onChange(f.key, v)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// 수식 "항목(term) 묶음" 편집 UI — 기본 식과 조건 규칙별 식에서 공용으로 재사용.
//   terms/onChange 로만 동작(부모의 어떤 배열이든 편집). 계산 자체는 ui-shared(evalFormulaForTier)가 함.
// 한 항(묶음이면 안쪽까지 재귀) 컬럼 검증 — 컬럼 항은 계산 가능한(숫자·퍼센트·수식) 컬럼을 가리켜야 함.
function checkFormulaTermColumns(t: FormulaTerm, fields: FieldDef[]): string | null {
  if (t.unit === "group") {
    for (const g of t.terms ?? []) {
      const e = checkFormulaTermColumns(g, fields);
      if (e) return e;
    }
    return null;
  }
  if (t.unit === "column") {
    const ref = fields.find((f) => f.key === t.columnKey);
    if (!ref) return "컬럼을 아직 고르지 않은 항목이 있습니다.";
    if (!isNumericFieldType(ref.type)) return "글자·날짜 컬럼은 계산에 쓸 수 없습니다.";
  }
  return null;
}

function FormulaTermsEditor({
  terms, onChange, fields, editingFieldKey, columnOptions, resultFormat, allowGroup = true,
}: {
  terms: FormulaTerm[];
  onChange: (next: FormulaTerm[]) => void;
  fields: FieldDef[];
  editingFieldKey: string | null;
  columnOptions: { value: string; label: string }[];
  resultFormat: FormulaResultFormat;
  allowGroup?: boolean;
}) {
  const addTerm = () => {
    const firstCol = fields.find((f) => isNumericFieldType(f.type) && f.key !== editingFieldKey);
    const term: FormulaTerm = firstCol
      ? { op: "+", unit: "column", columnKey: firstCol.key, value: 0 }
      : { op: "+", unit: "number", value: 0 };
    onChange([...terms, term]);
  };
  // 묶음(괄호) 항 추가 — 안에 기본 항 1개로 시작. (한 겹: 묶음 안엔 묶음 버튼 없음)
  const addGroup = () => {
    const firstCol = fields.find((f) => isNumericFieldType(f.type) && f.key !== editingFieldKey);
    const inner: FormulaTerm = firstCol
      ? { op: "+", unit: "column", columnKey: firstCol.key, value: 0 }
      : { op: "+", unit: "number", value: 0 };
    onChange([...terms, { op: "+", unit: "group", terms: [inner] }]);
  };
  // 반올림 항 추가 — 늘 '천원 단위'로 시작한다. 반올림은 값이 아니라 연산이라
  // 다른 항으로 바뀌지 않는다(바꾸는 길을 열면 컬럼 참조가 지워져 금액이 0원이 된다).
  const addRound = () => onChange([...terms, { op: "round", unit: "number", value: 1000 }]);
  // 내림 항 추가 — 늘 '만원 단위'로 시작한다(경정청구 총 수수료가 만원 내림이라).
  // 반올림과 마찬가지로 다른 항으로 바뀌지 않는다.
  const addFloor = () => onChange([...terms, { op: "floor", unit: "number", value: 10000 }]);
  const updateGroupTerms = (idx: number, nextInner: FormulaTerm[]) =>
    onChange(terms.map((t, i) => (i === idx ? { ...t, terms: nextInner } : t)));
  const updateTerm = (idx: number, patch: Partial<FormulaTerm>) => {
    const firstCol = fields.find((f) => isNumericFieldType(f.type) && f.key !== editingFieldKey);
    onChange(terms.map((t, i) => (i === idx ? applyTermPatch(t, patch, firstCol?.key) : t)));
  };
  const removeTerm = (idx: number) => onChange(terms.filter((_, i) => i !== idx));
  // 반올림은 아래 termText 가 문장으로 따로 풀어 쓴다(기호를 넣어 두면 "≈ 1000" 이 되어
  // '대략 1,000원'으로 정반대로 읽힌다). 그래서 이 표에는 일부러 넣지 않는다.
  const opSym: Record<string, string> = { "+": "＋", "-": "－", "*": "×", "/": "÷" };
  return (
    <>
      <div className="space-y-2">
        {terms.length === 0 ? (
          <p className="text-[11px] text-wedly-muted italic px-1">아래 &quot;+ 항목 추가&quot;로 시작하세요.</p>
        ) : (
          terms.map((t, i) => (
            t.unit === "group" ? (
              <div key={i} className="rounded-lg border-2 border-dashed border-wedly-accent/40 bg-wedly-bg-blue/30 p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {i > 0 ? (
                    <div className="w-[92px] flex-shrink-0">
                      <CustomSelect
                        size="sm"
                        value={t.op}
                        onChange={(v) => updateTerm(i, { op: v as "+" | "-" | "*" | "/" })}
                        options={[
                          { value: "+", label: "＋ 더하기" },
                          { value: "-", label: "－ 빼기" },
                          { value: "*", label: "× 곱하기" },
                          { value: "/", label: "÷ 나누기" },
                        ]}
                      />
                    </div>
                  ) : (
                    <span className="w-[92px] flex-shrink-0 text-[10px] text-wedly-muted px-1">시작 값</span>
                  )}
                  <span className="flex-1 text-[10px] font-bold text-wedly-accent px-1">묶음 (먼저 계산)</span>
                  <button
                    type="button"
                    onClick={() => removeTerm(i)}
                    className="flex-shrink-0 p-1 rounded text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition-colors"
                    title="이 묶음 삭제"
                  >
                    ✕
                  </button>
                </div>
                <div className="pl-2">
                  <FormulaTermsEditor
                    terms={t.terms ?? []}
                    onChange={(next) => updateGroupTerms(i, next)}
                    fields={fields}
                    editingFieldKey={editingFieldKey}
                    columnOptions={columnOptions}
                    resultFormat={resultFormat}
                    allowGroup={false}
                  />
                </div>
              </div>
            ) : isStepOp(t.op) ? (
              <div key={i} className="rounded-lg border border-wedly-bd bg-wedly-bg-gray p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-[92px] flex-shrink-0 text-[10px] font-bold text-wedly-accent px-1">
                    {t.op === "floor" ? "↓ 내림" : "≈ 반올림"}
                  </span>
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={typeof t.value === "number" ? String(t.value) : ""}
                      onChange={(e) => updateTerm(i, { unit: "number", value: e.target.value === "" ? 0 : Number(e.target.value) })}
                      placeholder={t.op === "floor" ? "예: 10000" : "예: 1000"}
                      className="w-full px-2.5 py-1.5 pr-12 text-[16px] sm:text-[13px] tabular-nums border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-wedly-muted text-[12px] pointer-events-none">원 단위</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTerm(i)}
                    className="flex-shrink-0 p-1 rounded text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition-colors"
                    title="이 항목 삭제"
                  >
                    ✕
                  </button>
                </div>
                {/* 저장 버튼을 눌러야 아는 게 아니라, 잘못 놓인 순간 이 줄에서 바로 보이게 한다. */}
                {(() => {
                  const warn = roundTermIssue(terms.slice(0, i + 1), fields, resultFormat);
                  if (warn) return <p className="text-[10px] text-wedly-red px-1">{warn}</p>;
                  return (
                    <p className="text-[10px] text-wedly-muted px-1">
                      {allowGroup ? "여기까지 계산한 값을" : "이 묶음 안에서 여기까지 계산한 값을"} 이 단위로 {t.op === "floor" ? "내립니다(단위 미만은 버립니다)" : "반올림합니다"}.
                    </p>
                  );
                })()}
              </div>
            ) : (
            <div key={i} className="rounded-lg border border-wedly-bd bg-white p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                {i > 0 ? (
                  <div className="w-[92px] flex-shrink-0">
                    <CustomSelect
                      size="sm"
                      value={t.op}
                      onChange={(v) => updateTerm(i, { op: v as "+" | "-" | "*" | "/" })}
                      options={[
                        { value: "+", label: "＋ 더하기" },
                        { value: "-", label: "－ 빼기" },
                        { value: "*", label: "× 곱하기" },
                        { value: "/", label: "÷ 나누기" },
                      ]}
                    />
                  </div>
                ) : (
                  <span className="w-[92px] flex-shrink-0 text-[10px] text-wedly-muted px-1">시작 값</span>
                )}
                <div className="flex-1 min-w-0">
                  <CustomSelect
                    size="sm"
                    value={t.unit}
                    onChange={(v) => updateTerm(i, { unit: v as "column" | "number" | "percent" })}
                    options={[
                      { value: "column", label: "다른 컬럼" },
                      { value: "number", label: "숫자" },
                      { value: "percent", label: "퍼센트(%)" },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeTerm(i)}
                  className="flex-shrink-0 p-1 rounded text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition-colors"
                  title="이 항목 삭제"
                >
                  ✕
                </button>
              </div>
              <div>
                {t.unit === "column" ? (
                  columnOptions.length === 0 ? (
                    <p className="text-[10px] text-wedly-orange px-1">고를 숫자·퍼센트 컬럼이 없습니다. 숫자/퍼센트로 바꾸세요.</p>
                  ) : (
                    <CustomSelect
                      size="sm"
                      value={t.columnKey || ""}
                      onChange={(v) => updateTerm(i, { columnKey: v })}
                      placeholder="컬럼 선택"
                      options={[{ value: "", label: "컬럼 선택" }, ...columnOptions]}
                    />
                  )
                ) : (
                  <div className="relative">
                    <input
                      type="number"
                      value={typeof t.value === "number" ? String(t.value) : ""}
                      onChange={(e) => updateTerm(i, { value: e.target.value === "" ? 0 : Number(e.target.value) })}
                      placeholder={t.unit === "percent" ? "예: 30" : "예: 12"}
                      className={`w-full px-2.5 py-1.5 text-[16px] sm:text-[13px] tabular-nums border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${t.unit === "percent" ? "pr-7" : ""}`}
                    />
                    {t.unit === "percent" && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-wedly-muted text-[12px] pointer-events-none">%</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            )
          ))
        )}
      </div>
      <button
        type="button"
        onClick={addTerm}
        className="w-full py-1.5 rounded-lg border-2 border-dashed border-wedly-accent/40 text-[11px] font-bold text-wedly-accent hover:bg-wedly-bg-blue transition-colors"
      >
        + 항목 추가
      </button>
      {/* 반올림은 '원 단위'를 전제한다. 지금까지의 값이 비율(퍼센트)이면 1,000원 단위로
          반올림하는 순간 0 이 되므로 버튼 자체를 안 띄운다(저장 검증은 그 뒤의 그물). */}
      {resultFormat !== "percent" && terms.length > 0 && chainKind(terms, fields) === "money" && (
        <button
          type="button"
          onClick={addRound}
          className="w-full py-1.5 mt-1 rounded-lg border-2 border-dashed border-wedly-accent/40 text-[11px] font-bold text-wedly-accent hover:bg-wedly-bg-blue transition-colors"
        >
          ≈ 반올림 추가
        </button>
      )}
      {resultFormat !== "percent" && terms.length > 0 && chainKind(terms, fields) === "money" && (
        <button
          type="button"
          onClick={addFloor}
          className="w-full py-1.5 mt-1 rounded-lg border-2 border-dashed border-wedly-accent/40 text-[11px] font-bold text-wedly-accent hover:bg-wedly-bg-blue transition-colors"
        >
          ↓ 내림 추가
        </button>
      )}
      {allowGroup && (
        <button
          type="button"
          onClick={addGroup}
          className="w-full py-1.5 mt-1 rounded-lg border-2 border-dashed border-wedly-accent/40 text-[11px] font-bold text-wedly-accent hover:bg-wedly-bg-blue transition-colors"
        >
          + 묶음(괄호) 추가
        </button>
      )}
      {terms.length > 0 && allowGroup && (() => {
        const operandText = (t: FormulaTerm): string => {
          if (t.unit === "number") return String(t.value ?? 0);
          if (t.unit === "percent") return `${t.value ?? 0}%`;
          if (t.unit === "group") {
            const inner = (t.terms ?? []).map((g, gi) => termText(g, gi)).join(" ");
            return `( ${inner} )`;
          }
          return fields.find((f) => f.key === t.columnKey)?.label ?? "(컬럼)";
        };
        // 반올림은 연산이라 다른 항과 읽는 법이 다르다(value 가 금액이 아니라 반올림 단위(원)).
        // "≈ 1000" 이라고 찍으면 '대략 1,000원'으로 정반대로 읽힌다.
        const termText = (t: FormulaTerm, i: number): string => {
          if (isStepOp(t.op)) {
            const step = typeof t.value === "number" && t.value > 0 ? t.value : 0;
            const 이름 = t.op === "floor" ? "내림" : "반올림";
            // 맨 위 항은 앞선 값이 없어 엔진이 그냥 지나친다.
            if (i === 0) return `→ ${이름}(맨 위라 계산되지 않음)`;
            return step > 0 ? `→ ${step.toLocaleString("ko-KR")}원 단위 ${이름}` : `→ ${이름}(단위 미입력)`;
          }
          return i === 0 ? operandText(t) : `${opSym[t.op] || t.op} ${operandText(t)}`;
        };
        const text = terms.map((t, i) => termText(t, i)).join(" ");
        return (
          <div className="rounded-lg bg-wedly-bg-gray px-2.5 py-2">
            <span className="text-[10px] font-semibold text-wedly-muted">미리보기: </span>
            <span className="text-[12px] font-medium text-wedly-t1">{text}</span>
            <span className="text-[11px] text-wedly-muted"> = {resultFormat === "percent" ? "%" : "원"}</span>
          </div>
        );
      })()}
    </>
  );
}

function FieldRow({
  label, type, value, dateValue, onChange, readOnly = false, isAuto = false, formulaResult, options, optionColors,
}: {
  label: string;
  type: FieldType;
  value: string | number | null;
  dateValue?: string | null;
  onChange: (v: string | number | null) => void;
  readOnly?: boolean;
  isAuto?: boolean;
  formulaResult?: FormulaResultFormat;
  options?: string[];
  optionColors?: Record<string, { bg: string; text: string }>;
}) {
  const [editing, setEditing] = useState(false);
  // select 드롭다운을 카드 밖(화면 위)에 띄우기 위한 앵커·좌표 — 차수카드 overflow-hidden 에 잘리지 않게.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!editing || type !== "select") { setDropPos(null); return; }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dropH = 320;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= dropH ? rect.bottom + 4 : Math.max(8, rect.top - dropH - 4);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 224 - 8));
    setDropPos({ top, left });
  }, [editing, type]);

  const display = useMemo(() => {
    // 수식 컬럼 — 날짜 수식은 dateValue, 숫자/퍼센트는 value. 항상 읽기전용.
    if (type === "formula") {
      if (formulaResult === "date") {
        return <span className="tabular-nums font-medium">{dateValue || "-"}</span>;
      }
      const num = typeof value === "number" ? value : Number(value);
      if (value === null || value === undefined || value === "" || !Number.isFinite(num)) {
        return <span className="text-wedly-muted">-</span>;
      }
      return <span className="tabular-nums font-medium">{formatFormulaResult(num, formulaResult)}</span>;
    }
    if (value === null || value === undefined || value === "") {
      return <span className="text-wedly-muted">{"-"}</span>;
    }
    if (type === "select") {
      const c = optionColors?.[String(value)];
      return (
        <span
          className="inline-block rounded-md px-2 py-0.5 text-[12px] font-medium bg-wedly-bg-gray text-wedly-t1"
          style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
        >{String(value)}</span>
      );
    }
    if (type === "percent" && typeof value === "number") {
      return <span className="tabular-nums font-medium">{value}%</span>;
    }
    if (type === "number" && typeof value === "number") {
      return <span className="tabular-nums font-medium">{fmtCurrency(value)}원</span>;
    }
    return <span>{String(value)}</span>;
  }, [value, dateValue, type, readOnly, isAuto, formulaResult, optionColors]);

  // 수식 컬럼은 사람이 입력하지 않음 (자동 계산 읽기전용)
  const isEditable = !readOnly && !isAuto && type !== "formula";

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-wedly-bd/40 bg-wedly-bg-gray/20 px-3 py-2 min-h-[58px]">
      <div className="text-[11px] text-wedly-muted truncate">
        {label}
        {isAuto && <span className="ml-1 text-[10px] text-wedly-accent">(자동)</span>}
        {type === "formula" && <span className="ml-1 text-[10px] text-wedly-purple">(수식)</span>}
      </div>
      <div ref={anchorRef} className="text-[15px] sm:text-[13px] text-wedly-t1 min-w-0 relative">
        {editing && isEditable ? (
          (type === "select") ? (
            <>
              {display}
              {dropPos && createPortal(
                <div
                  className="fixed z-[9999] w-56 rounded-xl border border-wedly-bd bg-white shadow-[0_8px_24px_-4px_rgba(10,34,68,0.18)]"
                  style={{ top: dropPos.top, left: dropPos.left }}
                >
                  <SelectDropdownBody
                    value={value == null ? "" : String(value)}
                    options={options ?? []}
                    onSave={(next) => { onChange(next); setEditing(false); }}
                    onClose={() => setEditing(false)}
                    optionColors={optionColors}
                  />
                </div>,
                document.body,
              )}
            </>
          ) : (type === "number" || type === "percent") ? (
            <div className="relative">
              <input
                type="number"
                autoFocus
                defaultValue={value === null ? "" : String(value)}
                onBlur={(e) => { onChange(e.target.value === "" ? null : Number(e.target.value)); setEditing(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
                // 숫자 입력 우측의 브라우저 기본 위·아래 화살표 제거 — 깔끔한 디자인 + percent 의 "%" 표시와 겹침 방지
                className={`w-full px-2.5 sm:px-2 py-2 sm:py-1 text-[15px] sm:text-[13px] tabular-nums border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${type === "percent" ? "pr-7" : ""}`}
              />
              {type === "percent" && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-wedly-muted text-[13px] pointer-events-none">%</span>
              )}
            </div>
          ) : type === "date" ? (
            <input
              type="date"
              autoFocus
              ref={(el) => {
                if (el) { try { el.showPicker?.(); } catch { /* unsupported */ } }
              }}
              defaultValue={typeof value === "string" ? value : ""}
              onBlur={(e) => { onChange(e.target.value || ""); setEditing(false); }}
              onChange={(e) => {
                onChange(e.target.value || "");
                setEditing(false);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
              className="w-full px-2.5 sm:px-2 py-2 sm:py-1 text-[15px] sm:text-[13px] border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
            />
          ) : (
            <input
              type="text"
              autoFocus
              defaultValue={value === null ? "" : String(value)}
              onBlur={(e) => { onChange(e.target.value); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
              className="w-full px-2.5 sm:px-2 py-2 sm:py-1 text-[15px] sm:text-[13px] border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
            />
          )
        ) : (
          <div
            onClick={isEditable ? () => setEditing(true) : undefined}
            className={`rounded-md px-1 py-0.5 -mx-1 min-h-[26px] flex items-center ${isEditable ? "cursor-pointer hover:bg-wedly-bg-gray transition-colors" : ""}`}
          >
            {display}
          </div>
        )}
      </div>
    </div>
  );
}
