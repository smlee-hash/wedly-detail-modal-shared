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

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  HistoryPanel,
  timeAgo,
  type HistoryAdapter,
  type UnifiedComment,
  type SectionPanelProps,
  type ScoreCardDef,
  COMMON_BASIC_FIELD_SPECS,
  useDetailLoadState,
  checkApiResult,
  makePersistError,
  failureReason,
} from "@wedly/ui-shared";
import SettlementInfoTabBase from "./SettlementInfoTab";
import { GOV_SUB_TABS, resolveGovSubTab, type GovSubTab } from "./gov-subtab";
import { resolveHistoryGate } from "./gov-history-gate";
import { buildGovEvalBase } from "./gov-eval-context";

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
  /** 값 저장(editable일 때만). */
  savePolicyField?: (entryId: string, key: string, value: string | number | boolean | null) => Promise<void>;
  /** 새 계약 생성(editable일 때만). 없으면 자동 생성 불가. */
  createContract?: (primaryRow: Record<string, unknown>) => Promise<string>;
  /** 이 그룹 행 중 정책 행만 골라내기(도메인 키 차이 흡수). */
  filterPolicyRows: (rows: SectionPanelProps["rows"]) => SectionPanelProps["rows"];
  /** 조건부 수식 기준 칸을 가져올 기본정보 도메인(ERP가 "government-subsidy" 등 주입). */
  conditionBasicDomain?: string;
};

