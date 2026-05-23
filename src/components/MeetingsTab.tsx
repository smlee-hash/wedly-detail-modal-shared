"use client";

// 미팅정보 탭 — 한 row 에 1차/2차/... 방문 일정을 기록.
// 데이터는 row["_meetings"] 에 JSON 문자열 ([{ datetime, memo?, assignee? }, ...]) 로 저장.
// 캘린더 뷰는 이 _meetings 를 펼쳐서 모든 방문 일정을 표시.

import { useCallback, useEffect, useMemo, useState } from "react";
import CustomSelect from "./CustomSelect";

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
}: {
  rawValue: unknown;
  onSave: (jsonValue: string) => void;
  readOnly?: boolean;
  userNames?: string[];
}) {
  const initial = useMemo(() => parseRaw(rawValue), [rawValue]);
  const [meetings, setMeetings] = useState<Meeting[]>(initial);
  // 저장된 마지막 상태 — 각 차수의 변경 여부 비교용
  const [savedMeetings, setSavedMeetings] = useState<Meeting[]>(initial);
  const [justSavedIdx, setJustSavedIdx] = useState<number | null>(null);
  // 삭제 확인 모달 — null 이면 닫힌 상태, 숫자면 그 차수 삭제 대기 중
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);

  // rawValue 가 외부에서 갱신되면 초기값 다시 잡기 + 진행 중인 삭제 모달 닫기
  useEffect(() => {
    const next = parseRaw(rawValue);
    setMeetings(next);
    setSavedMeetings(next);
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
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-semibold text-wedly-muted uppercase tracking-wider">방문 일정</p>
          <p className="text-[11px] text-wedly-muted">{meetings.length}개 차수</p>
        </div>
        <p className="text-[11px] text-wedly-muted">
          입력된 모든 방문 일정은 캘린더 뷰에도 표시됩니다. 각 차수 카드의 <strong>저장</strong> 버튼으로 저장하세요.
        </p>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">방문 일시</span>
                <input
                  type="datetime-local"
                  value={m.datetime}
                  onChange={(e) => updateField(idx, "datetime", e.target.value)}
                  readOnly={readOnly}
                  className="mt-1 block w-full px-3 py-2 text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent hover:border-wedly-accent/50 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">담당 사무장</span>
                <div className="mt-1">
                  <CustomSelect
                    value={m.assignee || ""}
                    onChange={(v) => updateField(idx, "assignee", v)}
                    disabled={readOnly}
                    placeholder="선택 안 함"
                    options={[
                      { value: "", label: "선택 안 함" },
                      ...userNames.map((n) => ({ value: n, label: n })),
                    ]}
                  />
                </div>
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold text-wedly-t2">메모</span>
              <textarea
                value={m.memo || ""}
                onChange={(e) => updateField(idx, "memo", e.target.value)}
                readOnly={readOnly}
                rows={2}
                placeholder="방문 목적이나 안건을 적어주세요"
                className="mt-1 block w-full px-3 py-2 text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent hover:border-wedly-accent/50 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed resize-y"
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
    </div>
  );
}
