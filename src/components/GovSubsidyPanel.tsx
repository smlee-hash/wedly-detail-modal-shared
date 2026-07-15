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

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  HistoryPanel,
  timeAgo,
  type HistoryAdapter,
  type UnifiedComment,
  type SectionPanelProps,
  type ScoreCardDef,
} from "@wedly/ui-shared";
import SettlementInfoTabBase from "./SettlementInfoTab";
import { resolveHistoryGate } from "./gov-history-gate";

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
  /** 히스토리 출처 라벨: "erp" | "hive" | "illua". */
  ownSource: string;
  /** ERP만 조건부 수식 UI. */
  enableConditionalFormula?: boolean;
  /** 조건부 수식 옵션(현재 행 기준). ERP만 제공. */
  conditionFieldOptions?: (row: Record<string, unknown>) => unknown;
  /** 히스토리 댓글 경로. */
  commentsPath: (entryId: string) => string;
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
};

type SubTab = "history" | "contract" | "settlement" | "refund" | "meetings";
const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "history", label: "히스토리" },
  { key: "contract", label: "계약정보" },
  { key: "settlement", label: "정산정보" },
  { key: "refund", label: "환불정보" },
  { key: "meetings", label: "미팅정보" },
];

async function commentsJson(res: Response): Promise<UnifiedComment[]> {
  // 앱별 댓글 응답 형태 차이 흡수: ERP={data:[...]}, 일루아={data:{illuaComments:[...]}},
  // 하이브 읽기전용={data:[...]}, 그 외 {data:{comments:[...]}} / {data:{hiveComments:[...]}}.
  const j = await res.json().catch(() => null);
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
  function GovSubsidyPanel({ rows, primaryRow, isAdmin, onSaved, adapter }: SectionPanelProps) {
    const policyRows = config.filterPolicyRows(rows);
    const [subTab, setSubTab] = useState<SubTab>(() => (policyRows.length ? "history" : "contract"));
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

    // 값 편집 가능 = 앱이 편집 허용 && 현재 사용자가 관리자. (하이브는 editable=false → 항상 보기 전용)
    const canEditValues = config.editable && isAdmin;
    // 히스토리 게이트 — 항목 없어도 편집 가능하면 첫 메모 입력(저장 시 항목 자동생성). 보기 전용은 기존대로 입력 없음.
    // 식별값 키 = 각 앱 createContract prefill(ERP policy-rows·일루아 illua-gov-panel)이 읽는 사업자번호/연락처 키 합집합 —
    // 둘 다 없으면 자동생성 항목이 이 회사 상세와 안 묶이는 고아가 되므로 composer 대신 안내(needAnchor).
    const hasAnchorIdentity = ["15사업자번호", "04사업자번호", "04연락처", "03대표연락처"].some(
      (k) => String(primaryRow[k] ?? "").trim() !== "",
    );
    const historyGate = resolveHistoryGate({ entryId, canEditValues, hasCreateContract: Boolean(config.createContract), hasAnchorIdentity });
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

    const onSaveFor = (key: string) => (canEditValues ? (json: string) => saveOrCreate(key, json) : () => {});
    const condOpts = config.enableConditionalFormula && config.conditionFieldOptions ? config.conditionFieldOptions(data) : undefined;

    // 계약/정산/환불 공통 prop — 공용 저장소 설정·합계카드로 3앱 동일 렌더.
    // row: 기본정보 행(primaryRow) + 정산 행(data) 합산 — 정산 키가 우선(덮어씀).
    //   conditionValues 는 row 에서 오므로, 조건부 수식 기준칸(담당사 등 기본정보 칸)을 조건에 쓸 수 있음(ERP 동일).
    const settlementCommon: Record<string, unknown> = {
      row: { ...(primaryRow as Record<string, unknown>), ...(data ?? {}) },
      isAdmin: canEditValues,
      readOnly: !canEditValues,
      allowStructureEdit: config.allowStructureEdit && isAdmin,
      columnScopeMode: config.allowStructureEdit ? "erp" : "off",
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
          <div role="alert" className="mx-4 mt-3 rounded-xl border border-wedly-bd-red bg-wedly-bg-red px-3 py-2 text-[13px] text-wedly-red">
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
                  i === idx ? "bg-wedly-bg-blue text-wedly-accent" : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2"
                }`}
              >
                계약 {i + 1}
              </button>
            ))}
            {canEditValues && config.createContract && (
              <button
                onClick={addContract}
                disabled={busy}
                className="ml-1 flex-shrink-0 rounded-full px-2.5 py-1 text-[12px] text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t1 disabled:opacity-50"
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
              onClick={() => setSubTab(key)}
              className={`flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                subTab === key ? "bg-wedly-bg-blue text-wedly-accent" : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2"
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
                  isAdmin={config.editable ? isAdmin : false}
                  ownSource={config.ownSource}
                  enableImagePaste={!config.commentsReadOnly}
                  readOnly={config.commentsReadOnly === true}
                  timeFormatter={timeAgo}
                  pollingIntervalMs={5000}
                  shareEnabled={false}
                  hideCategories
                />
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
              ) : historyGate === "needAnchor" ? (
                <div className="py-12 text-center text-[13px] text-wedly-muted">
                  기본정보에 사업자번호 또는 연락처를 입력하면 히스토리를 남길 수 있습니다.
                </div>
              ) : (
                <div className="py-12 text-center text-[13px] text-wedly-muted">아직 남겨진 히스토리가 없습니다.</div>
              )}
            </div>
          )}

          {subTab === "contract" && (
            <div className="p-4">
              <SettlementInfoTab {...settlementCommon} rawValue={data["계약정보_차수"] ?? null} onSave={onSaveFor("계약정보_차수")} storagePrefix="contract" fieldsApiPath={config.contractFieldsPath} sectionTitle="계약정보" />
            </div>
          )}

          {subTab === "settlement" && (
            <div className="p-4">
              <SettlementInfoTab {...settlementCommon} rawValue={data["정산정보"] ?? null} onSave={onSaveFor("정산정보")} storagePrefix="settlement" fieldsApiPath={config.settlementFieldsPath} sectionTitle="정산정보" />
            </div>
          )}

          {subTab === "refund" && (
            <div className="p-4">
              <SettlementInfoTab {...settlementCommon} rawValue={data["환불정보_차수"] ?? null} onSave={onSaveFor("환불정보_차수")} storagePrefix="refund" fieldsApiPath={config.refundFieldsPath} sectionTitle="환불정보" />
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
        <div className="rounded-lg border border-wedly-bd-green bg-wedly-bg-green px-3 py-2 text-[13px] text-wedly-green">
          저장했습니다. 히스토리를 불러오는 중…
        </div>
      )}
      {err && <div role="alert" className="rounded-lg border border-wedly-bd-red bg-wedly-bg-red px-3 py-2 text-[13px] text-wedly-red">{err}</div>}
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
