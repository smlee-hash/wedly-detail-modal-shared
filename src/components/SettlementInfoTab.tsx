"use client";

// 경정청구 정산정보 탭 — 정책자금(policy-fund/SettlementInfoTab.tsx) 와 동일한 UX/로직.
// 차이점: 자동 비율 계산에 사용하는 row 키를 경정청구 컬럼에 맞춰 매핑.
//   - 정책자금: 07계약금 / 13컨설턴트수수료 비율
//   - 경정청구: 10총환급금 / 20확정수수료 비율 (없으면 자동 OFF)

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type FieldDef,
  type FieldType,
  type TierData,
  type ScoreCardDef,
  type ScoreCardColor,
  DEFAULT_FIELDS,
  DEFAULT_SCORECARDS,
  SCORECARD_COLOR_CLASSES,
  ORDINAL_KO,
  makeEmptyTier,
  makeScoreCardId,
  parseTiers,
  parseScoreCards,
  relabelTiers,
  generateFieldKey,
} from "../lib/settlement-info-helpers";
import CustomSelect from "./CustomSelect";

type RowData = Record<string, string | number | boolean | null>;

// /api/hive-config 모듈 레벨 캐시 + 탭 다시 보기 자동 갱신
let _hiveConfigPromise: Promise<unknown> | null = null;
function fetchHiveConfigCached(forceRefresh = false): Promise<unknown> {
  if (forceRefresh || !_hiveConfigPromise) {
    _hiveConfigPromise = fetch("/api/hive-config").then((r) => r.json()).catch(() => null);
  }
  return _hiveConfigPromise;
}

