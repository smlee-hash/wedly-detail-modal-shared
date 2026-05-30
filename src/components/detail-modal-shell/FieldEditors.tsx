"use client";

// 상세 모달 필드/셀 편집 부품 묶음 — 공용판 (하이브 _components/FieldEditors.tsx 일반화).
//   MultiPersonEditor : 다중 사용자 선택
//   SelectEditor      : 옵션 선택 드롭다운 wrapper
//   EditableFieldRow  : 한 필드(셀) 편집 — 모든 형식(텍스트·숫자·날짜·선택·사람·파일 등) 라우팅
// 표 셀과 상세 모달이 같은 부품을 쓰도록(하이브 AGENTS.md §5-4) 한 곳에 모음.
//
// 하이브 원본과 동작 동일. 단, 하이브에만 박혀 있던 4가지를 입력값(주입)으로 빼냈다:
//   ① 권한(isAdmin)          — 예전엔 useAccess() 직접 호출
//   ② 확인/알림창(dialog)     — 예전엔 useWedlyDialog() 직접 호출 (공용 ShellDialog 모양으로 받음)
//   ③ 파일 열기(openFile)     — 예전엔 openFileWithRefresh 직접 import (서버주소가 박힘)
//   ④ 옵션 드롭다운(SelectDropdownBody) — 예전엔 HiveSelectDropdownBody 직접 import
// → 앱마다 다른 이 4가지만 넘겨주면, 같은 편집기를 세 앱이 공용으로 쓴다.

import { useState, useRef, useEffect, memo } from "react";
import type { ComponentType } from "react";
import { cn } from "../../lib/cn";
import { parsePersonItem, splitPersonListSafe } from "../../lib/person-id";
import { TextEditor, NumberEditor, DateEditor } from "@wedly/ui-shared";
import { formatCurrency, formatDate, formatDateTime, STATUS_COLORS } from "../../lib/utils";
import { READONLY_TYPES, getOptionColorClass, getFieldOptions } from "../../lib/options";
import type { RowData, FileMeta, DetailField } from "./detail-types";
import type { ShellDialog } from "./config";

// ---------------------------------------------------------------------------
// 주입 입력값 타입 — 앱이 넘겨주는 4가지 중 편집기에 필요한 것들.
// ---------------------------------------------------------------------------

/** 옵션 선택 드롭다운 본문 — 앱별 옵션 시스템(추가/삭제/색상)에 연결된 부품을 넘겨받는다.
 *  하이브의 HiveSelectDropdownBody 와 동일한 입력 모양. */
export type SelectDropdownBodyComponent = ComponentType<{
  value: string;
  options: string[];
  fieldKey: string;
  onSave: (next: string) => void;
  onClose: () => void;
  allowDelete?: boolean;
}>;

/** 파일 안전 열기 — 만료 링크 자동 회복. 서버주소는 앱(또는 틀)이 미리 묶어 넘긴다. */
export type OpenFileFn = (opts: {
  url: string;
  entryId: string;
  fileName: string;
  category?: string;
  onWarn?: (message: string) => void;
}) => void;

