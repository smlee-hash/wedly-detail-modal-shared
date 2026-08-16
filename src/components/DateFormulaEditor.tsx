"use client";

import React from "react";
import CustomSelect from "./CustomSelect";
import type { FieldDef, DateFormulaSpec, DateOffsetUnit, Weekday } from "@wedly/ui-shared";

const WEEKDAYS: { v: Weekday; label: string }[] = [
  { v: 1, label: "월" }, { v: 2, label: "화" }, { v: 3, label: "수" }, { v: 4, label: "목" },
  { v: 5, label: "금" }, { v: 6, label: "토" }, { v: 0, label: "일" },
];

export default function DateFormulaEditor({ value, onChange, fields, editingFieldKey }: {
  value: DateFormulaSpec;
  onChange: (next: DateFormulaSpec) => void;
  fields: FieldDef[];
  editingFieldKey: string | null;
}) {
  const baseOptions = fields
    .filter((f) => f.key !== editingFieldKey && (f.type === "date" || (f.type === "formula" && f.formulaResult === "date")))
    .map((f) => ({ value: f.key, label: f.label }));
  const offsets = value.mode === "offset" ? value.offsets : [];

  return (
    <div className="rounded-lg border border-wedly-accent/30 bg-wedly-bg-blue/10 p-2.5 space-y-2.5">
      <label className="block">
        <span className="text-[10px] font-semibold text-wedly-t2">기준 날짜 칸</span>
        <div className="mt-1">
          <CustomSelect
            size="sm"
            value={value.baseKey}
            onChange={(v) => onChange({ ...value, baseKey: v })}
            placeholder="날짜 칸 선택"
            options={baseOptions}
          />
        </div>
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ mode: "offset", baseKey: value.baseKey, offsets: offsets.length ? offsets : [{ amount: 1, unit: "day" }] })}
          className={`px-2.5 py-1 text-[11px] rounded-full border ${value.mode === "offset" ? "bg-wedly-navy text-white border-wedly-navy" : "border-wedly-bd text-wedly-muted"}`}
        >날짜 더하기·빼기</button>
        <button
          type="button"
          onClick={() => onChange({ mode: "weekday", baseKey: value.baseKey, weeksAhead: 1, weekday: 5 })}
          className={`px-2.5 py-1 text-[11px] rounded-full border ${value.mode === "weekday" ? "bg-wedly-navy text-white border-wedly-navy" : "border-wedly-bd text-wedly-muted"}`}
        >N주 뒤 + 요일</button>
      </div>
      {value.mode === "offset" ? (
        <div className="space-y-1.5">
          {offsets.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <CustomSelect
                size="sm"
                value={o.amount < 0 ? "-" : "+"}
                onChange={(sign) => {
                  const next = [...offsets];
                  next[i] = { ...o, amount: Math.abs(o.amount) * (sign === "-" ? -1 : 1) };
                  onChange({ mode: "offset", baseKey: value.baseKey, offsets: next });
                }}
                options={[{ value: "+", label: "＋" }, { value: "-", label: "－" }]}
              />
              <input
                type="number"
                min={0}
                value={Math.abs(o.amount)}
                onChange={(e) => {
                  const n = Math.abs(parseInt(e.target.value) || 0);
                  const next = [...offsets];
                  next[i] = { ...o, amount: o.amount < 0 ? -n : n };
                  onChange({ mode: "offset", baseKey: value.baseKey, offsets: next });
                }}
                className="w-16 px-2 py-1.5 text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 focus:outline-none focus:ring-2 focus:ring-wedly-accent/30"
              />
              <CustomSelect
                size="sm"
                value={o.unit}
                onChange={(u) => {
                  const next = [...offsets];
                  next[i] = { ...o, unit: u as DateOffsetUnit };
                  onChange({ mode: "offset", baseKey: value.baseKey, offsets: next });
                }}
                options={[{ value: "day", label: "일" }, { value: "week", label: "주" }, { value: "month", label: "개월" }]}
              />
              {offsets.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange({ mode: "offset", baseKey: value.baseKey, offsets: offsets.filter((_, j) => j !== i) })}
                  className="p-1 rounded text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red"
                >✕</button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ mode: "offset", baseKey: value.baseKey, offsets: [...offsets, { amount: 1, unit: "day" }] })}
            className="w-full py-1 rounded-lg border-2 border-dashed border-wedly-accent/40 text-[11px] font-bold text-wedly-accent hover:bg-wedly-bg-blue"
          >+ 더하기·빼기 추가</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="number"
            min={0}
            value={value.weeksAhead}
            onChange={(e) => onChange({
              mode: "weekday",
              baseKey: value.baseKey,
              weeksAhead: Math.max(0, parseInt(e.target.value) || 0),
              weekday: value.weekday,
            })}
            className="w-16 px-2 py-1.5 text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 focus:outline-none focus:ring-2 focus:ring-wedly-accent/30"
          />
          <span className="text-[12px] text-wedly-muted">주 뒤</span>
          <CustomSelect
            size="sm"
            value={String(value.weekday)}
            onChange={(v) => onChange({
              mode: "weekday",
              baseKey: value.baseKey,
              weeksAhead: value.weeksAhead,
              weekday: Number(v) as Weekday,
            })}
            options={WEEKDAYS.map((w) => ({ value: String(w.v), label: w.label + "요일" }))}
          />
          <span className="text-[10px] text-wedly-muted">(주는 월요일 시작)</span>
        </div>
      )}
    </div>
  );
}
