"use client";

// 선택지 색 고르는 판 — 한 개 고르기(SelectDropdownBody)와 여러 명 고르기(MultiSelectDropdownBody)가 같이 쓴다.
// 판은 **드롭다운 바깥(portal)** 에 화면 기준 좌표로 띄운다. 드롭다운은 스크롤 상자(overflow:auto)라,
// 판을 그 안에 그리면 상자 밖으로 나간 부분이 잘려 눌리지 않는다(2026-08-14 실측: 색 50개 중 45개가 클릭 자체가 막혀 있었다).

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SelectDropdownColor, SelectDropdownColorFamily } from "./SelectDropdown";

// 판 크기(대략) — 10계열 × 5농도. 화면 밖으로 나가지 않게 이 값으로 자리를 잡는다.
const PICKER_W = 176;
const PICKER_H = 262;

type PickerPos = { top: number; left: number };

/** 어느 선택지의 판이 어디에 열려 있는지 — 같은 단추를 다시 누르거나 화면이 굴러가면 닫힌다. */
export function useOptionColorPicker() {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [pos, setPos] = useState<PickerPos | null>(null);

  const close = useCallback(() => {
    setOpenFor(null);
    setPos(null);
  }, []);

  const toggle = (opt: string, anchor: HTMLElement) => {
    if (openFor === opt) {
      close();
      return;
    }
    const r = anchor.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    // 기본은 단추 아래·오른쪽 맞춤. 아래가 좁으면 위로 뒤집고, 좌우는 화면 안으로 밀어 넣는다.
    const openUp = r.bottom + 6 + PICKER_H > vh - 8 && r.top - 6 - PICKER_H >= 8;
    const top = openUp ? r.top - 6 - PICKER_H : Math.min(r.bottom + 6, Math.max(8, vh - PICKER_H - 8));
    const left = Math.min(Math.max(8, r.right - PICKER_W), Math.max(8, vw - PICKER_W - 8));
    setOpenFor(opt);
    setPos({ top, left });
  };

  // 판을 띄운 뒤 화면이 굴러가거나 크기가 바뀌면 자리가 어긋난다 → 그냥 닫는다.
  useEffect(() => {
    if (!openFor) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openFor, close]);

  return { openFor, pos, toggle, close };
}

/** 선택지 줄 오른쪽의 「색상 변경」 단추. 누름이 줄(선택지 고르기)로 새지 않게 막는다. */
export function OptionColorButton({ onToggle }: { onToggle: (anchor: HTMLElement) => void }) {
  return (
    <button
      type="button"
      className="w-6 h-6 rounded-md inline-flex items-center justify-center text-wedly-t2 hover:bg-wedly-bg-blue/40 hover:text-wedly-accent-ink transition flex-shrink-0"
      title="색상 변경"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e.currentTarget);
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
        <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
        <circle cx="8" cy="10.5" r="1" fill="currentColor" />
      </svg>
    </button>
  );
}

/**
 * 색 고르는 판 — document.body 에 띄운다.
 * mousedown 을 여기서 멈추는 이유: 바깥 클릭 감시(부모가 document 에 걸어 둔 것)가
 * 이 판을 "바깥"으로 보고 드롭다운을 닫아버리면, 색을 고르는 클릭이 아예 발생하지 못한다.
 */
export function OptionColorPanel({
  families,
  pos,
  onPick,
}: {
  families: SelectDropdownColorFamily[];
  pos: PickerPos;
  onPick: (color: SelectDropdownColor) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed rounded-xl border border-wedly-bd bg-white p-2 shadow-wedly-floating"
      style={{ top: pos.top, left: pos.left, width: PICKER_W, zIndex: 10000 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="space-y-1">
        {families.map((family) => (
          <div key={family.name} className="flex items-center gap-1.5">
            <span className="text-[10px] text-wedly-muted w-7 shrink-0">{family.name}</span>
            <div className="flex gap-1">
              {family.shades.map((s) => (
                <button
                  key={s.shade}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPick({ bg: s.bg, text: s.text }); }}
                  className="w-5 h-5 rounded-full border border-wedly-bd hover:scale-110 transition-transform"
                  title={`${family.name} · ${s.shade}`}
                  style={{ backgroundColor: s.bgHex }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
