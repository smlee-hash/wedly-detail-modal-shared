"use client";

// 여러 명 고르기 드롭다운 본문 — 차수 카드 「담당 컨설턴트」(NO.197 안 B).
// 한 개 고르기(SelectDropdownBody)의 목록에 체크를 붙인 모양이다. 누르면 뒤에 붙고 다시 누르면 빠지며,
// 「완료」나 창 밖 누름에서 한 번 저장한다. 「취소」·Esc 는 저장하지 않는다.
// 고른 순서가 곧 저장 순서다 — 맨 앞 사람이 정산을 받으므로 순서를 바꾸지 않는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import type { SelectDropdownColor, SelectDropdownColorFamily } from "./SelectDropdown";
import { OptionColorButton, OptionColorPanel, useOptionColorPicker } from "./option-color-picker";

export type MultiSelectDropdownBodyProps = {
  /** 창을 연 순간 저장돼 있던 이름(저장 순서 그대로) — 열린 뒤 바뀌어도 다시 읽지 않는다 */
  value: string[];
  /** 칸 정의의 보기 목록 */
  options: string[];
  /** 고른 이름이 바뀌었을 때만 부른다 — 「완료」·창 밖 누름·「비우기」 */
  onSave: (next: string[]) => void;
  /** 창을 닫는다. outside 는 창 밖을 눌러 닫은 경우 — 그때는 초점을 옮기지 않는다. */
  onClose: (outside?: boolean) => void;
  /** 새 이름을 칸 정의에 영구 저장. 없으면 추가 단추를 그리지 않는다(관리자만). */
  onAddOption?: (opt: string) => void;
  /** 이름 색을 칸 정의에 영구 저장. 없으면 색상 변경 단추를 그리지 않는다(관리자만). */
  onSetColor?: (opt: string, color: SelectDropdownColor) => void;
  colorFamilies?: SelectDropdownColorFamily[];
  optionColors?: Record<string, SelectDropdownColor>;
};

const sameNames = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
// 이름 사이는 쉼표로 이어 저장한다 — 쉼표가 든 새 이름은 저장 뒤 두 사람으로 쪼개지므로 추가하지 않는다.
const addable = (s: string, options: string[]) => !!s && !options.includes(s) && !s.includes(",");

