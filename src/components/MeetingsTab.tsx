"use client";

// 미팅정보 탭 — 한 row 에 1차/2차/... 방문 일정을 기록.
// 데이터는 row["_meetings"] 에 JSON 문자열 ([{ datetime, memo?, assignee? }, ...]) 로 저장.
// 캘린더 뷰는 이 _meetings 를 펼쳐서 모든 방문 일정을 표시.
// 공용 부품(하이브 등). 앱-내부 헬퍼에 의존하지 않음(cn 은 패키지 내부, 삭제확인은 자체 모달).

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";

const ORDINAL_KO = ["1차", "2차", "3차", "4차", "5차", "6차", "7차", "8차", "9차", "10차"];

type Meeting = { datetime: string; memo?: string; assignee?: string };

function parseRaw(raw: unknown): Meeting[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        datetime: typeof x.datetime === "string" ? x.datetime : "",
        memo: typeof x.memo === "string" ? x.memo : undefined,
        assignee: typeof x.assignee === "string" ? x.assignee : undefined,
      }));
  } catch { return []; }
}

function serialize(meetings: Meeting[]): string {
  return JSON.stringify(meetings);
}

export default function MeetingsTab({
  rawValue,
  onSave,
  readOnly = false,
  userNames = [],
  fieldLabels,
  onFieldLabelsChange,
}: {
  rawValue: unknown;
  onSave: (jsonValue: string) => void;
  readOnly?: boolean;
  userNames?: string[];
  /** 미팅 카드의 컬럼 라벨 — 어드민이 변경 가능 */
  fieldLabels?: { datetime: string; assignee: string; memo: string };
  /** 어드민이 라벨 변경 시 호출 — 모든 사용자에게 즉시 반영 */
  onFieldLabelsChange?: (next: { datetime: string; assignee: string; memo: string }) => void;
}) {
  const labels = fieldLabels || { datetime: "방문 일시", assignee: "담당 팀장", memo: "메모" };
  const [editingLabel, setEditingLabel] = useState<keyof typeof labels | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const startEditLabel = (key: keyof typeof labels) => {
    if (!onFieldLabelsChange) return; // 어드민 아니면 편집 불가
    setLabelDraft(labels[key]);
    setEditingLabel(key);
  };
  const commitLabel = () => {
    if (editingLabel && onFieldLabelsChange) {
      const trimmed = labelDraft.trim();
      if (trimmed && trimmed !== labels[editingLabel]) {
        onFieldLabelsChange({ ...labels, [editingLabel]: trimmed });
      }
    }
    setEditingLabel(null);
    setLabelDraft("");
  };
  // 데이터가 비어 있어도 1차 방문 카드를 기본 1개 보여줘 사용자가 바로 입력 가능하게 함
  // 저장된 _meetings 와는 별개 — 입력하기 전까지는 저장 흐름 안 탐
  const initial = useMemo(() => {
    const parsed = parseRaw(rawValue);
    return parsed.length === 0 ? [{ datetime: "", memo: "", assignee: "" }] : parsed;
  }, [rawValue]);
  const [meetings, setMeetings] = useState<Meeting[]>(initial);
  // 저장된 마지막 상태 — 각 차수의 변경 여부 비교용
  // (savedMeetings 는 진짜 저장된 값 기준이라 1차 자동 채움은 포함 안 함)
  const [savedMeetings, setSavedMeetings] = useState<Meeting[]>(() => parseRaw(rawValue));
  const [justSavedIdx, setJustSavedIdx] = useState<number | null>(null);
  // 삭제 확인 모달 — null 이면 닫힌 상태, 숫자면 그 차수 삭제 대기 중
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);
  // 캘린더 팝업 — 방문 일정 헤더 클릭 시 열림. 현재 행의 모든 방문 일정을 달력에 표시
  const [showCalendarPopup, setShowCalendarPopup] = useState(false);

  // rawValue 가 외부에서 갱신되면 초기값 다시 잡기 + 진행 중인 삭제 모달 닫기
  useEffect(() => {
    const parsed = parseRaw(rawValue);
    // 표시용 — 빈 데이터면 1차 빈 카드 자동 채움
    setMeetings(parsed.length === 0 ? [{ datetime: "", memo: "", assignee: "" }] : parsed);
    setSavedMeetings(parsed); // 저장 비교는 진짜 데이터 기준
    setPendingDeleteIdx(null);
  }, [rawValue]);

  // 삭제 모달이 열려 있을 때 ESC 로 닫기 — root div 의 onKeyDown 은 포커스 의존이라 신뢰 불가, document 리스너 사용
  useEffect(() => {
    if (pendingDeleteIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDeleteIdx(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pendingDeleteIdx]);

  // idx 차수가 마지막 저장 후 바뀌었는지
  const isDirtyAt = useCallback((idx: number) => {
    const cur = meetings[idx];
    const sav = savedMeetings[idx];
    if (!sav) return true; // 새로 추가된 차수
    return JSON.stringify(cur) !== JSON.stringify(sav);
  }, [meetings, savedMeetings]);

  // 한 차수 저장 → 전체 _meetings 배열을 한 번에 저장 (한 행에 묶음)
  const saveOne = useCallback((idx: number) => {
    if (readOnly) return;
    onSave(serialize(meetings));
    setSavedMeetings(meetings);
    setJustSavedIdx(idx);
    window.setTimeout(() => setJustSavedIdx((cur) => (cur === idx ? null : cur)), 1500);
  }, [onSave, meetings, readOnly]);

  const updateField = (idx: number, key: keyof Meeting, value: string) => {
    if (readOnly) return;
    setMeetings((prev) => prev.map((m, i) => i === idx ? { ...m, [key]: value } : m));
  };

  const addMeeting = () => {
    if (readOnly) return;
    setMeetings((prev) => [...prev, { datetime: "", memo: "", assignee: "" }]);
  };

  const removeMeeting = (idx: number) => {
    if (readOnly) return;
    setPendingDeleteIdx(idx);  // 위들리 디자인 확인 모달 열기
  };

  const confirmDelete = () => {
    if (pendingDeleteIdx === null) return;
    const filtered = meetings.filter((_, i) => i !== pendingDeleteIdx);
    setMeetings(filtered);
    setSavedMeetings(filtered);
    setJustSavedIdx(null);
    setPendingDeleteIdx(null);
    // 삭제는 즉시 서버에 반영 — 별도 저장 버튼 없이 바로 DB 저장
    onSave(serialize(filtered));
  };

  const cancelDelete = () => setPendingDeleteIdx(null);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-wedly-bd bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowCalendarPopup(true)}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-wedly-accent hover:underline"
            title="전체 방문 일정을 캘린더로 보기"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 6h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            방문 일정 — 캘린더 보기
          </button>
          <p className="text-[11px] text-wedly-muted">{meetings.length}개 차수</p>
        </div>
      </div>

      {meetings.length === 0 && (
        <div className="rounded-xl border border-dashed border-wedly-bd p-8 text-center text-[13px] text-wedly-muted">
          아직 등록된 방문 일정이 없습니다. 아래 &quot;+ 방문 추가&quot; 버튼을 눌러 1차 방문 정보를 입력하세요.
        </div>
      )}

      <div className="space-y-2">
        {meetings.map((m, idx) => (
          <div key={idx} className="rounded-xl border border-wedly-bd bg-white p-3.5 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-wedly-bg-blue text-wedly-accent text-[11px] font-bold">
                {ORDINAL_KO[idx] ?? `${idx + 1}차`} 방문
              </span>
              {!readOnly && (
                <div className="flex items-center gap-2">
                  {isDirtyAt(idx) ? (
                    <span className="text-[11px] text-wedly-orange font-medium">● 변경됨</span>
                  ) : justSavedIdx === idx ? (
                    <span className="text-[11px] text-wedly-green font-medium">✓ 저장됨</span>
                  ) : null}
                  <button
                    onClick={() => removeMeeting(idx)}
                    className="text-[11px] text-wedly-muted hover:text-red-500 px-2 py-1 rounded hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>

            {/* 담당자 칸은 사용자 요청으로 제거 — 미팅 카드에는 방문 일시 + 메모만 노출 */}
            <div>
              <label className="block">
                {editingLabel === "datetime" ? (
                  <input
                    autoFocus
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onBlur={commitLabel}
                    onKeyDown={(e) => { if (e.key === "Enter") commitLabel(); if (e.key === "Escape") setEditingLabel(null); }}
                    className="text-[11px] font-semibold text-wedly-t2 border border-wedly-accent rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-wedly-accent/20 w-32"
                  />
                ) : (
                  <span
                    className={`text-[11px] font-semibold text-wedly-t2 ${onFieldLabelsChange ? "cursor-pointer hover:text-wedly-accent" : ""}`}
                    onClick={() => startEditLabel("datetime")}
                    title={onFieldLabelsChange ? "클릭하여 컬럼명 수정" : undefined}
                  >
                    {labels.datetime}{onFieldLabelsChange && <span className="ml-0.5 text-wedly-muted/60">✎</span>}
                  </span>
                )}
                <input
                  type="datetime-local"
                  value={m.datetime}
                  onChange={(e) => updateField(idx, "datetime", e.target.value)}
                  readOnly={readOnly}
                  className="mt-1 block w-full px-3 py-2.5 sm:py-2 text-[15px] sm:text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent hover:border-wedly-accent/50 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed"
                />
              </label>
            </div>

            <label className="block">
              {editingLabel === "memo" ? (
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={commitLabel}
                  onKeyDown={(e) => { if (e.key === "Enter") commitLabel(); if (e.key === "Escape") setEditingLabel(null); }}
                  className="text-[11px] font-semibold text-wedly-t2 border border-wedly-accent rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-wedly-accent/20 w-32"
                />
              ) : (
                <span
                  className={`text-[11px] font-semibold text-wedly-t2 ${onFieldLabelsChange ? "cursor-pointer hover:text-wedly-accent" : ""}`}
                  onClick={() => startEditLabel("memo")}
                  title={onFieldLabelsChange ? "클릭하여 컬럼명 수정" : undefined}
                >
                  {labels.memo}{onFieldLabelsChange && <span className="ml-0.5 text-wedly-muted/60">✎</span>}
                </span>
              )}
              <textarea
                value={m.memo || ""}
                onChange={(e) => updateField(idx, "memo", e.target.value)}
                readOnly={readOnly}
                rows={2}
                placeholder="방문 목적이나 안건을 적어주세요"
                className="mt-1 block w-full px-3 py-2.5 sm:py-2 text-[15px] sm:text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent hover:border-wedly-accent/50 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed resize-y"
              />
            </label>

            {!readOnly && (
              <button
                onClick={() => saveOne(idx)}
                disabled={!isDirtyAt(idx)}
                className={isDirtyAt(idx)
                  ? "w-full py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110"
                  : "w-full py-2 text-[13px] font-medium text-wedly-muted bg-wedly-bg-gray rounded-lg cursor-not-allowed"}
              >
                {isDirtyAt(idx) ? `${ORDINAL_KO[idx] ?? `${idx + 1}차`} 방문 저장` : justSavedIdx === idx ? "✓ 저장 완료" : "변경 사항 없음"}
              </button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <button
          onClick={addMeeting}
          className="w-full py-2.5 text-[13px] font-medium text-wedly-accent border border-wedly-accent/30 rounded-xl hover:bg-wedly-bg-blue transition-colors"
        >
          + 방문 추가 ({ORDINAL_KO[meetings.length] ?? `${meetings.length + 1}차`} 방문)
        </button>
      )}

      {/* 차수 삭제 확인 모달 — 위들리 디자인 시스템 토큰 사용 */}
      {pendingDeleteIdx !== null && (() => {
        const target = meetings[pendingDeleteIdx];
        const label = ORDINAL_KO[pendingDeleteIdx] ?? `${pendingDeleteIdx + 1}차`;
        const when = target?.datetime ? target.datetime.replace("T", " ") : "";
        return (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={cancelDelete} />
            <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd overflow-hidden animate-modal-in">
              {/* Header */}
              <div className="px-5 pt-5 pb-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-wedly-red">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-wedly-navy">{label} 방문 일정 삭제</h3>
                  {when && (
                    <p className="mt-1 text-[12px] text-wedly-muted">예정 일시: {when}</p>
                  )}
                </div>
              </div>
              {/* Body */}
              <div className="px-5 pb-4">
                <p className="text-[13px] text-wedly-t2 leading-relaxed">
                  이 차수 방문 일정을 삭제하시겠습니까?
                  <br />
                  <span className="text-wedly-muted">삭제 후에는 되돌릴 수 없습니다.</span>
                </p>
              </div>
              {/* Footer */}
              <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
                <button
                  onClick={cancelDelete}
                  className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-red rounded-lg hover:brightness-110 transition-colors"
                  autoFocus
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 캘린더 팝업 — 이 행의 방문 일정을 달력 형태로 한눈에 */}
      {showCalendarPopup && (() => {
        const today = new Date();
        // 모든 미팅 datetime 을 날짜별로 묶음 (YYYY-MM-DD 키)
        const byDate = new Map<string, { idx: number; label: string; datetime: string; assignee?: string }[]>();
        meetings.forEach((m, idx) => {
          if (!m.datetime) return;
          const d = new Date(m.datetime);
          if (Number.isNaN(d.getTime())) return;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const list = byDate.get(key) || [];
          list.push({ idx, label: `${idx + 1}차`, datetime: m.datetime, assignee: m.assignee });
          byDate.set(key, list);
        });
        // 캘린더 기준월 = 미팅이 있는 가장 최근 달, 없으면 오늘 달
        const meetingDates = Array.from(byDate.keys()).sort();
        const baseDate = meetingDates.length > 0
          ? new Date(meetingDates[meetingDates.length - 1])
          : today;
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        // 캘린더 그리드 (일요일 시작) — 첫 주에 이전 달 빈 칸 추가
        const cells: Array<{ date: number; key: string; isToday: boolean; items: typeof byDate extends Map<string, infer V> ? V : never } | null> = [];
        for (let i = 0; i < firstDay.getDay(); i++) cells.push(null);
        for (let d = 1; d <= lastDay.getDate(); d++) {
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
          cells.push({ date: d, key, isToday, items: byDate.get(key) || [] });
        }
        const weekHeaders = ["일", "월", "화", "수", "목", "금", "토"];

        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowCalendarPopup(false)} />
            <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in flex flex-col max-h-[90vh]">
              <div className="px-5 pt-4 pb-3 border-b border-wedly-bd flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] font-bold text-wedly-navy">방문 일정 캘린더</h3>
                  <p className="text-[11px] text-wedly-muted mt-0.5">
                    {year}년 {month + 1}월 · {meetings.filter((m) => m.datetime).length}개 일정
                  </p>
                </div>
                <button
                  onClick={() => setShowCalendarPopup(false)}
                  className="text-wedly-muted hover:text-wedly-t1 px-2 py-1"
                  aria-label="닫기"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {weekHeaders.map((w, i) => (
                    <div key={w} className={cn(
                      "text-center text-[11px] font-semibold py-1",
                      i === 0 && "text-wedly-red",
                      i === 6 && "text-wedly-accent",
                      i > 0 && i < 6 && "text-wedly-muted",
                    )}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((cell, i) => {
                    if (!cell) return <div key={`empty-${i}`} className="aspect-square" />;
                    return (
                      <div
                        key={cell.key}
                        className={cn(
                          "aspect-square border rounded-lg p-1 flex flex-col text-left overflow-hidden",
                          cell.isToday ? "border-wedly-accent bg-wedly-bg-blue/30" : "border-wedly-bd",
                          cell.items.length > 0 && "bg-wedly-bg-blue/10",
                        )}
                      >
                        <div className={cn(
                          "text-[11px] font-medium leading-tight",
                          cell.isToday ? "text-wedly-accent font-bold" : "text-wedly-t2",
                        )}>{cell.date}</div>
                        <div className="flex-1 min-h-0 space-y-0.5 mt-0.5">
                          {cell.items.slice(0, 3).map((it) => {
                            const time = (() => {
                              try {
                                const d = new Date(it.datetime);
                                return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                              } catch { return ""; }
                            })();
                            return (
                              <div
                                key={`${it.idx}-${it.datetime}`}
                                className="text-[9px] sm:text-[10px] bg-wedly-accent text-white rounded px-1 py-0.5 truncate"
                                title={`${it.label}${it.assignee ? ` · ${it.assignee}` : ""}${time ? ` · ${time}` : ""}`}
                              >
                                {time} {it.label}
                              </div>
                            );
                          })}
                          {cell.items.length > 3 && (
                            <div className="text-[9px] text-wedly-muted">+{cell.items.length - 3}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {meetings.filter((m) => m.datetime).length === 0 && (
                  <p className="text-center text-[13px] text-wedly-muted mt-6">
                    등록된 방문 일정이 없습니다.
                  </p>
                )}
              </div>
              <div className="px-5 py-3 border-t border-wedly-bd/60 bg-wedly-bg-gray/30 flex items-center justify-end">
                <button
                  onClick={() => setShowCalendarPopup(false)}
                  className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
