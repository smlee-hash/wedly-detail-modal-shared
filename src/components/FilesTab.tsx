"use client";

// 상세 모달 파일 패널 — 하이브·일루아·ERP 공용 부품.
//   FILE_TAG_DEFS / detectFileTag / getFileTagDef : 파일명 → 분류 추론 + 색상 배지
//   FilesTab : 업로드·카테고리 분류·미리보기·삭제 패널
//
// 앱-내부 의존성을 두지 않는다(공용 부품 규칙):
//   - 삭제 확인 / 안내는 자체 위들리 모달로 그린다(window.confirm 금지, @/lib 의존 없음).
//   - 파일 링크 만료 자동 갱신은 선택 prop onOpenFile 로 주입(없으면 평범하게 새 탭 열기).
//   - 다운로드 버튼은 downloadApiPath 가 주어질 때만 표시.
//   - 업로드/프록시 경로는 prop 으로 조정 가능(기본값은 하이브·일루아 공통).
// 사용 앱은 자체 위들리 디자인 토큰(bg-wedly-accent 등)을 globals.css 에 정의해야 한다.

import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/cn";

// 파일 한 건의 메타. 모든 필드 선택 — 앱별 로컬 타입과 구조 호환.
export interface FileMeta {
  id?: number | string;
  fileName?: string;
  objectKey?: string;
  contentType?: string;
  // ERP에서 업로드한 파일은 url 필드로 직접 링크 (proxy 미사용)
  url?: string;
  category?: string;
}

// ---------------------------------------------------------------------------
// 파일 태그 (파일명 키워드 → 자동 분류 + 색상 배지)
// ---------------------------------------------------------------------------

