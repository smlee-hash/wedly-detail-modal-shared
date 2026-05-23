"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 공통 DetailField 형태 — 각 페이지의 DetailField 와 호환되는 최소 인터페이스.
export interface OrderableField {
  key: string;
}

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
 *
 * 저장 형태:
 *   GET  /api/detail-field-order/{scope}    → { contract: [...], refund: [...], ... }
 *   PUT  /api/detail-field-order/{scope}    body: { tab, order: [...] }  (ADMIN 만)
 *
 * 동작:
 *   - 마운트 시 GET 한 번 호출, 응답이 오기 전까지는 visibleFields 원본 순서 사용
 *   - drag-drop 으로 순서 변경 시 즉시 PUT (낙관적 업데이트: 응답 기다리지 않고 UI 반영)
 *   - 신규 필드(서버 저장 순서에 없는 키)는 원본 순서대로 뒤에 붙임
 */
export function useFieldOrder<T extends OrderableField>(
  scope: string,
  tabKey: string,
  visibleFields: T[],
  canEdit: boolean = false,
) {
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const apiUrlRef = useRef<string>(`/api/detail-field-order/${scope}`);
  apiUrlRef.current = `/api/detail-field-order/${scope}`;

  // 마운트 시 서버에서 fetch
  useEffect(() => {
    let canceled = false;
    fetch(apiUrlRef.current, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (canceled) return;
        if (j?.success && j.data && typeof j.data === "object") {
          const arr = j.data[tabKey];
          if (Array.isArray(arr)) {
            setFieldOrder(arr.filter((k): k is string => typeof k === "string"));
          }
        }
      })
      .catch(() => { /* 네트워크 실패 → 원본 순서 사용 */ });
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
      setFieldOrder(next); // 낙관적 업데이트
      // 비동기 PUT — 실패해도 UI 는 유지 (다음 새로고침 시 서버 값으로 정렬)
      fetch(apiUrlRef.current, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab: tabKey, order: next }),
      }).catch((err) => console.warn("[useFieldOrder PUT]", err));
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

  const resetOrder = useCallback(() => {
    if (!canEdit) return;
    if (!confirm("컬럼 순서를 초기 상태로 되돌리시겠습니까? (모든 사용자에게 적용됩니다.)")) return;
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
  };
}
