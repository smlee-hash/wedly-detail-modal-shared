"use client";

// 선택 컬럼 드롭다운 공용 본문 — 표 셀과 상세 모달이 같이 사용한다.
// AGENTS.md §5-4 (cell-detail-parity): 두 곳의 UI 가 100% 동일해야 함.
// 부모는 어디에 띄울지(absolute / portal) 만 결정하고 이 안에 SelectDropdownBody 를 넣는다.
//
// 옵션 시스템(추가/삭제/색상 변경)은 콜백으로 받아 각 앱이 자기 저장소(localStorage·서버)와 연결한다.
// 예: 하이브는 addCustomOption(fieldKey, opt) → localStorage + /api/hive-config PUT

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";

export type SelectDropdownColor = { bg: string; text: string };

export type SelectDropdownColorFamily = {
  name: string;
  shades: Array<{
    shade: string;
    bg: string;
    text: string;
    bgHex: string;
  }>;
};

export type SelectDropdownBodyProps = {
  /** 현재 선택된 값 (빈 문자열이면 선택 안 됨) */
  value: string;
  /** 부모가 내려주는 옵션 목록 (정적 + 사용자 추가) */
  options: string[];
  /** 사용자가 옵션을 선택하거나 비우기를 눌렀을 때 호출 */
  onSave: (next: string) => void;
  /** 드롭다운을 닫아야 할 때 호출 */
  onClose: () => void;

  /** 사용자가 새 옵션을 추가했을 때 — 호스트 앱이 자기 저장소에 영구 저장 */
  onAddOption?: (opt: string) => void;
  /** 옵션 삭제 — 호스트 앱이 자기 저장소에서 제거 */
  onDeleteOption?: (opt: string) => void;
  /** 옵션 색상 변경 — 호스트 앱이 자기 저장소에 색상 매핑 저장 */
  onSetColor?: (opt: string, color: SelectDropdownColor) => void;
  /** 옵션 → CSS class (색상 칩) — 호스트 앱이 자기 색상 매핑에서 lookup */
  getColorClass?: (opt: string) => string;
  /** 색상 팔레트 (톤별) — 미제공 시 색상 변경 버튼 숨김 */
  colorFamilies?: SelectDropdownColorFamily[];
  /** 옵션 추가/삭제/색상 변경 시 다른 셀에도 즉시 반영할 글로벌 이벤트 이름 (window dispatch) */
  globalChangeEvent?: string;
  /** 옵션 삭제 버튼 노출 여부 (어드민만 보이게 하려면 false) — 기본 false 안전 */
  allowDelete?: boolean;
};