type SubTab = GovSubTab;
const SUB_TABS = GOV_SUB_TABS;

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
    /** true 면 히스토리만 그린다(넓은 2분할 오른쪽 레일용). 미전달이면 기존 전체 패널 그대로. */
    historyOnly?: boolean;
    /** 숨길 하위 탭 키(예: 히스토리를 오른쪽으로 옮길 때 ["history"]). 미전달이면 불변. */
    hiddenSubTabs?: string[];
    /** true 면 이 패널의 하위 탭 줄을 그리지 않는다 — 바깥(오른쪽 한 줄)으로 끌어올렸을 때. 미전달 불변. */
    hideSubTabBar?: boolean;
    /** 바깥이 하위 탭을 지정할 때. 제어 여부는 onSubTabChange 가 함수일 때만 — 이 값만 오면 무시(기존 앱 불변). */
    subTab?: string;
    /** 함수로 오면 클릭을 바깥에 알린다. hideSubTabBar 와 함께면 제어 모드. 미전달이면 내부 상태만. */
    onSubTabChange?: (t: string) => void;
  }) {
    const policyRows = config.filterPolicyRows(rows);
    // 항목이 없어도 히스토리로 먼저 연다 — 첫 메모 입력칸(또는 안내)이 바로 보이게(재작업 2026-07-15).
    // 기존엔 항목 없으면 '계약정보'로 열려, 첫 메모 입력이 가능한지 알기 어려웠다.
    const [subTab, setSubTab] = useState<SubTab>("history");
    // 제어 모드 = 콜백이 있고 + 바깥이 탭 줄을 그린다(hideSubTabBar). 판정 근거는 resolveGovSubTab 주석.
    const isSubTabControlled = typeof onSubTabChange === "function" && hideSubTabBar === true;
    // ★ 폴백은 prop 을 넘긴 쪽에서만 — 미전달이면 그대로(기존 앱 렌더 불변).
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
    const [sel, setSel] = useState(0);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [userName, setUserName] = useState("");
    const createdIdRef = useRef<string>("");
    const createPromiseRef = useRef<Promise<string> | null>(null);

    useEffect(() => {
      adapter.api.currentUser().then((u) => setUserName(u?.name ?? "")).catch(() => {});
    }, [adapter]);

    const anchorKey = String(primaryRow["15사업자번호"] ?? primaryRow["04사업자번호"] ?? primaryRow["_id"] ?? "");
    useEffect(() => {
      createdIdRef.current = "";
      createPromiseRef.current = null;
    }, [anchorKey]);

    const idx = policyRows.length ? Math.min(sel, policyRows.length - 1) : -1;
    const entry = idx >= 0 ? policyRows[idx] : null;
    const entryId = entry?.entryId ?? "";
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

    async function ensureEntryId(): Promise<string> {
      if (entryId) return entryId;
      if (createdIdRef.current) return createdIdRef.current;
      if (!config.createContract) throw new Error("이 앱에서는 새 계약을 만들 수 없습니다.");
      if (!createPromiseRef.current) {
        createPromiseRef.current = config
          .createContract(primaryRow)
          .then((id) => {
            createdIdRef.current = id;
            return id;
          })
          .catch((e) => {
            createPromiseRef.current = null;
            throw e;
          });
      }
      return createPromiseRef.current;
    }

    async function saveOrCreate(key: string, value: string | number | boolean | null) {
      if (!config.savePolicyField) return;
      setErr(null);
      try {
        const id = await ensureEntryId();
        await config.savePolicyField(id, key, value);
        onSaved?.();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "저장에 실패했습니다.");
      }
    }

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

    const onSaveFor = (key: string) => (canEditValues ? (json: string) => saveOrCreate(key, json) : () => {});
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
    };

    return (
      <div className="flex flex-col">
        {err && (
          <div role="alert" className="mx-4 mt-3 rounded-xl border border-wedly-bd-red bg-wedly-bg-red px-3 py-2 text-[13px] text-wedly-red-ink">
            {err}
          </div>
        )}

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
            {canEditValues && config.createContract && !historyOnly && (
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
          {historyOnly && policyRows.length > 1 && (
            <div className="px-4 pt-3 text-[11px] font-semibold text-wedly-t2 break-keep">
              「계약 {idx + 1}」의 기록 — 위 알약으로 다른 계약의 기록을 볼 수 있어요
            </div>
          )}
          {shownSubTab === "history" && (
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
                    const id = await ensureEntryId();
                    const res = await fetch(config.commentsPath(id), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ text }),
                    });
                    if (!res.ok) throw new Error("저장에 실패했습니다.");
                    onSaved?.();
                  }}
                />
              ) : (
                <div className="py-12 text-center text-[13px] text-wedly-muted">아직 남겨진 히스토리가 없습니다.</div>
              )}
            </div>
          )}

          {shownSubTab === "contract" && (
            <div className="p-4">
              <SettlementInfoTab {...settlementCommon} rawValue={data["계약정보_차수"] ?? null} onSave={onSaveFor("계약정보_차수")} storagePrefix="contract" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => config.renderTierBadge!({ entryId, kind: "contract", index: i, tierId: tid, tierIdDuplicated: dup }) : undefined} fieldsApiPath={config.contractFieldsPath} sectionTitle="계약정보" />
            </div>
          )}

          {shownSubTab === "settlement" && (
            <div className="p-4">
              <SettlementInfoTab {...settlementCommon} rawValue={data["정산정보"] ?? null} onSave={onSaveFor("정산정보")} storagePrefix="settlement" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => config.renderTierBadge!({ entryId, kind: "settlement", index: i, tierId: tid, tierIdDuplicated: dup }) : undefined} fieldsApiPath={config.settlementFieldsPath} sectionTitle="정산정보" />
            </div>
          )}

          {shownSubTab === "refund" && (
            <div className="p-4">
              <SettlementInfoTab {...settlementCommon} rawValue={data["환불정보_차수"] ?? null} onSave={onSaveFor("환불정보_차수")} storagePrefix="refund" renderTierBadge={config.renderTierBadge ? (i: number, tid: string, dup?: boolean) => config.renderTierBadge!({ entryId, kind: "refund", index: i, tierId: tid, tierIdDuplicated: dup }) : undefined} fieldsApiPath={config.refundFieldsPath} sectionTitle="환불정보" />
            </div>
          )}

          {shownSubTab === "meetings" && (
            <div className="p-4">
              {/* 미팅 부품은 앱이 주입한다 — 안 넣은 앱에서 그대로 그리면 상세창이 통째로 흰 화면이 된다. */}
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