// 다중 사람 선택 편집기 — "팀원" 같이 여러 사용자 선택. 값은 콤마 구분 문자열로 저장.
// 각 항목은 "이름" 또는 "이름 <이메일>" (동명이인 구분용).
export function MultiPersonEditor({
  value,
  userNames,
  onSave,
  onClose,
}: {
  value: string;
  userNames: string[];
  onSave: (next: string) => void;
  onClose: () => void;
}) {
  const initial = splitPersonListSafe(value);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 화면 표시용 헬퍼 — 공유 모듈 사용. 동명이인 풀 형식이면 이름과 이메일 분리 표시.
  const labelFor = (raw: string): string => parsePersonItem(raw).name;
  const tipFor = (raw: string): string | undefined => parsePersonItem(raw).email || undefined;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && rootRef.current.contains(e.target as Node)) return;
      // 외부 클릭 시 자동 저장 + 닫기
      onSave(Array.from(selected).join(", "));
      onClose();
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [selected, onSave, onClose]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const q = query.replace(/\s/g, "").toLowerCase();
  const filtered = userNames.filter((n) => !q || n.replace(/\s/g, "").toLowerCase().includes(q));

  return (
    <div
      ref={rootRef}
      className="bg-white border border-wedly-accent rounded-lg shadow-lg min-w-[240px] max-h-72 flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 상단 — 검색 + 선택된 사용자 칩 */}
      <div className="p-2 flex-shrink-0 border-b border-wedly-bd/40">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름으로 찾기"
          autoFocus
          className="block w-full px-3 py-2 text-[16px] sm:text-[12px] min-h-[40px] sm:min-h-[28px] border border-wedly-bd rounded focus:outline-none focus:ring-1 focus:ring-wedly-accent"
        />
        {selected.size > 0 && (
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
        {filtered.length === 0 ? (
          <p className="text-[11px] text-wedly-muted px-2 py-1.5">일치하는 사용자가 없습니다</p>
        ) : (
          filtered.map((n) => {
            const tip = tipFor(n);
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
      {/* 하단 — 완료/취소 (항상 고정) */}
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
    </div>
  );
}

// SelectEditor — 공유 SelectDropdownBody 사용으로 통합 (하이브 AGENTS.md §5-4 cell-detail-parity)
// 본문은 SelectDropdownBody 가 담당, 이 부품은 외부 클릭 감지·absolute 위치만 처리.
// SelectDropdownBody 는 앱별 옵션 시스템에 연결된 부품을 입력값으로 받는다.
export function SelectEditor({
  value,
  options: initialOptions,
  fieldKey,
  onSave,
  onClose,
  canDelete = false,
  SelectDropdownBody,
}: {
  value: string;
  options: string[];
  fieldKey: string;
  onSave: (v: string) => void;
  onClose: () => void;
  canDelete?: boolean;
  SelectDropdownBody: SelectDropdownBodyComponent;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-2xl border border-wedly-bd bg-white shadow-[0_10px_30px_-6px_rgba(10,34,68,0.18)] overflow-visible"
    >
      <SelectDropdownBody
        value={value}
        options={initialOptions}
        fieldKey={fieldKey}
        onSave={onSave}
        onClose={onClose}
        allowDelete={canDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableFieldRow
// ---------------------------------------------------------------------------

export const EditableFieldRow = memo(function EditableFieldRow({
  field,
  value,
  onSave,
  userNames,
  row,
  onJumpToFiles,
  onUploadFiles,
  onRemoveFile,
  onRenameColumn,
  isAdmin = false,
  dialog,
  openFile,
  SelectDropdownBody,
}: {
  field: DetailField;
  value: string | number | boolean | null;
  onSave: (key: string, value: string | number | boolean | null) => void;
  userNames?: string[];
  row?: RowData;
  onJumpToFiles?: (category: string) => void;
  /** file type 컬럼에서 셀 안 inline 업로드 시 호출 — category 는 컬럼 라벨 */
  onUploadFiles?: (files: FileList, category: string) => Promise<void> | void;
  /** file type 컬럼 셀에서 파일 제거 시 호출 — 파일 id 전달 */
  onRemoveFile?: (fileId: string) => void;
  /** 어드민이 컬럼 이름을 직접 수정 — 라벨 더블클릭 → 인라인 편집 → 저장 */
  onRenameColumn?: (key: string, newLabel: string) => void;
  /** ① 권한 — 옵션 삭제 가능 여부(어드민). 예전 useAccess().isAdmin. */
  isAdmin?: boolean;
  /** ② 위들리 확인/알림창 — 파일 제거 확인·만료 안내. 예전 useWedlyDialog(). */
  dialog: ShellDialog;
  /** ③ 파일 안전 열기 — 만료 링크 자동 회복. 예전 openFileWithRefresh. */
  openFile: OpenFileFn;
  /** ④ 옵션 드롭다운 본문 — 앱별 옵션 시스템 연결 부품. 예전 HiveSelectDropdownBody. */
  SelectDropdownBody: SelectDropdownBodyComponent;
}) {
  const [editing, setEditing] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const isReadonly = READONLY_TYPES.has(field.type);

  // 첨부파일 형식 컬럼 — 셀 안에서 직접 업로드 + 첨부 파일 카드 + 파일 패널 점프 링크
  if (field.type === "file") {
    const allFiles = (row?._files as unknown as FileMeta[] | undefined) || [];
    // (A) 첨부 파일 묶음(_files) 안에서 같은 카테고리(=컬럼 라벨) 매칭
    const myFiles = allFiles.filter((f) => (f?.category || "기타자료") === field.label);
    // (B) row[field.key] 에 직접 JSON 배열로 저장된 파일들 — 표 셀과 같은 출처. 둘 다 합쳐서 표시.
    // (사용자 보고: 표에는 보이는데 상세 모달에 안 보임 → 표는 row 키 직접 출처, 모달은 _files 카테고리 매칭만 봐서 누락)
    type DirectFile = { name: string; url: string };
    const directFiles: DirectFile[] = [];
    const directVal = row?.[field.key];
    if (directVal) {
      try {
        const parsed = typeof directVal === "string" ? JSON.parse(directVal) : directVal;
        if (Array.isArray(parsed)) {
          for (const f of parsed) {
            if (f && typeof f === "object") {
              const name = String((f as { name?: unknown; fileName?: unknown }).name
                ?? (f as { fileName?: unknown }).fileName ?? "");
              const url = String((f as { url?: unknown }).url ?? "");
              if (name || url) directFiles.push({ name: name || "파일", url });
            }
          }
        }
      } catch { /* 일반 텍스트면 표시 안 함 */ }
    }
    return (
      <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-3 sm:py-2 px-1 group">
        <div className="w-full sm:w-[160px] sm:flex-shrink-0 text-[13px] font-medium sm:font-normal text-wedly-muted leading-tight pt-0.5 sm:truncate">
          {field.label}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* row 키에 직접 저장된 파일들 (표 셀과 같은 출처) — 제거 버튼 없음, 클릭 시 안전 열기 */}
          {directFiles.map((f, i) => (
            <div key={`direct-${i}-${f.url || f.name}`} className="flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-lg border border-wedly-bd bg-wedly-bg-gray/30">
              {f.url ? (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    // 노션 임시 보관함 링크 1시간 만료 대응 — 만료 시 행 새로고침 + 노션에서 새 링크 받아 자동 재시도.
                    openFile({
                      url: f.url,
                      entryId: String(row?._id || ""),
                      fileName: f.name,
                      category: field.label,
                      onWarn: (m) => dialog.alert?.({ title: "파일 링크 만료", message: m }),
                    });
                  }}
                  className="flex-1 min-w-0 truncate text-[14px] sm:text-[13px] text-wedly-t1 hover:text-wedly-accent"
                >
                  📎 {f.name}
                </a>
              ) : (
                <span className="flex-1 min-w-0 truncate text-[14px] sm:text-[13px] text-wedly-t2">📎 {f.name}</span>
              )}
            </div>
          ))}
          {/* 첨부된 파일 카드들 — 클릭 시 안전 열기, 제거 버튼 */}
          {myFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-lg border border-wedly-bd bg-wedly-bg-gray/30">
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openFile({
                    url: f.url || "",
                    entryId: String(row?._id || ""),
                    fileName: f.fileName || "파일",
                    category: f.category || field.label,
                    onWarn: (m) => dialog.alert?.({ title: "파일 링크 만료", message: m }),
                  });
                }}
                className="flex-1 min-w-0 truncate text-[14px] sm:text-[13px] text-wedly-t1 hover:text-wedly-accent"
              >
                📎 {f.fileName}
              </a>
              {onRemoveFile && (
                <button
                  type="button"
                  onClick={async () => {
                    const name = f.fileName || "파일";
                    const ok = await dialog.confirm({ title: "파일 제거", message: `'${name}' 을(를) 제거하시겠습니까?`, danger: true });
                    if (ok && f.id != null) onRemoveFile(String(f.id));
                  }}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-wedly-muted hover:text-wedly-red hover:bg-wedly-bg-red transition"
                  aria-label="파일 제거"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {/* 업로드 버튼 + 파일 선택 입력칸 (보이지 않음) */}
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg border border-wedly-accent/40 hover:border-wedly-accent hover:bg-wedly-bg-blue/30 transition-colors text-[14px] sm:text-[13px] text-wedly-accent font-medium cursor-pointer",
              (uploadingFile || !onUploadFiles) && "opacity-60 cursor-not-allowed"
            )}>
              <input
                type="file"
                multiple
                className="sr-only"
                disabled={uploadingFile || !onUploadFiles}
                onChange={async (e) => {
                  const list = e.target.files;
                  if (!list || list.length === 0 || !onUploadFiles) return;
                  setUploadingFile(true);
                  try {
                    await onUploadFiles(list, field.label);
                  } finally {
                    setUploadingFile(false);
                    if (e.target) e.target.value = "";
                  }
                }}
              />
              {uploadingFile ? (
                <>
                  <div className="w-3 h-3 border-2 border-wedly-bd border-t-wedly-accent rounded-full animate-spin" />
                  업로드 중...
                </>
              ) : (
                <>+ 파일 첨부</>
              )}
            </label>
          </div>
        </div>
      </div>
    );
  }

  const displayValue = (() => {
    if (value === null || value === undefined || value === "") {
      return <span className="text-wedly-muted">{isReadonly ? "-" : "비어 있음"}</span>;
    }

    // 팀장/팀원 라벨이면 테이블 셀과 동일한 색상 칩 형태로 표시 (양쪽 디자인 100% 일치)
    const labelNormDisp = (field.label || "").replace(/\s/g, "").toLowerCase();
    const isLeader = labelNormDisp === "팀장" || labelNormDisp === "담당팀장" || labelNormDisp === "담당사무장";
    const isMember = labelNormDisp === "팀원" || labelNormDisp === "담당팀원";
    if ((isLeader || isMember) && typeof value === "string" && value.trim()) {
      const chipBg = isLeader ? "bg-wedly-bg-blue" : "bg-wedly-bg-green";
      const chipText = isLeader ? "text-wedly-accent" : "text-wedly-green";
      const dotColor = isLeader ? "bg-wedly-accent" : "bg-wedly-green";
      const names = value.split(",").map((s) => s.trim()).filter(Boolean);
      return (
        <span className="inline-flex flex-wrap gap-1">
          {names.map((n) => (
            <span
              key={n}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] sm:text-[11px] font-semibold whitespace-nowrap",
                chipBg, chipText
              )}
            >
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dotColor)} aria-hidden="true" />
              {n}
            </span>
          ))}
        </span>
      );
    }

    if (field.type === "last_edited_time") {
      return (
        <span className="text-[15px] sm:text-[13px] text-wedly-muted">
          {formatDateTime(String(value))}
        </span>
      );
    }

    if (field.type === "select" || field.type === "status") {
      const colorClass = getOptionColorClass(String(value), STATUS_COLORS);
      return (
        <span
          className={cn(
            "inline-block rounded-md px-2.5 py-0.5 text-[13px] sm:text-[12px] font-medium",
            colorClass
          )}
        >
          {String(value)}
        </span>
      );
    }

    if (field.format === "currency" && typeof value === "number") {
      return (
        <span className="text-[15px] sm:text-[13px] tabular-nums font-medium text-wedly-navy">
          {formatCurrency(value)}
        </span>
      );
    }

    if (field.type === "date" && typeof value === "string") {
      return <span className="text-[15px] sm:text-[13px] text-wedly-navy">{formatDate(value)}</span>;
    }

    // ISO 8601 자동 인식 — 등록일자 같은 컬럼 값이 "2026-05-20T01:15:14.034Z" 형태로 들어오는 경우
    // 다른 컬럼(최종 업데이트 등)과 동일한 한국 형식 ("2026.05.23 16:58") 으로 통일
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return <span className="text-[15px] sm:text-[13px] text-wedly-muted">{formatDateTime(value)}</span>;
    }

    return <span className="text-[15px] sm:text-[13px] font-medium text-wedly-navy">{String(value)}</span>;
  })();

  const handleSave = (newValue: string | number | boolean | null) => {
    setEditing(false);
    onSave(field.key, newValue);
  };

  const renderEditor = () => {
    // 다중 사람 선택 — 라벨이 "팀원" 또는 "담당 팀원" 이면 사용자 명단 다중 체크박스
    const labelNorm = (field.label || "").replace(/\s/g, "").toLowerCase();
    const isPersonMulti = labelNorm === "팀원" || labelNorm === "담당팀원";
    if (isPersonMulti) {
      return (
        <MultiPersonEditor
          value={String(value ?? "")}
          userNames={userNames || []}
          onSave={(v) => handleSave(v || null)}
          onClose={() => setEditing(false)}
        />
      );
    }

    if (field.type === "number") {
      return (
        <NumberEditor
          value={typeof value === "number" ? value : null}
          onSave={(v) => handleSave(v)}
        />
      );
    }

    if (field.type === "date") {
      return (
        <DateEditor
          value={String(value ?? "")}
          onSave={(v) => handleSave(v || null)}
        />
      );
    }

    if (field.type === "select" || field.type === "status" || field.type === "person") {
      // person 타입 필드(최초컨택자/1차 담당자/계약담당자)는 동적 사용자 명단을 옵션으로 사용.
      const isUserNameSelect = field.type === "person";
      const options = isUserNameSelect ? (userNames || []) : getFieldOptions(field.key);
      return (
        <div className="relative">
          <SelectEditor
            value={String(value ?? "")}
            options={options}
            fieldKey={field.key}
            onSave={(v) => handleSave(v || null)}
            onClose={() => setEditing(false)}
            canDelete={isAdmin}
            SelectDropdownBody={SelectDropdownBody}
          />
        </div>
      );
    }

    return (
      <TextEditor
        value={String(value ?? "")}
        onSave={(v) => handleSave(v || null)}
      />
    );
  };

  const hasValue = value !== null && value !== undefined && value !== "";

  // 컬럼 이름(라벨) 인라인 편집 — 어드민이 라벨 더블클릭 시 입력칸으로 전환
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(field.label);
  // 사용자가 방금 입력한 새 이름을 임시 보관 — 부모가 갱신 사이클이 한 박자 늦어도 즉시 새 이름이 보이게.
  // 부모(field.label)가 새 값과 일치하면 임시 보관 해제 — 영구 갱신 완료.
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  useEffect(() => { setLabelDraft(field.label); }, [field.label]);
  // 부모 라벨이 어떤 값이든 갱신되면 임시 보관 해제 — 마이그 규칙 등으로 다른 이름으로 덮어써져도
  // 옛 임시 라벨이 영원히 남는 일 방지 (부모 새 값이 우선)
  useEffect(() => {
    if (pendingLabel !== null) setPendingLabel(null);
  // 의도적으로 field.label 만 의존 — pendingLabel 도 의존하면 set 직후 useEffect 다시 발동
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.label]);
  const displayLabel = pendingLabel ?? field.label;
  const commitLabel = () => {
    const trimmed = labelDraft.trim();
    if (trimmed && trimmed !== field.label && onRenameColumn) {
      setPendingLabel(trimmed); // 즉시 새 이름 표시 — 부모 갱신 대기 안 함
      onRenameColumn(field.key, trimmed);
    } else {
      setLabelDraft(field.label);
    }
    setEditingLabel(false);
  };

  return (
    // 모바일은 2단(라벨 위 / 값 아래) — 라벨 truncate 방지 + 입력·터치 영역 확보 (사용 편의)
    // 데스크탑 (sm 이상) 은 기존 가로 정렬 유지
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-3 sm:py-2 px-1 sm:min-h-[36px] group">
      <div className="w-full sm:w-[160px] sm:flex-shrink-0 text-[13px] sm:text-[13px] font-medium sm:font-normal text-wedly-muted leading-tight sm:truncate">
        {editingLabel && onRenameColumn ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setLabelDraft(field.label); setEditingLabel(false); }
            }}
            className="w-full px-2 py-1.5 text-[16px] sm:text-[13px] min-h-[40px] sm:min-h-[28px] border border-wedly-accent rounded-md outline-none focus:ring-2 focus:ring-wedly-accent/20 bg-white text-wedly-t1"
          />
        ) : (
          <span
            onDoubleClick={onRenameColumn ? () => { setLabelDraft(displayLabel); setEditingLabel(true); } : undefined}
            className={onRenameColumn ? "cursor-text hover:text-wedly-t2 transition-colors" : ""}
            title={onRenameColumn ? "더블클릭으로 컬럼 이름 수정" : undefined}
          >
            {displayLabel}
          </span>
        )}
      </div>
      {/* overflow-hidden 제거: 직전 변경에서 가로 잘림 막으려 넣었으나 자식 드롭다운(absolute)이 잘려서 안 보임
          → 가로 잘림 처리는 부모 Tab content 의 overflow-x-hidden 에 맡기고, 여기선 min-w-0 만 유지 */}
      <div className="flex-1 text-[15px] sm:text-[13px] text-wedly-t1 min-w-0 relative">
        {editing && !isReadonly ? (
          renderEditor()
        ) : (
          <div
            onClick={isReadonly ? undefined : () => setEditing(true)}
            className={cn(
              // 모바일 터치 영역 확보 (min-h 40px) — 손가락으로 정확히 누를 수 있게
              "rounded-md px-2 sm:px-1 py-1.5 sm:py-0.5 -mx-1 min-h-[40px] sm:min-h-[26px] flex items-center justify-between gap-2",
              !isReadonly && "cursor-pointer hover:bg-wedly-bg-gray transition-colors active:bg-wedly-bg-blue/30"
            )}
          >
            <div className="flex-1 min-w-0">{displayValue}</div>
            {/* PC 호버 시 값 삭제 X 버튼 — 모바일과 일관성 위해 제거. 값 비우기는 편집 모드에서 가능. */}
          </div>
        )}
      </div>
    </div>
  );
});