export default function MultiSelectDropdownBody({
  value,
  options: initialOptions,
  onSave,
  onClose,
  onAddOption,
  onSetColor,
  colorFamilies,
  optionColors,
}: MultiSelectDropdownBodyProps) {
  // 사람이 바꿨는지는 연 순간의 값과 견준다 — 열린 사이 부모 값이 바뀌어도 손대지 않았으면 저장하지 않는다.
  const [initial] = useState<string[]>(() => [...value]);
  const [draft, setDraft] = useState<string[]>(initial);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState(initialOptions);
  const picker = useOptionColorPicker();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 부모 보기 갱신 — 이 창에서 막 추가한 이름은 보존하면서 합치기(SelectDropdownBody 와 같다)
  useEffect(() => {
    setOptions((prev) => {
      const parentSet = new Set(initialOptions);
      if (prev.every((o) => parentSet.has(o))) return initialOptions;
      return [...initialOptions, ...prev.filter((o) => !parentSet.has(o))];
    });
  }, [initialOptions]);

  // 창 밖을 누르면 고른 대로 저장하고 닫는다. 색 판 안 누름은 판이 mousedown 을 멈춰 여기까지 오지 않는다.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      if (!sameNames(draft, initial)) onSave(draft);
      onClose(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [draft, initial, onSave, onClose]);

  // 보기 목록 + 목록에 없는데 고른 이름(예전에 손으로 넣은 이름 등)은 맨 뒤에 체크된 채
  const candidates = useMemo(
    () => [...options, ...draft.filter((n) => !options.includes(n))],
    [options, draft],
  );
  const filtered = useMemo(
    () => candidates.filter((n) => n.toLowerCase().includes(search.toLowerCase())),
    [candidates, search],
  );

  const toggle = (n: string) => {
    setDraft((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  };

  const addNew = () => {
    if (!onAddOption) return;
    const trimmed = search.trim();
    if (!addable(trimmed, options)) {
      inputRef.current?.focus();
      return;
    }
    onAddOption(trimmed);
    setOptions((prev) => [...prev, trimmed]);
    setDraft((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setSearch("");
    inputRef.current?.focus();
  };

  const finish = () => {
    if (!sameNames(draft, initial)) onSave(draft);
    onClose();
  };

  const handleSetColor = (opt: string, color: SelectDropdownColor) => {
    onSetColor?.(opt, color);
    picker.close();
  };

  const canShowColorPicker = !!colorFamilies && colorFamilies.length > 0 && !!onSetColor;
  const canAdd = addable(search.trim(), options);

  const chip = (n: string) => {
    const c = optionColors?.[n];
    return (
      <span
        className={cn(
          "inline-block rounded-md px-2 py-0.5 text-[11.5px] font-medium truncate",
          !c && "bg-wedly-bg-gray text-wedly-t2",
        )}
        style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
      >
        {n}
      </span>
    );
  };

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing || e.keyCode === 229) return;
        // 정부지원금 상세창은 문서 전체에서 Esc 를 받아 창을 닫는다 — 고르기 창만 닫히게 여기서 멈춘다.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        // 색 판이 열린 채 창 안 다른 곳을 누르면 판만 닫는다(누른 동작은 그대로 된다).
        if (picker.openFor && e.target instanceof Node && rootRef.current?.contains(e.target)) picker.close();
      }}
    >
      {/* 찾기 + 고른 이름 */}
      <div className="p-2 border-b border-wedly-bd/40">
        <input
          ref={inputRef}
          type="text"
          aria-label="이름 찾기"
          autoComplete="off"
          className="w-full rounded-lg border border-wedly-bd bg-wedly-bg-gray px-3 py-1.5 text-[13px] text-wedly-t1 placeholder:text-wedly-t2 outline-none focus:border-wedly-accent focus:bg-white focus:ring-2 focus:ring-wedly-accent/20 transition"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (filtered.length === 0 && search.trim()) addNew();
          }}
        />
        {draft.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {draft.map((n) => (
              <span key={n} className="inline-flex min-w-0 items-center gap-[3px]">
                {chip(n)}
                <button
                  type="button"
                  aria-label={`${n} 빼기`}
                  className="px-px text-[11px] leading-none text-wedly-t1 hover:text-wedly-red"
                  onClick={() => toggle(n)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 max-h-56 overflow-y-auto p-1">
        {/* 비우기 — 언제나 보인다. 이미 빈 값이면 저장 없이 닫기만 */}
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-wedly-t2 hover:bg-wedly-bg-gray transition"
          onClick={() => { if (initial.length > 0) onSave([]); onClose(); }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          비우기
        </button>

        {filtered.map((n) => {
          const on = draft.includes(n);
          return (
            <div key={n} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={on}
                className={cn(
                  "flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-wedly-bg-gray transition min-w-0",
                  on && "bg-wedly-bg-blue/50",
                )}
                onClick={() => toggle(n)}
              >
                <span
                  className={cn(
                    "grid h-[15px] w-[15px] flex-shrink-0 place-items-center rounded border-[1.5px]",
                    on ? "border-wedly-accent bg-wedly-accent text-white" : "border-wedly-bd-blue bg-white",
                  )}
                >
                  {on && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5l3.2 3L13 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {chip(n)}
              </button>
              {/* 색은 칸 정의의 보기에만 저장된다 — 목록에 없는 이름에는 단추를 두지 않는다. */}
              {canShowColorPicker && options.includes(n) && (
                <OptionColorButton onToggle={(anchor) => picker.toggle(n, anchor)} />
              )}
              {picker.openFor === n && canShowColorPicker && colorFamilies && picker.pos && (
                <OptionColorPanel families={colorFamilies} pos={picker.pos} onPick={(color) => handleSetColor(n, color)} />
              )}
            </div>
          );
        })}

        {/* + 새 옵션 추가 — 영구 저장 콜백이 있을 때만(관리자). 넣은 이름은 바로 체크된다. */}
        {onAddOption && (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-wedly-accent-ink hover:bg-wedly-bg-blue/40 transition mt-0.5 border-t border-wedly-bd/40 pt-2"
            onClick={addNew}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {canAdd ? <>&ldquo;{search.trim()}&rdquo; 추가</> : "새 옵션 추가"}
          </button>
        )}
      </div>

      <div className="flex gap-1 border-t border-wedly-bd/60 p-2">
        <button
          type="button"
          className="min-h-[30px] flex-1 rounded bg-wedly-accent text-[12px] font-bold text-white transition hover:brightness-110"
          onClick={finish}
        >
          완료 ({draft.length})
        </button>
        <button
          type="button"
          className="min-h-[30px] rounded border border-wedly-bd bg-white px-3 text-[12px] text-wedly-t2 transition hover:bg-wedly-bg-gray"
          onClick={() => onClose()}
        >
          취소
        </button>
      </div>
    </div>
  );
}
