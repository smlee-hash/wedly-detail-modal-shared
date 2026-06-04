"use client";

// 사람 선택 편집기 — 공용(@wedly/detail-modal-shared). 하이브·ERP·일루아가 공유.
// "팀원"(여러 명) · "팀장/담당자"(한 명) 칸의 사용자 선택. 값은 콤마 구분 문자열로 저장.
// 각 항목은 "이름" 또는 "이름 | 이메일"(동명이인 구분).
//
// 같은 디자인을 single 로 한 명/여러 명만 구분:
//   single=false (팀원): 체크박스 다중 선택 + 완료 버튼
//   single=true  (팀장·담당자): 클릭하면 한 명 선택 후 바로 닫힘 (겉모습·박스·검색칸은 동일)
//
// 사용 앱은 자체 위들리 디자인 토큰(bg-wedly-accent 등)을 globals.css 에 정의해야 함.

import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/cn";
import { parsePersonItem, splitPersonListSafe } from "../lib/person-helpers";

export type MultiPersonEditorProps = {
  /** 현재 값 — 콤마 구분 "이름 | 이메일" 목록 (단일이면 한 명) */
  value: string;
  /** 후보 사용자 명단 — "이름 | 이메일" 형식 권장 */
  userNames: string[];
  /** 선택 확정 시 호출 — 콤마 구분 문자열(단일이면 한 명) */
  onSave: (next: string) => void;
  /** 드롭다운을 닫아야 할 때 호출 */
  onClose: () => void;
  /** true 면 한 명만 선택(클릭 즉시 저장+닫힘). 기본 false(여러 명 체크박스). */
  single?: boolean;
};

export default function MultiPersonEditor({
  value,
  userNames,
  onSave,
  onClose,
  single = false,
}: MultiPersonEditorProps) {
  const initial = splitPersonListSafe(value);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 화면 표시용 헬퍼 — 동명이인 풀 형식이면 이름과 이메일 분리 표시.
  const labelFor = (raw: string): string => parsePersonItem(raw).name;
  const tipFor = (raw: string): string | undefined => parsePersonItem(raw).email || undefined;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && rootRef.current.contains(e.target as Node)) return;
      // 다중(팀원)은 외부 클릭 시 모아둔 선택을 저장. 단일은 클릭 즉시 저장되므로 닫기만.
      if (!single) onSave(Array.from(selected).join(", "));
      onClose();
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [selected, onSave, onClose, single]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // 단일 — 한 명 고르면 바로 저장 + 닫기
  const pickOne = (name: string) => { onSave(name); onClose(); };

  const q = query.replace(/\s/g, "").toLowerCase();
  const filtered = userNames.filter((n) => !q || n.replace(/\s/g, "").toLowerCase().includes(q));

  return (
    <div
      ref={rootRef}
      className="bg-white border border-wedly-accent rounded-lg shadow-lg min-w-[240px] max-h-72 flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 상단 — 검색 + (다중일 때) 선택된 사용자 칩 */}
      <div className="p-2 flex-shrink-0 border-b border-wedly-bd/40">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 찾기"
          autoFocus
          className="block w-full px-3 py-2 text-[16px] sm:text-[12px] min-h-[40px] sm:min-h-[28px] border border-wedly-bd rounded focus:outline-none focus:ring-1 focus:ring-wedly-accent"
        />
        {!single && selected.size > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Array.from(selected).map((n) => (
              <span
                key={n}
                title={tipFor(n)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-wedly-bg-blue text-wedly-accent"
              >
                {labelFor(n)}
                <button type="button" onClick={() => toggle(n)} className="hover:text-wedly-red">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>
      {/* 중단 — 사용자 명단 (이 부분만 스크롤) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
        {/* 단일 — 값 비우기 (한 명만 고르므로 선택 해제용) */}
        {single && (
          <button
            type="button"
            onClick={() => { onSave(""); onClose(); }}
            className="flex w-full items-center gap-2 px-2 py-1 rounded hover:bg-wedly-bg-gray text-left text-[12px] text-wedly-muted"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            비우기
          </button>
        )}
        {filtered.length === 0 ? (
          <p className="text-[11px] text-wedly-muted px-2 py-1.5">일치하는 사용자가 없습니다</p>
        ) : (
          filtered.map((n) => {
            const tip = tipFor(n);
            // 단일 — 클릭하면 한 명 선택 후 닫힘. 현재 값엔 ✓ 표시.
            if (single) {
              const isCurrent = n === value;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickOne(n)}
                  className="flex w-full items-center gap-2 px-2 py-1 rounded hover:bg-wedly-bg-gray text-left text-[12px]"
                >
                  <span className="text-wedly-t1">{labelFor(n)}</span>
                  {tip && (
                    <span className="text-[10px] text-wedly-muted truncate" title={tip}>({tip})</span>
                  )}
                  {isCurrent && <span className="ml-auto text-wedly-accent">✓</span>}
                </button>
              );
            }
            // 다중 — 체크박스 토글
            return (
              <label key={n} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-wedly-bg-gray cursor-pointer text-[12px]">
                <input
                  type="checkbox"
                  checked={selected.has(n)}
                  onChange={() => toggle(n)}
                  className="rounded border-wedly-bd text-wedly-accent focus:ring-wedly-accent/20"
                />
                <span className="text-wedly-t1">{labelFor(n)}</span>
                {tip && (
                  <span className="ml-auto text-[10px] text-wedly-muted truncate" title={tip}>({tip})</span>
                )}
              </label>
            );
          })
        )}
      </div>
      {/* 하단 — 완료/취소 (다중만. 단일은 클릭 즉시 저장이라 불필요) */}
      {!single && (
        <div className="flex gap-1 p-2 border-t border-wedly-bd/60 bg-white flex-shrink-0 rounded-b-lg">
          <button
            type="button"
            onClick={() => { onSave(Array.from(selected).join(", ")); onClose(); }}
            className="flex-1 px-3 py-2 text-[14px] sm:text-[12px] min-h-[40px] sm:min-h-[30px] font-bold text-white bg-wedly-accent rounded hover:brightness-110"
          >
            완료 ({selected.size})
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-[14px] sm:text-[12px] min-h-[40px] sm:min-h-[30px] text-wedly-muted border border-wedly-bd rounded hover:bg-wedly-bg-gray"
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}