export default function SelectDropdownBody({
  value,
  options: initialOptions,
  onSave,
  onClose,
  onAddOption,
  onDeleteOption,
  onSetColor,
  getColorClass,
  colorFamilies,
  globalChangeEvent,
  allowDelete = false,
}: SelectDropdownBodyProps) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState(initialOptions);
  const [colorPickerOpt, setColorPickerOpt] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedOnceRef = useRef(false);
  // 옵션 색상이 외부에서 바뀌었을 때(같은 화면 다른 셀) 자기 자신도 다시 그리기 위한 트리거
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!focusedOnceRef.current) {
      focusedOnceRef.current = true;
      inputRef.current?.focus();
    }
  }, []);

  // 부모 옵션 갱신 — 로컬 추가분은 보존하면서 합치기
  useEffect(() => {
    setOptions((prev) => {
      const parentSet = new Set(initialOptions);
      const allCovered = prev.every((o) => parentSet.has(o));
      if (allCovered) return initialOptions;
      const merged = [...initialOptions];
      for (const o of prev) {
        if (!parentSet.has(o)) merged.push(o);
      }
      return merged;
    });
  }, [initialOptions]);

  // 다른 셀에서 색상·옵션이 바뀌면 같이 갱신
  useEffect(() => {
    if (!globalChangeEvent) return;
    const h = () => forceRerender((n) => n + 1);
    window.addEventListener(globalChangeEvent, h);
    return () => window.removeEventListener(globalChangeEvent, h);
  }, [globalChangeEvent]);

  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );

  const fireGlobal = () => {
    if (globalChangeEvent && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(globalChangeEvent));
    }
  };

  const handleAddNew = () => {
    const trimmed = search.trim();
    if (!trimmed || options.includes(trimmed)) {
      inputRef.current?.focus();
      return;
    }
    onAddOption?.(trimmed);
    setOptions((prev) => [...prev, trimmed]);
    fireGlobal();
    onSave(trimmed);
    onClose();
  };

  const handleDelete = (opt: string) => {
    onDeleteOption?.(opt);
    setOptions((prev) => prev.filter((o) => o !== opt));
    fireGlobal();
  };

  const handleSetColor = (opt: string, color: SelectDropdownColor) => {
    onSetColor?.(opt, color);
    setColorPickerOpt(null);
    forceRerender((n) => n + 1);
    fireGlobal();
  };

  const canShowColorPicker = !!colorFamilies && colorFamilies.length > 0 && !!onSetColor;
  const colorClassFor = (opt: string) => getColorClass ? getColorClass(opt) : "bg-wedly-bg-gray text-wedly-muted";

  return (
    <>
      {/* 상단 검색 입력칸 */}
      <div className="p-2 border-b border-wedly-bd/40 bg-white">
        <input
          ref={inputRef}
          type="text"
          className="w-full rounded-lg border border-wedly-bd bg-wedly-bg-gray px-3 py-1.5 text-[13px] text-wedly-t1 placeholder:text-wedly-muted outline-none focus:border-wedly-accent focus:bg-white focus:ring-2 focus:ring-wedly-accent/20 transition"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length === 0 && search.trim()) {
              handleAddNew();
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>

      <div className="max-h-56 overflow-y-auto p-1">
        {/* 비우기 — 항상 표시. 이미 빈 값이면 저장 안 보내고 닫기만 */}
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-wedly-muted hover:bg-wedly-bg-gray transition"
          onClick={() => { if (value) onSave(""); onClose(); }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          비우기
        </button>

        {filtered.map((opt) => {
          const isActive = opt === value;
          const isPickerOpen = colorPickerOpt === opt;
          return (
            <div key={opt} className="group flex items-center gap-1 relative">
              <button
                type="button"
                className={cn(
                  "flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-wedly-bg-gray transition min-w-0",
                  isActive && "bg-wedly-bg-blue/50",
                )}
                onClick={() => { onSave(opt); onClose(); }}
              >
                <span
                  className={cn(
                    "inline-block rounded-md px-2 py-0.5 text-[11.5px] font-medium truncate",
                    colorClassFor(opt),
                  )}
                >
                  {opt}
                </span>
                {isActive && (
                  <span className="ml-auto text-wedly-accent text-[11px] flex-shrink-0">✓</span>
                )}
              </button>
              {canShowColorPicker && (
                <button
                  type="button"
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-wedly-muted hover:bg-wedly-bg-blue/40 hover:text-wedly-accent transition flex-shrink-0"
                  title="색상 변경"
                  onClick={(e) => { e.stopPropagation(); setColorPickerOpt(isPickerOpen ? null : opt); }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
                    <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
                    <circle cx="8" cy="10.5" r="1" fill="currentColor" />
                  </svg>
                </button>
              )}
              {allowDelete && onDeleteOption && (
                <button
                  type="button"
                  className="w-6 h-6 mr-1 rounded-md inline-flex items-center justify-center text-wedly-muted hover:bg-wedly-bg-red/40 hover:text-wedly-red transition flex-shrink-0"
                  title="옵션 삭제"
                  onClick={(e) => { e.stopPropagation(); handleDelete(opt); }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              {isPickerOpen && canShowColorPicker && colorFamilies && (
                <div className="absolute right-1 top-full mt-1 z-50 rounded-xl border border-wedly-bd bg-white p-2 shadow-[0_8px_24px_-4px_rgba(10,34,68,0.18)]">
                  <div className="space-y-1">
                    {colorFamilies.map((family) => (
                      <div key={family.name} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-wedly-muted w-7 shrink-0">{family.name}</span>
                        <div className="flex gap-1">
                          {family.shades.map((s) => (
                            <button
                              key={s.shade}
                              onClick={(e) => { e.stopPropagation(); handleSetColor(opt, { bg: s.bg, text: s.text }); }}
                              className="w-5 h-5 rounded-full border border-wedly-bd hover:scale-110 transition-transform"
                              title={`${family.name} · ${s.shade}`}
                              style={{ backgroundColor: s.bgHex }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* + 새 옵션 추가 — 항상 표시. 검색 글자 있고 옵션에 없으면 즉시 추가, 없으면 검색칸 포커스 */}
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-wedly-accent hover:bg-wedly-bg-blue/40 transition mt-0.5 border-t border-wedly-bd/40 pt-2"
          onClick={() => {
            if (search.trim() && !options.includes(search.trim())) {
              handleAddNew();
            } else {
              inputRef.current?.focus();
            }
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {search.trim() && !options.includes(search.trim())
            ? <>&ldquo;{search.trim()}&rdquo; 추가</>
            : "새 옵션 추가"}
        </button>
      </div>
    </>
  );
}