function fmtCurrency(n: number | null): string {
  if (n === null || !isFinite(n)) return "";
  return n.toLocaleString("ko-KR");
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

function getReversedFeeRate(row: RowData | null): RateInfo {
  const rawBase = row?.["10총환급금"] ?? null;
  const rawFee = row?.["20확정수수료"] ?? null;
  const baseAmt = toNum(rawBase);
  const feeAmt = toNum(rawFee);
  const base = { baseAmt, feeAmt, rawBase, rawFee };
  if (!row) return { ok: false, rate: null, ratio: null, ...base, reason: "row 없음" };
  if (!baseAmt || baseAmt <= 0) return { ok: false, rate: null, ratio: null, ...base, reason: "계약정보의 '총환급금' 값이 비어있거나 0입니다" };
  if (!feeAmt || feeAmt <= 0) return { ok: false, rate: null, ratio: null, ...base, reason: "계약정보의 '확정수수료' 값이 비어있거나 0입니다" };
  const ratio = feeAmt / baseAmt;
  if (!isFinite(ratio)) return { ok: false, rate: null, ratio: null, ...base, reason: "비율 계산 오류" };
  if (ratio >= 1) return { ok: false, rate: null, ratio: null, ...base, reason: "확정수수료가 총환급금보다 크거나 같습니다" };
  return { ok: true, rate: 1 - ratio, ratio, ...base, reason: "" };
}

export default function SettlementInfoTab({
  rawValue,
  row,
  onSave,
  readOnly = false,
  isAdmin = false,
}: {
  rawValue: unknown;
  row?: RowData | null;
  onSave: (jsonValue: string) => void;
  readOnly?: boolean;
  isAdmin?: boolean;
}) {
  const canEditColumns = !readOnly && isAdmin;
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
  // 스코어카드 정의 — 하이브 자체 저장이 있으면 그걸 우선, 없으면 ERP 값/기본값 fallback
  const [scoreCards, setScoreCards] = useState<ScoreCardDef[]>(DEFAULT_SCORECARDS);
  const [editCards, setEditCards] = useState(false);
  useEffect(() => {
    const apply = (raw: unknown) => {
      const j = raw as { data?: {
        erpSettlementCardLabels?: Record<string, unknown>;
        erpSettlementCardSources?: Record<string, unknown>;
        settlementCards?: unknown;
      } } | null;
      // 1) 하이브에 저장된 settlementCards 가 있으면 최우선 사용
      const localCards = j?.data?.settlementCards;
      const parsed = parseScoreCards(localCards);
      const l = j?.data?.erpSettlementCardLabels;
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

    fetchHiveConfigCached().then(apply).catch(() => { /* 기본값 유지 */ });

    // 1분마다 자동 새로고침 — ERP 관리자가 바꾼 값을 사용자가 새로고침 없이 받아봄
    const interval = setInterval(() => {
      fetchHiveConfigCached(true).then(apply).catch(() => {});
    }, 60000);

    // 탭을 다시 보거나 창에 포커스 올 때 즉시 새로고침
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchHiveConfigCached(true).then(apply).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
  const [editFields, setEditFields] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const rateInfo = useMemo(() => getReversedFeeRate(row || null), [row]);
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

  useEffect(() => {
    fetch("/api/entries/settlement-fields", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.success && Array.isArray(j.data)) {
          // 서버 값을 그대로 신뢰. Hive 화면에서는 WEDLY 매출 컬럼만 시각적으로 제외.
          const visible = (j.data as FieldDef[]).filter((f) => !isHiddenRevenueField(f));
          setFields(visible);
          setTiers(parseTiers(rawValue, visible));
        }
      })
      .catch(() => { /* 빈 화면 그대로 */ })
      .finally(() => setFieldsLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setTiers(parseTiers(rawValue, fields));
  }, [rawValue, fields]);

  const persist = useCallback((next: TierData[]) => {
    onSave(JSON.stringify(next));
  }, [onSave]);

  const persistFields = useCallback(async (next: FieldDef[]) => {
    setSavingFields(true);
    try {
      const res = await fetch("/api/entries/settlement-fields", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const reason = json?.error || `HTTP ${res.status}`;
        console.warn("[persistFields] failed:", reason);
        if (typeof window !== "undefined") {
          window.alert(`정산 컬럼 편집 저장 실패: ${reason}\n새로고침 후 다시 시도해주세요.`);
        }
      }
    } catch (err) {
      console.warn("[persistFields]", err);
      if (typeof window !== "undefined") {
        window.alert("정산 컬럼 편집 저장 중 네트워크 오류가 발생했습니다.");
      }
    } finally {
      setSavingFields(false);
    }
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

  const addTier = useCallback(() => {
    setTiers((prev) => {
      const next = [...prev, makeEmptyTier(prev.length, fields)];
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

  const openAddField = useCallback(() => {
    setDraftLabel("");
    setDraftType("text");
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
    setFieldEditModal({ mode: "changeType", key, type: cur.type });
  }, [fields]);

  const addFieldDef = openAddField;
  const renameFieldDef = openRenameField;

  const changeFieldType = openChangeType;

  // 모달 confirm 처리
  const confirmFieldEdit = useCallback(() => {
    if (!fieldEditModal) return;
    if (fieldEditModal.mode === "add") {
      const label = draftLabel.trim();
      if (!label) return;
      const key = generateFieldKey(label, fields);
      const next = [...fields, { key, label, type: draftType }];
      setFields(next);
      persistFields(next);
      setTiers((prev) => {
        const updated = prev.map((t) => ({ ...t, [key]: draftType === "number" ? null : "" }));
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
      if (newType === fieldEditModal.type) { setFieldEditModal(null); return; }
      const key = fieldEditModal.key;
      const next = fields.map((f) => f.key === key ? { ...f, type: newType } : f);
      setFields(next);
      persistFields(next);
      setTiers((prev) => {
        const updated = prev.map((t) => {
          const v = t[key];
          let conv: string | number | null;
          if (newType === "number") {
            conv = typeof v === "number" ? v : (v === "" || v == null ? null : Number(v) || null);
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
  }, [fieldEditModal, draftLabel, draftType, fields, persistFields, persist]);

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
      const res = await fetch("/api/hive-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settlementCards: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        rollback();
        if (typeof window !== "undefined") {
          window.alert("스코어카드 저장에 실패했습니다. 권한과 네트워크를 확인해주세요.");
        }
        return;
      }
      // 모듈 캐시도 invalidate — 다른 컴포넌트가 옛 값 보는 일 방지
      fetchHiveConfigCached(true).catch(() => {});
    } catch (err) {
      console.warn("[saveCardsToServer]", err);
      rollback();
      if (typeof window !== "undefined") {
        window.alert("스코어카드 저장 중 오류가 발생했습니다.");
      }
    }
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

  // 한 카드의 값 계산 — sum(plus) - sum(minus)
  const sumColumn = useCallback((k: string) => {
    return tiers.reduce((a, t) => a + (typeof t[k] === "number" ? (t[k] as number) : 0), 0);
  }, [tiers]);
  const evalCard = useCallback((card: ScoreCardDef): number => {
    const numberFieldKeys = new Set(fields.filter((f) => f.type === "number").map((f) => f.key));
    const sumIfNumber = (keys: string[]) => keys.reduce((a, k) => a + (numberFieldKeys.has(k) ? sumColumn(k) : 0), 0);
    return sumIfNumber(card.formula.plus) - sumIfNumber(card.formula.minus);
  }, [fields, sumColumn]);

  // 옛 4-카드 totals 계산 제거 — 동적 scoreCards/evalCard 가 모든 카드 값을 계산.
  // cardLabels/cardSources 는 hive-config 마이그레이션 시 settlementCards 미존재 fallback 으로만 사용됨.

  return (
    <div className="space-y-4">
      {/* 합계 카드 — 어드민이 자유롭게 추가/삭제/제목·계산식 변경 가능 */}
      <div className="rounded-2xl border border-wedly-bd bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] font-semibold text-wedly-muted uppercase tracking-wider">전체 합계</p>
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-wedly-muted">{tiers.length}개 차수 · {scoreCards.length}개 카드</p>
            {canEditColumns && (
              <button
                onClick={() => setEditCards(!editCards)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border ${
                  editCards
                    ? "bg-wedly-accent text-white border-wedly-accent"
                    : "bg-white text-wedly-t2 border-wedly-bd hover:bg-wedly-bg-gray"
                }`}
              >
                {editCards ? "✕ 카드 편집 종료" : "⚙ 카드 편집"}
              </button>
            )}
          </div>
        </div>
        <div className={`grid gap-3 ${scoreCards.length <= 2 ? "grid-cols-1 md:grid-cols-2" : scoreCards.length === 3 ? "grid-cols-2 md:grid-cols-3" : "grid-cols-2 md:grid-cols-4"}`}>
          {scoreCards.map((card) => {
            const colors = SCORECARD_COLOR_CLASSES[card.color];
            const value = evalCard(card);
            return (
              <div key={card.id} className={`rounded-xl ${colors.bg} px-3 py-2.5`}>
                <p className={`text-[10px] font-bold ${colors.labelText}`}>{card.label || "(이름 없음)"}</p>
                <p className={`text-[16px] font-black ${colors.valueText} tabular-nums mt-0.5`}>
                  {fmtCurrency(value) || "0"}
                  <span className={`text-[10px] font-bold ${colors.labelText} ml-1`}>원</span>
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
        <div className="text-[11px] text-wedly-muted mt-2 space-y-0.5">
          {rateInfo.ok && rateInfo.rate !== null && rateInfo.ratio !== null ? (
            <p className="text-wedly-green">
              ✓ 컨설턴트 수수료 자동 계산 ON · 계약정보(총환급금 : 확정수수료) 비율 반대 적용 ={" "}
              <span className="font-bold tabular-nums">{Math.round(rateInfo.rate * 100)}%</span>
              <span className="ml-1 text-wedly-muted">
                (총환급금 {fmtCurrency(rateInfo.baseAmt)}원 : 확정수수료 {fmtCurrency(rateInfo.feeAmt)}원
                = {Math.round(rateInfo.ratio * 100)}% → 반대 {Math.round(rateInfo.rate * 100)}%)
              </span>
            </p>
          ) : (
            <div className="text-wedly-orange space-y-0.5">
              <p>⚠ 컨설턴트 수수료 자동 계산 OFF — {rateInfo.reason}</p>
              <p className="text-wedly-muted">계약정보 탭에서 &quot;총환급금&quot;과 &quot;확정수수료&quot;를 number로 입력하면 자동 활성화됩니다.</p>
            </div>
          )}
          {!successField && (
            <p className="text-wedly-red">⚠ 성공보수 컬럼이 식별되지 않습니다. number 타입 + 라벨/키에 &quot;성공보수&quot; 포함 필요.</p>
          )}
          {!consultFeeField && (
            <p className="text-wedly-red">⚠ 컨설턴트 수수료 컬럼이 식별되지 않습니다. number 타입 + 라벨/키에 &quot;컨설턴트&quot;와 &quot;수수료&quot; 둘 다 포함 필요.</p>
          )}
        </div>
      </div>

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
              const numberFields = fields.filter((f) => f.type === "number");
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
                        {fmtCurrency(evalCard(card)) || "0"}원
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
                    <div className="grid grid-cols-2 gap-2">
                      {(["plus", "minus"] as const).map((sign) => (
                        <div key={sign}>
                          <p className="text-[10px] font-bold text-wedly-t2 mb-1">
                            {sign === "plus" ? "+ 합산 컬럼" : "− 차감 컬럼"}
                          </p>
                          <div className="flex flex-wrap gap-1 mb-1.5">
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
                        </div>
                      ))}
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

      {canEditColumns && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setEditFields(!editFields)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors border ${
              editFields
                ? "bg-wedly-accent text-white border-wedly-accent"
                : "bg-white text-wedly-t2 border-wedly-bd hover:bg-wedly-bg-gray"
            }`}
          >
            {editFields ? "✕ 편집 종료" : "⚙ 컬럼 편집"}
          </button>
          {savingFields && <span className="text-[11px] text-wedly-muted">저장 중...</span>}
        </div>
      )}

      {editFields && canEditColumns && (
        <div className="rounded-2xl border-2 border-wedly-accent/30 bg-wedly-bg-blue/10 p-4 space-y-2">
          <p className="text-[12px] font-semibold text-wedly-accent mb-2">
            컬럼 정의 (전체 차수에 적용됨)
            <span className="ml-2 text-[10px] font-normal text-wedly-muted">⋮⋮ 드래그하여 순서 변경</span>
          </p>
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
                <button onClick={() => renameFieldDef(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-accent hover:bg-wedly-bg-blue">이름 변경</button>
                <button onClick={() => changeFieldType(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-purple hover:bg-wedly-bg-purple">타입</button>
                <button onClick={() => removeFieldDef(f.key)} className="text-[11px] px-2 py-1 rounded text-wedly-red hover:bg-wedly-bg-red">삭제</button>
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

      {tiers.map((tier, idx) => (
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
        />
      ))}

      {!readOnly && (
        <button
          onClick={addTier}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-wedly-bd hover:border-wedly-accent hover:bg-wedly-bg-blue/30 transition-colors text-[13px] font-bold text-wedly-muted hover:text-wedly-accent flex items-center justify-center gap-1.5"
        >
          + {ORDINAL_KO[tiers.length] || `${tiers.length + 1}차`} 정산 추가
        </button>
      )}

      {/* 정산 컬럼 편집 모달 — 위들리 디자인 */}
      {fieldEditModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setFieldEditModal(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd overflow-hidden animate-modal-in">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">
                {fieldEditModal.mode === "add" ? "새 컬럼 추가"
                  : fieldEditModal.mode === "rename" ? "컬럼 이름 변경"
                  : "컬럼 타입 변경"}
              </h3>
            </div>
            <div className="px-5 py-4 space-y-3">
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
                      onChange={(v) => setDraftType(v as FieldType)}
                      options={[
                        { value: "text", label: "텍스트" },
                        { value: "date", label: "날짜" },
                        { value: "number", label: "숫자" },
                      ]}
                    />
                  </div>
                </label>
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
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd overflow-hidden animate-modal-in">
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
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
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd overflow-hidden animate-modal-in">
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
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
              </div>
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
                <button onClick={() => setPendingDeleteFieldKey(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
                <button onClick={confirmDeleteField} className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-red rounded-lg hover:brightness-110 transition-colors">삭제</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function TierCard({
  tier, fields, index, canRemove, readOnly, autoFeeKey, autoRevenueVatKey, autoRevenueNetKey, successKey, onChange, onLabelChange, onRemove,
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
}) {
  const [open, setOpen] = useState(true);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(tier.label);

  useEffect(() => { setLabelDraft(tier.label); }, [tier.label]);

  const success = successKey && typeof tier[successKey] === "number" ? (tier[successKey] as number) : null;

  const commitLabel = () => {
    const v = labelDraft.trim();
    if (v && v !== tier.label) onLabelChange(v);
    else setLabelDraft(tier.label);
    setEditingLabel(false);
  };

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
          {editingLabel && !readOnly ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setLabelDraft(tier.label); setEditingLabel(false); }
              }}
              className="flex-1 min-w-0 px-2 py-1 text-[13px] font-bold border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
            />
          ) : (
            <h4
              onClick={readOnly ? undefined : () => setEditingLabel(true)}
              className={`text-[13px] font-bold text-wedly-navy flex-1 min-w-0 truncate ${readOnly ? "" : "cursor-pointer hover:text-wedly-accent transition-colors"}`}
              title={readOnly ? "" : "클릭하여 수정"}
            >
              {tier.label}
            </h4>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
      {open && (
        <div className="divide-y divide-wedly-bd/30">
          {fields.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-wedly-muted">
              컬럼이 없습니다. 위의 &quot;컬럼 편집&quot;에서 추가하세요.
            </div>
          ) : (
            fields.map((f) => (
              <FieldRow
                key={f.key}
                label={f.label}
                type={f.type}
                value={tier[f.key] ?? null}
                readOnly={readOnly}
                isAuto={autoFeeKey === f.key || autoRevenueVatKey === f.key || autoRevenueNetKey === f.key}
                onChange={(v) => onChange(f.key, v)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label, type, value, onChange, readOnly = false, isAuto = false,
}: {
  label: string;
  type: FieldType;
  value: string | number | null;
  onChange: (v: string | number | null) => void;
  readOnly?: boolean;
  isAuto?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  const display = useMemo(() => {
    if (value === null || value === undefined || value === "") {
      return <span className="text-wedly-muted">{readOnly || isAuto ? "-" : "비어 있음"}</span>;
    }
    if (type === "number" && typeof value === "number") {
      return <span className="tabular-nums font-medium">{fmtCurrency(value)}원</span>;
    }
    return <span>{String(value)}</span>;
  }, [value, type, readOnly, isAuto]);

  const isEditable = !readOnly && !isAuto;

  return (
    <div className="flex items-start gap-3 py-2 px-4 min-h-[40px]">
      <div className="w-[120px] sm:w-[160px] flex-shrink-0 text-[12px] text-wedly-muted truncate pt-1">
        {label}
        {isAuto && <span className="ml-1 text-[10px] text-wedly-accent">(자동)</span>}
      </div>
      <div className="flex-1 text-[13px] text-wedly-t1 min-w-0 relative">
        {editing && isEditable ? (
          type === "number" ? (
            <input
              type="number"
              autoFocus
              defaultValue={value === null ? "" : String(value)}
              onBlur={(e) => { onChange(e.target.value === "" ? null : Number(e.target.value)); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
              className="w-full px-2 py-1 text-[13px] tabular-nums border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
            />
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
              className="w-full px-2 py-1 text-[13px] border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
            />
          ) : (
            <input
              type="text"
              autoFocus
              defaultValue={value === null ? "" : String(value)}
              onBlur={(e) => { onChange(e.target.value); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
              className="w-full px-2 py-1 text-[13px] border border-wedly-accent/40 rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white"
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
