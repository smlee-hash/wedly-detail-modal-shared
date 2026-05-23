"use client";

// 위들리 디자인 시스템 기반 커스텀 드롭다운.
// 브라우저 native <select> 는 옵션 목록 스타일을 자유롭게 못 줘서 별도 popover 로 구현.
//
// 사용 예:
//   <CustomSelect
//     value={selected}
//     onChange={(v) => setSelected(v)}
//     options={[{ value: "", label: "선택 안 함" }, { value: "A", label: "A씨" }]}
//     placeholder="선택 안 함"
//     disabled={readOnly}
//   />

import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";

export type CustomSelectOption = {
  value: string;
  label: string;
  /** 선택 라벨 옆에 표시되는 작은 색 점 (예: 상태 색상) */
  dotColor?: string;
};

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "선택",
  disabled = false,
  size = "md",
  className,
  fullWidth = true,
  align = "start",
}: {
  value: string;
  onChange: (next: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  fullWidth?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // 트리거 클릭과 같은 사이클에서 즉시 닫히지 않도록 다음 tick 부터 mousedown 리스너 등록
    const t = window.setTimeout(() => document.addEventListener("mousedown", handler), 0);
    document.addEventListener("keydown", keyHandler);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const isEmpty = !selected || selected.value === "";

  const paddingY = size === "sm" ? "py-1.5" : "py-2";
  const paddingX = size === "sm" ? "px-2.5" : "px-3";
  const fontSize = size === "sm" ? "text-[12px]" : "text-[13px]";

  return (
    <div ref={rootRef} className={cn("relative", fullWidth ? "w-full" : "inline-block", className)}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "flex items-center justify-between gap-2 w-full border rounded-lg bg-white transition-colors text-left",
          paddingX, paddingY, fontSize,
          disabled
            ? "border-wedly-bd bg-wedly-bg-gray text-wedly-muted cursor-not-allowed"
            : open
              ? "border-wedly-accent ring-2 ring-wedly-accent/30 text-wedly-t1"
              : "border-wedly-bd text-wedly-t1 hover:border-wedly-accent/50 cursor-pointer",
        )}
      >
        <span className={cn("flex-1 truncate flex items-center gap-1.5", isEmpty && "text-wedly-muted")}>
          {selected?.dotColor && (
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: selected.dotColor }}
              aria-hidden="true"
            />
          )}
          {selected?.label || placeholder}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={cn("flex-shrink-0 transition-transform", open && "rotate-180", disabled ? "text-wedly-muted" : "text-wedly-t2")}
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && !disabled && (
        <div
          className={cn(
            "absolute top-full mt-1 z-30 bg-white border border-wedly-bd rounded-lg shadow-lg overflow-hidden py-1 min-w-full max-h-64 overflow-y-auto",
            align === "end" ? "right-0" : "left-0",
          )}
          role="listbox"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-wedly-muted">옵션이 없습니다</p>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors",
                    fontSize,
                    isSelected
                      ? "bg-wedly-bg-blue/40 text-wedly-accent font-semibold"
                      : "text-wedly-t2 hover:bg-wedly-bg-gray",
                  )}
                >
                  {opt.dotColor && (
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: opt.dotColor }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0">
                      <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
