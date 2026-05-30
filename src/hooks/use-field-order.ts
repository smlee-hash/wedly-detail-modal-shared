"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 공통 DetailField 형태 — 각 페이지의 DetailField 와 호환되는 최소 인터페이스.
export interface OrderableField {
  key: string;
}

/** 앱이 넘기는 위들리 확인/알림창(묶음형). 미지정 시 브라우저 기본창으로 대체(주입 권장). */
export type FieldOrderDialog = {
  confirm: (opts: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>;
  alert?: (opts: { title: string; message?: string }) => Promise<void> | void;
};

/**
 * DetailModal 의 섹션별 컬럼 순서를 server (JsonCache) 에 저장 + 드래그앤드롭으로 변경.
 *
 * 모든 사용자가 같은 row 를 공유 — 한 사용자가 변경하면 다른 사용자도 새로고침 시 동일 순서를 본다.
 *
 * @param scope - 페이지 식별자 (예: "policy-fund", "tax-amendment", "labor-subsidy")
 * @param tabKey - 섹션 식별자 (예: "contract", "refund", "files", "settlement")
 * @param visibleFields - 현재 노출되는 필드 배열 (CONTRACT_FIELDS 등)
 * @param canEdit - 관리자 여부. false 면 drag-drop 핸들러가 no-op 으로 동작 (UI 만 readonly).
 *                  서버는 별도로 ADMIN 권한 체크 — 우회 시도해도 403 반환.
 * @param dialog - 위들리 확인/알림창(묶음형). 저장 실패 안내·순서 초기화 확인에 사용.
 *                 미지정 시 브라우저 기본창으로 대체(앱에서는 반드시 주입 권장).
 *
 * 저장 형태:
 *   GET  /api/detail-field-order/{scope}    → { contract: [...], refund: [...], ... }
 *   PUT  /api/detail-field-order/{scope}    body: { tab, order: [...] }  (ADMIN 만)
 *
 * 동작:
 *   - 마운트 시 GET 한 번 호출, 응답이 오기 전까지는 visibleFields 원본 순서 사용
 *   - drag-drop 으로 순서 변경 시 즉시 PUT (낙관적 업데이트). 실패하면 마지막 저장 성공 순서로 되돌리고 안내.
 *   - 신규 필드(서버 저장 순서에 없는 키)는 원본 순서대로 뒤에 붙임
 */
export function useFieldOrder<T extends OrderableField>(
  scope: string,
  tabKey: string,
  visibleFields: T[],
  canEdit: boolean = false,
  dialog?: FieldOrderDialog,
) {
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const apiUrlRef = useRef<string>(`/api/detail-field-order/${scope}`);
  apiUrlRef.current = `/api/detail-field-order/${scope}`;
  // 마지막으로 저장 성공한 순서 — 빠른 연속 드래그에서 꼬임 방지용(실패 시 이 값으로 복원)
  const lastSavedOrderRef = useRef<string[]>([]);
  // dialog 최신값을 ref 로 — persistOrder/resetOrder 의 useCallback 의존성을 안정화
  const dialogRef = useRef<FieldOrderDialog | undefined>(dialog);
  dialogRef.current = dialog;

  // 서버에서 컬럼 순서를 받아오는 단계인지 — 응답 전엔 화면 그리기를 보류해 깜빡임 차단용
  const [isOrderLoaded, setIsOrderLoaded] = useState(false);

  // 마운트 시 서버에서 fetch
  useEffect(() => {
    let canceled = false;
    setIsOrderLoaded(false);
    fetch(apiUrlRef.current, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (canceled) return;
        if (j?.success && j.data && typeof j.data === "object") {
          const arr = j.data[tabKey];
          if (Array.isArray(arr)) {
            const cleaned = arr.filter((k): k is string => typeof k === "string");
            setFieldOrder(cleaned);
            lastSavedOrderRef.current = cleaned; // 서버에 저장된 값이 last-known-good
          }
        }
      })
      .catch(() => { /* 네트워크 실패 → 원본 순서 사용 */ })
      .finally(() => {
        if (!canceled) setIsOrderLoaded(true);
      });
    return () => { canceled = true; };
  }, [scope, tabKey]);

  const orderedFields = useMemo<T[]>(() => {
    if (fieldOrder.length === 0) return visibleFields;
    const allowedMap = new Map(visibleFields.map((f) => [f.key, f]));
    const result: T[] = [];
    const used = new Set<string>();
    for (const key of fieldOrder) {
      const f = allowedMap.get(key);
      if (f) {
        result.push(f);
        used.add(key);
      }
    }
    for (const f of visibleFields) {
      if (!used.has(f.key)) result.push(f);
    }
    return result;
  }, [visibleFields, fieldOrder]);

  const persistOrder = useCallback(
    (next: string[]) => {
      // 마지막 저장 성공 순서 보존 — 두 번째 드래그 후 첫 번째 실패해도 두 번째 적용 순서가 유지
      const lastKnownGood = lastSavedOrderRef.current;
      setFieldOrder(next); // 낙관적 업데이트 (UI 즉시 반영)
      // 응답 검사 — 200 이 아니면 마지막 저장 성공 순서로 복원 + 사용자에게 안내
      (async () => {
        try {
          const res = await fetch(apiUrlRef.current, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tab: tabKey, order: next }),
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => null);
            const errMsg = errJson?.error || `HTTP ${res.status}`;
            if (typeof console !== "undefined") console.error("[useFieldOrder persistOrder] PUT 실패 — 옛 순서 복원", errMsg);
            setFieldOrder(lastKnownGood);
            void dialogRef.current?.alert?.({ title: "저장 실패", message: `컬럼 위치를 저장하지 못했습니다. 원인: ${errMsg}` });
            return;
          }
          // 저장 성공 — 이 순서를 새로운 last-known-good 으로
          lastSavedOrderRef.current = next;
        } catch (err) {
          setFieldOrder(lastKnownGood);
          const msg = err instanceof Error ? err.message : "연결 실패";
          console.warn("[useFieldOrder PUT]", err);
          void dialogRef.current?.alert?.({ title: "저장 오류", message: `컬럼 위치 저장 중 오류: ${msg}` });
        }
      })();
    },
    [tabKey],
  );

  const handleDragStart = useCallback(
    (key: string) => (e: React.DragEvent) => {
      if (!canEdit) return;
      setDraggingKey(key);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", key);
      } catch {
        /* Safari */
      }
    },
    [canEdit],
  );

  const handleDragOver = useCallback(
    (key: string) => (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverKey(key);
    },
    [canEdit],
  );

  const handleDragLeave = useCallback(() => {
    if (!canEdit) return;
    setDragOverKey(null);
  }, [canEdit]);

  const handleDrop = useCallback(
    (targetKey: string) => (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      const from = draggingKey;
      setDraggingKey(null);
      setDragOverKey(null);
      if (!from || from === targetKey) return;
      const cur = orderedFields.map((f) => f.key);
      const fromIdx = cur.indexOf(from);
      const toIdx = cur.indexOf(targetKey);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...cur];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      persistOrder(next);
    },
    [canEdit, draggingKey, orderedFields, persistOrder],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingKey(null);
    setDragOverKey(null);
  }, []);

  const resetOrder = useCallback(async () => {
    if (!canEdit) return;
    const d = dialogRef.current;
    const ok = d
      ? await d.confirm({ title: "순서 초기화", message: "컬럼 순서를 초기 상태로 되돌리시겠습니까? (모든 사용자에게 적용됩니다.)" })
      : (typeof window !== "undefined" ? window.confirm("컬럼 순서를 초기 상태로 되돌리시겠습니까? (모든 사용자에게 적용됩니다.)") : false);
    if (!ok) return;
    persistOrder([]);
  }, [canEdit, persistOrder]);

  return {
    orderedFields,
    draggingKey,
    dragOverKey,
    canEdit,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    resetOrder,
    hasCustomOrder: fieldOrder.length > 0,
    isOrderLoaded,
  };
}