// 파일 태그 정의 — 파일명 키워드로 자동 분류 + 색상별 배지
const FILE_TAG_DEFS: Array<{
  key: string;
  label: string;
  bg: string;
  text: string;
  border: string;
  patterns: string[];
}> = [
  { key: "계약서",       label: "계약서",       bg: "bg-blue-100",    text: "text-blue-700",    border: "border-blue-200",    patterns: ["계약서", "_계약_", "contract"] },
  { key: "사업자등록증", label: "사업자등록증", bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200", patterns: ["사업자등록", "사업자_등록"] },
  { key: "재무제표",     label: "재무제표",     bg: "bg-purple-100",  text: "text-purple-700",  border: "border-purple-200",  patterns: ["재무제표", "결산", "손익계산서", "대차대조표", "부가세", "법인세", "신고서"] },
  { key: "리포트",       label: "리포트",       bg: "bg-orange-100",  text: "text-orange-700",  border: "border-orange-200",  patterns: ["리포트", "report", "분석"] },
  { key: "기타자료",     label: "기타",         bg: "bg-slate-100",   text: "text-slate-700",   border: "border-slate-200",   patterns: [] },
];
export function detectFileTag(filename: string): string {
  const lower = (filename || "").toLowerCase();
  for (const t of FILE_TAG_DEFS) {
    for (const p of t.patterns) {
      if (lower.includes(p.toLowerCase())) return t.key;
    }
  }
  return "기타자료";
}
function getFileTagDef(key: string) {
  return FILE_TAG_DEFS.find((t) => t.key === key) || FILE_TAG_DEFS[FILE_TAG_DEFS.length - 1];
}

// 실제 파일 컬럼 카테고리(검토보고서·경정청구 신고서 등) 용 동적 색상.
// FILE_TAG_DEFS 같은 고정 정의가 없는 카테고리도 이름 기준으로 일관된 색을 부여.
const CATEGORY_PALETTE: Array<{ bg: string; text: string; border: string }> = [
  { bg: "bg-blue-100",    text: "text-blue-700",    border: "border-blue-200" },
  { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200" },
  { bg: "bg-purple-100",  text: "text-purple-700",  border: "border-purple-200" },
  { bg: "bg-orange-100",  text: "text-orange-700",  border: "border-orange-200" },
  { bg: "bg-pink-100",    text: "text-pink-700",    border: "border-pink-200" },
  { bg: "bg-cyan-100",    text: "text-cyan-700",    border: "border-cyan-200" },
  { bg: "bg-amber-100",   text: "text-amber-700",   border: "border-amber-200" },
];
const NEUTRAL_COLOR = { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" };
function colorForCategory(cat: string): { bg: string; text: string; border: string } {
  const c = (cat || "").trim();
  if (!c || c === "기타자료" || c === "기타") return NEUTRAL_COLOR;
  // 고정 정의가 있으면 그 색 우선 (계약서·재무제표 등)
  const fixed = FILE_TAG_DEFS.find((t) => t.key === c || t.label === c);
  if (fixed && fixed.key !== "기타자료") return { bg: fixed.bg, text: fixed.text, border: fixed.border };
  // 그 외 — 이름 해시로 팔레트에서 일관된 색 선택
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

// ---------------------------------------------------------------------------
// FilesTab — 업로드·카테고리 분류·미리보기·삭제
// ---------------------------------------------------------------------------

export function FilesTab({
  files,
  pageId,
  onFilesChange,
  filterCategory,
  defaultUploadCategory,
  uploadButtonLabel,
  emptyMessage,
  disabled,
  categoryOptions,
  // 선택 주입 — 앱별 차이를 흡수 (기본값은 안전한 평범 동작)
  uploadApiPath = "/api/upload",
  proxyApiBase = "/api/files/proxy",
  downloadApiPath,
  onOpenFile,
}: {
  files: FileMeta[];
  pageId: string;
  onFilesChange: (next: FileMeta[]) => void;
  filterCategory?: string;
  defaultUploadCategory: string;
  uploadButtonLabel: string;
  emptyMessage: string;
  disabled?: boolean;
  // 실제 파일 카테고리 목록(검토보고서·경정청구 신고서 등). 주어지면 드롭다운·표시를
  // 이 목록 기반으로 한다. 없으면 옛 FILE_TAG_DEFS(계약서/재무제표 등) 5종으로 동작.
  categoryOptions?: string[];
  // 업로드 API 경로(기본 /api/upload). 응답: { success, data | files[], skipped? }.
  uploadApiPath?: string;
  // objectKey 보관소 파일을 열 때 통로 경로(기본 /api/files/proxy).
  proxyApiBase?: string;
  // 주어지면 각 파일 행에 다운로드 버튼 표시(이 경로로 링크). 없으면 다운로드 버튼 숨김.
  downloadApiPath?: string;
  // 주어지면 파일 열기 클릭을 가로채 이 함수로 처리(노션 임시 링크 만료 자동 갱신 등).
  // 없으면 a 태그가 평범하게 새 탭으로 연다.
  onOpenFile?: (args: { href: string; entryId: string; fileName: string; category?: string }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCategoryIdx, setEditingCategoryIdx] = useState<number | null>(null);
  // 위들리 자체 모달 상태 (window.confirm/alert 금지)
  const [pendingRemove, setPendingRemove] = useState<FileMeta | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = filterCategory
    ? files.filter((f) => (f.category || "기타자료") === filterCategory)
    : files;

  // 카테고리 드롭다운 외부 클릭 시 닫기 — mousedown 이 click 보다 먼저 발생해 다른 드롭다운 토글과 race 가 없음
  useEffect(() => {
    if (editingCategoryIdx === null) return;
    const handler = () => setEditingCategoryIdx(null);
    // 현재 클릭 사이클 직후부터 등록 (열기 클릭이 즉시 닫히지 않도록)
    const t = window.setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [editingCategoryIdx]);

  const changeFileCategory = (visibleIdx: number, newCategoryKey: string) => {
    const target = visible[visibleIdx];
    if (!target) return;
    const next = files.map((f) => (f === target ? { ...f, category: newCategoryKey } : f));
    onFilesChange(next);
    setEditingCategoryIdx(null);
  };

  const handleSelectFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!pageId) {
      setError("저장된 항목에만 파일을 업로드할 수 있습니다 (먼저 등록 후 시도)");
      return;
    }
    setError(null);
    setUploading(true);
    let totalSkipped = 0;
    try {
      const next: FileMeta[] = [...files];
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(uploadApiPath, { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `${file.name} 업로드 실패`);
        // ZIP 자동 해제 — 압축 안의 여러 파일이면 각각 추가 (단일 파일 응답이면 data 하나)
        const uploaded: Array<{ id: string; fileName: string; url: string; mimeType?: string }> =
          Array.isArray(json.files) ? json.files : (json.data ? [json.data] : []);
        if (typeof json.skipped === "number") totalSkipped += json.skipped;
        for (const u of uploaded) {
          // 파일명에서 태그 자동 감지 — 매칭 안 되면 defaultUploadCategory 로 fallback
          const detected = detectFileTag(u.fileName as string);
          const category = detected !== "기타자료" ? detected : (defaultUploadCategory || "기타자료");
          next.push({
            id: u.id,
            fileName: u.fileName,
            url: u.url,
            contentType: u.mimeType,
            category,
          });
        }
      }
      onFilesChange(next);
      // 압축 안에서 제외된 파일이 있으면 안내 (위험 파일·크기 초과·개수 초과 등)
      if (totalSkipped > 0) {
        setNoticeMsg(
          `압축 안의 ${totalSkipped}개 파일은 제외됐습니다.\n(위험 형식, 크기 초과, 또는 개수 한도 초과)`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const confirmRemove = () => {
    const file = pendingRemove;
    setPendingRemove(null);
    if (!file) return;
    const next = files.filter((f) => f !== file);
    onFilesChange(next);
  };

  return (
    <div className="space-y-3">
      {/* Upload button */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          onChange={(e) => handleSelectFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || disabled || !pageId}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition",
            uploading || disabled || !pageId
              ? "bg-wedly-bg-gray text-wedly-muted cursor-not-allowed"
              : "bg-wedly-accent text-white hover:opacity-90",
          )}
        >
          {uploading ? (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="animate-spin">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>업로드 중…</span>
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>{uploadButtonLabel}</span>
            </>
          )}
        </button>
        <span className="text-[11px] text-wedly-muted">최대 50MB · 여러 파일 동시 선택 가능</span>
      </div>

      {error && (
        <p className="text-[12px] text-wedly-red bg-wedly-bg-red/40 rounded-md px-3 py-1.5">{error}</p>
      )}

      {/* File list */}
      {visible.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-10 h-10 rounded-full bg-wedly-bg-gray flex items-center justify-center mx-auto mb-2">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="text-wedly-muted">
              <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-[13px] text-wedly-muted">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((f, i) => {
            const href = f.url
              ? f.url
              : `${proxyApiBase}?objectKey=${encodeURIComponent(f.objectKey || "")}`;
            // 동기화로 들어온 외부 첨부파일(objectKey 보유)은 여기서 삭제 못함 (소유권 다름)
            const canRemove = !!f.id || !!f.url;
            // 내려받기 링크 — 서버 통로가 어느 보관소든 받아서 "저장"으로 돌려줌(보기 아님).
            const canDownload = !!(f.url || f.objectKey);
            let downloadHref = "";
            if (downloadApiPath) {
              const dlParams = new URLSearchParams();
              dlParams.set("name", f.fileName || "파일");
              if (f.url) dlParams.set("url", f.url);
              if (f.objectKey) dlParams.set("objectKey", f.objectKey);
              if (pageId) dlParams.set("entryId", pageId);
              if (f.fileName) dlParams.set("fileName", f.fileName);
              downloadHref = `${downloadApiPath}?${dlParams.toString()}`;
            }
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-wedly-bg-gray hover:bg-wedly-bg-blue/40 transition-colors text-[13px] group"
              >
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    // onOpenFile 가 주어지면 그것으로 처리(노션 임시 링크 1시간 만료 자동 갱신 등).
                    // 없으면 a 태그가 평범하게 새 탭으로 연다.
                    if (onOpenFile) {
                      e.preventDefault();
                      onOpenFile({
                        href,
                        entryId: pageId,
                        fileName: f.fileName || "파일",
                        category: f.category,
                      });
                    }
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-wedly-muted flex-shrink-0">
                    <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <span className="flex-1 truncate text-wedly-t1 group-hover:text-wedly-accent">
                    {f.fileName || "파일"}
                  </span>
                </a>
                {(() => {
                  const useRealCategories = Array.isArray(categoryOptions) && categoryOptions.length > 0;
                  const isEditing = editingCategoryIdx === i;

                  // ── 실제 파일 컬럼 카테고리 모드 (검토보고서·경정청구 신고서 등) ──
                  if (useRealCategories) {
                    // 표시값: 저장된 category 그대로. 없으면 "기타".
                    // (파일명 자동 추측은 고정 5종 체계라 실제 컬럼 카테고리와 섞이면 혼란 → 이 모드에선 사용 안 함)
                    const raw = (f.category || "").trim();
                    const shown = (raw && raw !== "기타자료") ? raw : "기타";
                    const color = colorForCategory(shown);
                    // 드롭다운 옵션 = 실제 카테고리 목록 + (현재값이 목록에 없으면 추가) + "기타"
                    const opts = [...categoryOptions!];
                    if (shown && shown !== "기타" && !opts.includes(shown)) opts.unshift(shown);
                    if (!opts.includes("기타")) opts.push("기타");
                    return (
                      <div
                        className="relative flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setEditingCategoryIdx(isEditing ? null : i)}
                          disabled={disabled}
                          title="카테고리 변경"
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-semibold border whitespace-nowrap transition flex items-center gap-1",
                            color.bg, color.text, color.border,
                            !disabled && "hover:brightness-95 cursor-pointer",
                            disabled && "cursor-default",
                          )}
                        >
                          {shown}
                          {!disabled && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="opacity-60">
                              <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        {isEditing && (
                          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-wedly-bd rounded-lg shadow-lg overflow-hidden min-w-[160px] max-h-72 overflow-y-auto py-1">
                            {opts.map((opt) => {
                              const isSelected = shown === opt;
                              const c = colorForCategory(opt);
                              // "기타" 선택 시 저장값은 빈 분류로 — 실제 카테고리 아닌 기본
                              const saveKey = opt === "기타" ? "기타자료" : opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => changeFileCategory(i, saveKey)}
                                  className={cn(
                                    "w-full px-3 py-1.5 text-[12px] text-left transition flex items-center gap-2",
                                    isSelected ? "bg-wedly-bg-blue/40 font-semibold text-wedly-accent" : "text-wedly-t2 hover:bg-wedly-bg-gray",
                                  )}
                                >
                                  <span className={cn("inline-block w-2.5 h-2.5 rounded-sm border", c.bg, c.border)} aria-hidden="true"></span>
                                  <span className="flex-1 truncate">{opt}</span>
                                  {isSelected && (
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                      <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // ── 옛 호환 모드 (고정 5종: 계약서/사업자등록증/재무제표/리포트/기타) ──
                  // 표시 태그 우선순위:
                  //   1) 사용자가 명시적으로 저장한 file.category (수동 선택)
                  //   2) 파일명에서 감지된 키워드가 '기타자료' 가 아니면 그것을 사용
                  //   3) fallback '기타자료'
                  const detected = detectFileTag(f.fileName || "");
                  const tagKey = (f.category && f.category !== "기타자료")
                    ? f.category
                    : (detected !== "기타자료" ? detected : "기타자료");
                  const tag = getFileTagDef(tagKey);
                  return (
                    <div
                      className="relative flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setEditingCategoryIdx(isEditing ? null : i)}
                        disabled={disabled}
                        title="카테고리 변경"
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-semibold border whitespace-nowrap transition flex items-center gap-1",
                          tag.bg, tag.text, tag.border,
                          !disabled && "hover:brightness-95 cursor-pointer",
                          disabled && "cursor-default",
                        )}
                      >
                        {tag.label}
                        {!disabled && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="opacity-60">
                            <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      {isEditing && (
                        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-wedly-bd rounded-lg shadow-lg overflow-hidden min-w-[140px] py-1">
                          {FILE_TAG_DEFS.map((t) => {
                            const isSelected = tagKey === t.key;
                            return (
                              <button
                                key={t.key}
                                type="button"
                                onClick={() => changeFileCategory(i, t.key)}
                                className={cn(
                                  "w-full px-3 py-1.5 text-[12px] text-left transition flex items-center gap-2",
                                  isSelected ? "bg-wedly-bg-blue/40 font-semibold text-wedly-accent" : "text-wedly-t2 hover:bg-wedly-bg-gray",
                                )}
                              >
                                <span className={cn("inline-block w-2.5 h-2.5 rounded-sm border", t.bg, t.border)} aria-hidden="true"></span>
                                <span className="flex-1">{t.label}</span>
                                {isSelected && (
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {downloadApiPath && canDownload && (
                  <a
                    href={downloadHref}
                    download={f.fileName || "파일"}
                    onClick={(e) => e.stopPropagation()}
                    className="w-6 h-6 rounded text-wedly-muted hover:bg-wedly-bg-blue/40 hover:text-wedly-accent inline-flex items-center justify-center flex-shrink-0 transition"
                    title="다운로드"
                    aria-label="다운로드"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                )}
                {canRemove && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPendingRemove(f); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded text-wedly-muted hover:bg-wedly-bg-red/40 hover:text-wedly-red inline-flex items-center justify-center flex-shrink-0 transition"
                    title="파일 제거"
                    aria-label="파일 제거"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 파일 제거 확인 — 위들리 자체 모달 (window.confirm 금지) */}
      {pendingRemove && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPendingRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-wedly-bd bg-white shadow-2xl animate-modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">파일 제거</h3>
            </div>
            <div className="px-5 py-4 text-[13px] text-wedly-t2">
              {`'${pendingRemove.fileName || "파일"}'을(를) 목록에서 제거하시겠습니까?`}
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemove(null)}
                className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmRemove}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-red rounded-lg hover:brightness-110 transition-colors"
              >
                제거
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 안내 — 위들리 자체 모달 (window.alert 금지) */}
      {noticeMsg && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setNoticeMsg(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-wedly-bd bg-white shadow-2xl animate-modal-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">일부 파일 제외</h3>
            </div>
            <div className="px-5 py-4 text-[13px] text-wedly-t2 whitespace-pre-line">{noticeMsg}</div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end">
              <button
                type="button"
                onClick={() => setNoticeMsg(null)}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
