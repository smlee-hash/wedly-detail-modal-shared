"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { cn } from "../../lib/cn";
import { parsePersonItem, splitPersonListSafe } from "../../lib/person-id";
import { openFileWithRefresh } from "../../lib/open-file-with-refresh";

/** 컬럼 라벨로 적절한 후보 명단 선택 — 팀장 칸엔 팀장 후보, 팀원 칸엔 팀원 후보, 그 외는 전체. */
function pickUserCandidates(
  label: string | undefined,
  dir: { all: string[]; leaders: string[]; members: string[] },
): string[] {
  const n = (label || "").replace(/\s/g, "").toLowerCase();
  if (n === "팀장" || n === "담당팀장" || n === "담당사무장") return dir.leaders;
  if (n === "팀원" || n === "담당팀원") return dir.members;
  return dir.all;
}
import { formatCurrency, formatDate, formatDateTime, STATUS_COLORS } from "../../lib/utils";
import MeetingsTab from "../MeetingsTab";
import { useFieldOrder } from "../../hooks/use-field-order";
import CustomSelect from "../CustomSelect";
import { TextEditor, NumberEditor, DateEditor, FieldRowAdminMenu, SectionAdminMenu, DraggableFieldsSection as SharedDraggableFieldsSection, timeAgo, SectionEditorAddModal, SectionEditorDeleteConfirm, PanelEditorAddModal, PanelManagerModal } from "@wedly/ui-shared";
import {
  READONLY_TYPES,
  getOptionColorClass,
  getFieldOptions,
} from "../../lib/options";

// ---------------------------------------------------------------------------
// Types & 주입 — 하이브 전용 직접호출(권한·확인창·담당자명단·HistoryPanel·정산탭·서버주소)은
//   모두 입력값(props)·render-prop 으로 빼냈다(1단계-C). 아직 어느 앱에도 연결 안 된 신규물.
// ---------------------------------------------------------------------------

// 공용 타입 — FieldEditors 와 공유 (순환 의존 방지).
import type { RowData, FileMeta, DetailField } from "./detail-types";
// 필드/셀 편집 부품(주입식 공용판, 1단계-B) + 그 입력값 타입.
import { EditableFieldRow } from "./FieldEditors";
// 파일 패널 — 공용 부품.
import { FilesTab } from "../FilesTab";
// 설정 약속(앱이 넘겨주는 입력값) + 보조 타입.
import type {
  SharedDetailModalProps,
  ShellRowData,
  ShellDialog,
  ShellFieldDef,
  ShellHistoryColor,
  SelectDropdownBodyComponent,
  OpenFileFn,
} from "./config";

// 히스토리 카테고리 색상표 — 예전 하이브 HistoryPanel 의 CATEGORY_COLOR_CLASS 를 공용으로 이동.
// (카테고리 추가 모달의 색 선택에 쓰임. 실제 댓글 목록·탭은 renderHistoryPanel 로 주입됨)
const CATEGORY_COLOR_CLASS: Record<ShellHistoryColor, string> = {
  gray: "bg-wedly-bg-gray text-wedly-navy border-wedly-bd",
  blue: "bg-wedly-bg-blue text-wedly-accent border-wedly-bd-blue",
  green: "bg-wedly-bg-green text-wedly-green border-wedly-bd-green",
  purple: "bg-wedly-bg-purple text-wedly-purple border-[var(--wedly-purple)]/30",
  orange: "bg-wedly-bg-yellow text-wedly-orange border-wedly-orange/30",
  red: "bg-wedly-bg-red text-wedly-red border-wedly-bd-red",
  gold: "bg-wedly-bg-yellow text-wedly-gold border-wedly-gold/30",
};


// 파일 태그 함수(FILE_TAG_DEFS·detectFileTag·getFileTagDef)·FilesTab 은 ./FilesTab 로 분리 (단계 15).

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

// 상세창에 그릴 컬럼 정의(예전 하이브 CONTRACT_FIELDS 모듈 상수)는 이제 입력값(fields)으로 받는다(1단계-C).
// 본문은 컴포넌트 안에서 옛 이름(CONTRACT_FIELDS = fields, COLUMNS = columns)으로 별칭해 그대로 참조한다.

// [removed] FIELD_ORDER_STORAGE_KEY — 컬럼 순서는 useFieldOrder hook 으로 server 저장.

// ColumnDef → DetailField 변환 — 테이블에는 있지만 CONTRACT_FIELDS 에 정의 안 된 컬럼을
// 상세모달 "기타" 섹션에서 표시하기 위함.
// 호환 안 되는 type(formula, file, status, checkbox, auto_increment_id 등)은
// last_edited_time 으로 매핑해 readonly 로 표시 — EditableFieldRow 가 편집 진입을 막아준다.
function columnToDetailField(c: ShellFieldDef): DetailField {
  const editableTypes: ReadonlyArray<DetailField["type"]> = [
    "text", "number", "date", "select", "multi_select", "person",
    "email", "phone_number", "file",
  ];
  const readonlyPassthrough: ReadonlyArray<DetailField["type"]> = [
    "last_edited_time", "last_edited_by",
  ];
  let mapped: DetailField["type"];
  if ((editableTypes as readonly string[]).includes(c.type)) {
    mapped = c.type as DetailField["type"];
  } else if ((readonlyPassthrough as readonly string[]).includes(c.type)) {
    mapped = c.type as DetailField["type"];
  } else if (c.type === "formula") {
    // 수식 컬럼은 직접 편집 불가 — readonly 로 표시. 값은 자동 계산되어 저장됨
    mapped = "last_edited_time";
  } else {
    // file / status / checkbox / auto_increment_id / title → readonly 표시
    mapped = "last_edited_time";
  }
  // 라벨 정규화 — 사용자 의도 라벨 우선, 자동 보정은 라벨이 비어있거나 키 형태로 노출된 경우만:
  //   - 라벨이 비어 있거나 키와 동일하거나 키 패턴 그대로면 → "팀원"/"팀장" 자동 보정
  //   - 사용자가 명시적으로 "담당 팀원" 같은 다른 라벨을 설정했으면 그 라벨 보존 (덮어쓰지 않음)
  let displayLabel = c.label;
  const looksLikeKey = !displayLabel || displayLabel === c.key || /^team_(member|leader)(_|$)/.test(displayLabel);
  if (looksLikeKey) {
    if (c.key.startsWith("team_member_") || c.key === "team_member") displayLabel = "팀원";
    else if (c.key.startsWith("team_leader_") || c.key === "team_leader") displayLabel = "팀장";
  }
  return { key: c.key, label: displayLabel, type: mapped, format: c.format };
}

// 같은 컬럼이 표 셀과 상세 모달에서 다른 값으로 보이는 문제 방지:
// 표 셀의 EditableCell (SubsidyClient.tsx) 과 동일한 보정 로직을 한 곳에 모음.
// 옛 데이터의 team_member_<oldTs> 키와 마이그 후 생성된 team_member_<newTs> 키가
// 어긋난 경우(같은 행에 두 개 키 공존, 한쪽만 값) — 라벨이 팀장/팀원이면 같은 패턴의 다른 키에서 값 찾아 채움.
function resolveFieldValue(row: RowData | null, field: DetailField): string | number | boolean | null {
  if (!row) return null;
  const direct = row[field.key];
  if (direct != null && direct !== "") return direct as string | number | boolean | null;
  const norm = (field.label || "").replace(/\s/g, "").toLowerCase();
  const isLeader = norm === "팀장" || norm === "담당팀장" || norm === "담당사무장";
  const isMember = norm === "팀원" || norm === "담당팀원";
  if (isLeader || isMember) {
    for (const rk of Object.keys(row)) {
      if (rk === field.key || rk.startsWith("_")) continue;
      if (isLeader && (rk.startsWith("team_leader_") || rk === "team_leader")) {
        const rv = row[rk]; if (rv != null && rv !== "") return rv as string | number | boolean | null;
      }
      if (isMember && (rk.startsWith("team_member_") || rk === "team_member")) {
        const rv = row[rk]; if (rv != null && rv !== "") return rv as string | number | boolean | null;
      }
    }
  }
  return (direct ?? null) as string | number | boolean | null;
}

// ---------------------------------------------------------------------------
// Inline Editors (existing — kept verbatim)
// ---------------------------------------------------------------------------

// TextEditor·NumberEditor·DateEditor 는 @wedly/ui-shared 로 이전됨 (모듈화 단계 9)

// MultiPersonEditor·SelectEditor·EditableFieldRow 는 ./FieldEditors 로 분리 (모듈화 단계 14).
// 본 파일에서는 import 로 가져옴.


// HistoryPanel + 코멘트 캐시·prefetch 부품은 별도 파일로 분리 — 모듈화 단계 13.
// 본 파일에서는 ./HistoryPanel 에서 import.



// ---------------------------------------------------------------------------
// FieldRowAdminMenu — 어드민이 각 필드의 위치(섹션)를 변경하는 메뉴.
// 위들리 디자인 토큰 사용. 외부 클릭 시 닫힘.
// ---------------------------------------------------------------------------

// FieldRowAdminMenu·SectionAdminMenu 는 @wedly/ui-shared 로 이전됨 (단계 10)

/**
 * DraggableFieldsSection — 보관함 부품의 얇은 어댑터
 *
 * useFieldOrder 훅 (도메인: 서버 저장 + 위들리 다이얼로그) 을 이 섹션 단위로 호출하고,
 * 결과를 보관함의 SharedDraggableFieldsSection 에 props 로 전달.
 * 행 본문(EditableFieldRow) 과 행 옆 어드민 메뉴(FieldRowAdminMenu) 도 슬롯으로 주입.
 */
function DraggableFieldsSection({
  sectionId,
  sectionLabel,
  sectionFields,
  scope,
  isAdmin,
  localRow,
  handleFieldSave,
  userDirectory,
  allSections,
  onMoveColumn,
  onHideColumn,
  onDeleteColumn,
  isCustomColumn,
  onAddColumn,
  deleteMode = false,
  editMode = false,
  onChangeColumnType,
  onRenameColumn,
  onJumpToFiles,
  onUploadFiles,
  onRemoveFile,
  dialog,
  openFile,
  selectDropdownBody: SelectDropdownBody,
}: {
  sectionId: string;
  sectionLabel?: string;
  sectionFields: DetailField[];
  scope: string;
  isAdmin: boolean;
  localRow: RowData;
  handleFieldSave: (key: string, value: string | number | boolean | null) => void;
  userDirectory: { all: string[]; leaders: string[]; members: string[] };
  allSections?: Array<{ id: string; label: string; kind?: string }>;
  onMoveColumn?: (columnKey: string, targetSectionId: string) => void;
  onHideColumn?: (key: string) => void;
  onDeleteColumn?: (key: string) => void;
  isCustomColumn?: (key: string) => boolean;
  onAddColumn?: (sectionId: string, sectionLabel: string) => void;
  deleteMode?: boolean;
  editMode?: boolean;
  onChangeColumnType?: (key: string) => void;
  onRenameColumn?: (key: string, newLabel: string) => void;
  onJumpToFiles?: (category: string) => void;
  onUploadFiles?: (files: FileList, category: string) => Promise<void> | void;
  onRemoveFile?: (fileId: string) => void;
  dialog: ShellDialog;
  openFile: OpenFileFn;
  selectDropdownBody: SelectDropdownBodyComponent;
}) {
  const {
    orderedFields,
    draggingKey,
    dragOverKey,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    isOrderLoaded,
  } = useFieldOrder<DetailField>(scope, sectionId, sectionFields, isAdmin && editMode, dialog);

  return (
    <SharedDraggableFieldsSection<DetailField>
      sectionId={sectionId}
      sectionLabel={sectionLabel}
      isAdmin={isAdmin}
      editMode={editMode}
      deleteMode={deleteMode}
      orderedFields={orderedFields}
      isOrderLoaded={isOrderLoaded}
      draggingKey={draggingKey}
      dragOverKey={dragOverKey}
      handleDragStart={handleDragStart}
      handleDragOver={handleDragOver}
      handleDragLeave={handleDragLeave}
      handleDrop={handleDrop}
      handleDragEnd={handleDragEnd}
      onHideColumn={onHideColumn}
      onAddColumn={onAddColumn}
      renderRow={(field) => (
        <EditableFieldRow
          field={field}
          value={resolveFieldValue(localRow, field)}
          onSave={handleFieldSave}
          userNames={pickUserCandidates(field.label, userDirectory)}
          row={localRow}
          onJumpToFiles={onJumpToFiles}
          onUploadFiles={onUploadFiles}
          onRemoveFile={onRemoveFile}
          onRenameColumn={editMode ? onRenameColumn : undefined}
          isAdmin={isAdmin}
          dialog={dialog}
          openFile={openFile}
          SelectDropdownBody={SelectDropdownBody}
        />
      )}
      renderAdminMenu={
        allSections && onMoveColumn
          ? (field) => (
              <FieldRowAdminMenu
                fieldKey={field.key}
                fieldLabel={field.label}
                currentSectionId={sectionId}
                allSections={allSections}
                onMoveColumn={onMoveColumn}
                onHideColumn={onHideColumn}
                onDeleteColumn={onDeleteColumn}
                canDelete={isCustomColumn ? isCustomColumn(field.key) : false}
                onChangeType={onChangeColumnType}
                canChangeType={isCustomColumn ? isCustomColumn(field.key) : false}
              />
            )
          : undefined
      }
    />
  );
}


// ---------------------------------------------------------------------------
// DetailModal (main)
// ---------------------------------------------------------------------------

type ErpDetailSection = { id: string; label: string; kind?: string; fieldKeys?: string[]; removable?: boolean; panelId?: string };

// 입력값은 공용 설정 약속(config.ts) 으로 일원화 — 예전 하이브 Props 와 1:1 대응 +
// 새로 빼낸 주입값(권한·서버연결·이력/정산 렌더·드롭다운·확인창·명단·제목키 등).
type Props = SharedDetailModalProps;

export default function DetailModalShell({
  row,
  onClose,
  // ── 새로 빼낸 주입값(앱별) ──
  fields,
  columns = fields,
  isAdmin,
  dataSource,
  renderHistoryPanel,
  renderSettlementTab,
  selectDropdownBody: SelectDropdownBody,
  dialog: injectedDialog,
  userDirectory: userDirectoryProp,
  onFieldChange,
  primaryFieldKey,
  newRowTitle = "새 항목 등록",
  untitledLabel = "상세",
  // ── 예전 하이브 입력값(이름 유지) ──
  onCreate,
  initialPanel = "properties",
  onCommentCount,
  disabledColumns = [],
  focusCommentId,
  onFocusHandled,
  sections: sectionsProp,
  scope = "tax-amendment",
  onHideColumn,
  onUnhideColumn,
  unhidableColumnKeys,
  onDeleteColumn,
  isCustomColumn,
  customColumns = [],
  onAddColumnToSection,
  sectionOrder = [],
  onReorderSections,
  onChangeColumnType,
  onRenameColumn,
  meetingFieldLabels,
  onChangeMeetingLabels,
  showOtherSection = false,
  onToggleOtherSection,
  onAddSection,
  onDeleteSection,
  customSectionIds = [],
  historyCategories,
  onAddHistoryCategory,
  onDeleteHistoryCategory,
  hiddenHistoryCategoryIds = [],
  onHideHistoryCategory,
  onUnhideHistoryCategory,
  onRenameHistoryCategory,
  onReorderHistoryCategories,
  customPanels = [],
  onAddCustomPanel,
  onDeleteCustomPanel,
  onRenameCustomPanel,
  detailSubSections,
  onUpdateDetailSubSections,
}: Props) {
  // 예전 하이브 모듈 상수(CONTRACT_FIELDS/COLUMNS)를 입력값으로 별칭 — 본문 참조를 한 줄도 안 바꾸고 그대로 둔다(1단계-C).
  const CONTRACT_FIELDS = fields;
  const COLUMNS = columns;
  // ─── 컬럼-섹션 매핑 — 어드민이 컬럼의 위치(섹션)를 변경할 수 있게 함 ───
  // visibleFields 가 차수 카드로 옮긴 키를 제외하려고 sectionMapping 을 참조하므로 위쪽에 선언.
  const [sectionMapping, setSectionMapping] = useState<Record<string, string>>({});
  // 차수 카드 컴포넌트 강제 리마운트용 — 컬럼 이동 직후 카드의 컬럼 정의를 즉시 재조회시키기 위해
  const [tieredReloadToken, setTieredReloadToken] = useState(0);
  // (옛 자동 마이그 효과가 제거되면서 manualMoveInProgressRef / manualMoveVersion 도 더 이상 필요 없음 — 정리됨)

  // contract 섹션의 useFieldOrder 입력 — CONTRACT_FIELDS 뿐 아니라 어드민이 추가한 사용자 정의 컬럼과
  // row 안전망 컬럼까지 모두 포함. 이렇게 해야 contract 섹션에 매핑된 모든 컬럼(기본 + 사용자 추가)이
  // 드래그앤드롭으로 순서 변경 가능. (이전엔 CONTRACT_FIELDS 만 다뤄서 사용자 추가 컬럼은 drag 불가)
  const visibleFields = useMemo(() => {
    // 차수 카드로 옮긴 컬럼을 일반 칸에서 제외 — 다음 출처들을 모두 본다:
    // 1) sectionMapping — 그 target 이 차수 카드 섹션 id 인지 검사 (id 는 환경마다 다름: contract/refund/payment 등)
    // 2) row 데이터의 차수 카드 컨테이너 안 키들 (계약정보_차수 / 환불정보_차수 JSON 객체의 키)
    // 3) 컬럼 라벨이 같은 다른 키들 (별도 키 잔존 케이스)
    //
    // 차수 카드 섹션 id 목록 동적 수집 — sectionsProp 의 라벨/kind 로 판정 (id 가 'payment' 같은 임의 값이어도 잡힘)
    const tieredSectionIds = new Set<string>(["contract", "refund"]);
    for (const s of (sectionsProp || [])) {
      const lbl = (s.label || "").replace(/\s+/g, "");
      if (s.kind === "tiered-contract" || s.kind === "tiered-refund" || lbl === "계약정보" || lbl === "환불정보") {
        if (s.id) tieredSectionIds.add(s.id);
      }
    }
    const movedToTiered = new Set<string>();
    for (const [k, target] of Object.entries(sectionMapping)) {
      if (tieredSectionIds.has(target)) movedToTiered.add(k);
    }
    for (const containerKey of ["계약정보_차수", "환불정보_차수"]) {
      const raw = (row as Record<string, unknown> | null)?.[containerKey];
      if (typeof raw === "string" && raw.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const tier of parsed) {
              if (tier && typeof tier === "object") {
                for (const k of Object.keys(tier as Record<string, unknown>)) {
                  if (k && !k.startsWith("_")) movedToTiered.add(k);
                }
              }
            }
          }
        } catch { /* JSON 아니면 건너뜀 */ }
      }
    }
    // 라벨 단위로도 거름 — 같은 라벨의 다른 키가 행 데이터에 별도로 남아 있는 경우 차단.
    // 예: "09이월공제금액"(정식 키)을 옮겼지만 "이월공제금액"(별도 키)이 row 에 같이 있어
    // 한쪽만 옮겨도 다른 한쪽이 일반 칸에 노출되던 사용자 보고.
    const normLab = (s: string) => s.replace(/\s+/g, "");
    const tieredLabels = new Set<string>();
    // 정적 COLUMNS 도 포함 — CONTRACT_FIELDS 에 없는 컬럼(예: 09이월공제금액) 의 라벨도 찾을 수 있게
    const allKnownDefs: Array<{ key: string; label: string }> = [
      ...CONTRACT_FIELDS.map((f) => ({ key: f.key, label: f.label })),
      ...COLUMNS.map((c) => ({ key: c.key, label: c.label })),
      ...customColumns.map((c) => ({ key: c.key, label: c.label || c.key })),
    ];
    // 차수 카드 컨테이너에 실제로 들어간 키들만 모음 — 매핑만 됐고 컨테이너에는 없는 경우는 차단하지 않음
    // (사용자 보고: 매핑은 됐는데 컨테이너에 안 들어간 옛 시도 실패 케이스에서 컬럼이 어디에도 안 보임)
    const inTieredContainerKeys = new Set<string>();
    for (const containerKey of ["계약정보_차수", "환불정보_차수"]) {
      const raw = (row as Record<string, unknown> | null)?.[containerKey];
      if (typeof raw === "string" && raw.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const tier of parsed) {
              if (tier && typeof tier === "object") {
                for (const k of Object.keys(tier as Record<string, unknown>)) {
                  if (k && !k.startsWith("_") && k !== "id" && k !== "label") inTieredContainerKeys.add(k);
                }
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
    // 라벨 차단은 컨테이너에 진짜 있는 키들만 기준 — 차수 카드에 실제로 들어간 경우만 일반 칸에서 거름
    for (const movedKey of inTieredContainerKeys) {
      const def = allKnownDefs.find((d) => d.key === movedKey);
      if (def?.label) tieredLabels.add(normLab(def.label));
      const stripped = movedKey.replace(/^\d+/, "");
      if (stripped && stripped !== movedKey) tieredLabels.add(normLab(stripped));
    }
    const seen = new Set<string>();
    const out: DetailField[] = [];
    // 라벨 → 이미 들어간 field 매핑. 같은 라벨의 두 키가 들어오면 정식 키(앞에 숫자 붙은 것) 우선,
    // 잔존 키(라벨 그대로의 키)는 양보. 사용자 보고 2026-05-25 (이미지 두 번째):
    //   row 안에 "03대표자명"(정식) + "대표자명"(옛 마이그 잔존) 두 키가 함께 있어 어느 섹션이든
    //   둘 다 그려지는 경우. 표시 단계 가장 위에서 라벨 중복 제거 → 모든 섹션이 한 번만 그림.
    const pushedByLabel = new Map<string, DetailField>();
    const push = (f: DetailField) => {
      if (seen.has(f.key)) return;
      if (disabledColumns.includes(f.key)) return;
      if (f.key.startsWith("_")) return;
      if (movedToTiered.has(f.key)) return; // 차수 카드로 이동한 키는 visibleFields 에서 제외
      // 같은 라벨의 다른 키가 차수 카드에 있으면 이것도 제외 (별도 키 잔존 fix)
      if (f.label && tieredLabels.has(normLab(f.label))) return;
      // 라벨 중복 제거 — 같은 라벨의 다른 필드가 이미 있으면 정식 키 우선.
      const lblNorm = normLab(f.label || f.key);
      const existing = pushedByLabel.get(lblNorm);
      if (existing) {
        const fIsFormal = /^\d/.test(f.key); // 숫자 prefix = 정식 키 (예: "03대표자명")
        const existingIsFormal = /^\d/.test(existing.key);
        if (existingIsFormal && !fIsFormal) {
          return; // 기존이 정식, 새 것은 잔존 → 새 것 무시
        }
        if (!existingIsFormal && fIsFormal) {
          // 기존이 잔존, 새 것이 정식 → 기존 제거하고 새 것 추가
          const idx = out.indexOf(existing);
          if (idx >= 0) out.splice(idx, 1);
          seen.delete(existing.key);
        } else {
          return; // 둘 다 같은 형식 → 첫 등장 우선
        }
      }
      seen.add(f.key);
      pushedByLabel.set(lblNorm, f);
      out.push(f);
    };
    // _files 안에 등록된 파일 카테고리들을 미리 수집 — row 키 fallback 단계에서
    // 카테고리와 같은 키/라벨을 만나면 file 형식으로 등록 (검토보고서 등 별도 카테고리 파일이
    // customColumns 미등록이어도 상세 모달에서 file UI 로 노출되도록).
    const fileCategoriesFromFiles = new Set<string>();
    const rowFilesArr = (row as Record<string, unknown> | null)?._files;
    if (Array.isArray(rowFilesArr)) {
      for (const f of rowFilesArr) {
        if (f && typeof f === "object") {
          const cat = String((f as { category?: unknown }).category ?? "").trim();
          if (cat && cat !== "기타자료") fileCategoriesFromFiles.add(cat);
        }
      }
    }
    for (const f of CONTRACT_FIELDS) push(f);
    for (const c of customColumns) {
      if (c.type === "auto_increment_id") continue;
      push(columnToDetailField(c));
    }
    // 카테고리에 해당하는 가상 file 컬럼 추가 — customColumns/CONTRACT_FIELDS 에 없을 때만
    // (있으면 그 type 을 우선 — 어드민이 type 을 다르게 정한 경우 존중)
    for (const cat of fileCategoriesFromFiles) {
      if (!seen.has(cat)) {
        push({ key: cat, label: cat, type: "file" });
      }
    }
    if (row) {
      for (const k of Object.keys(row)) {
        if (seen.has(k) || k.startsWith("_")) continue;
        let label = k;
        let type: DetailField["type"] = "text";
        if (k.startsWith("team_member_") || k === "team_member") label = "팀원";
        else if (k.startsWith("team_leader_") || k === "team_leader") label = "팀장";
        // row[k] 값이 파일 JSON 배열({name|fileName, url}) 형태면 file 로 자동 추정
        const rv = row[k];
        if (typeof rv === "string" && rv.trim().startsWith("[")) {
          try {
            const parsed = JSON.parse(rv);
            if (Array.isArray(parsed) && parsed.some((x) => x && typeof x === "object" && ("url" in x || "name" in x || "fileName" in x))) {
              type = "file";
            }
          } catch { /* not file json */ }
        }
        push({ key: k, label, type });
      }
    }
    return out;
  }, [disabledColumns, customColumns, row, sectionMapping]);

  // 권한(isAdmin)·확인창(dialog)·담당자명단(userDirectory)은 입력값으로 받는다
  // (예전엔 useAccess/useWedlyDialog/useUserDirectory 직접 호출 — 1단계-C 공용화).
  // 확인창 어댑터: 주입된 ShellDialog(묶음형)를 본문이 쓰던 하이브 위치형
  //   confirm(message,{title,danger,confirmLabel,cancelLabel}) / alert(message,{title}) 로 감싼다
  //   → 본문의 dialog.* 호출부를 한 줄도 안 바꿔도 예전과 100% 동일하게 동작(§10-6 의 반대 방향).
  //   브라우저 기본창 금지 규칙 준수 — 미주입 시엔 안전하게 취소(false)/무동작(절대 window.* 안 씀).
  const dialog = useMemo(() => ({
    confirm: (
      message: string,
      opts?: { title?: string; danger?: boolean; confirmLabel?: string; cancelLabel?: string },
    ): Promise<boolean> =>
      injectedDialog
        ? injectedDialog.confirm({
            title: opts?.title ?? "",
            message,
            confirmLabel: opts?.confirmLabel,
            cancelLabel: opts?.cancelLabel,
            danger: opts?.danger,
          })
        : Promise.resolve(false),
    alert: (message: string, opts?: { title?: string }): void | Promise<void> =>
      injectedDialog?.alert ? injectedDialog.alert({ title: opts?.title ?? "", message }) : undefined,
  }), [injectedDialog]);

  // EditableFieldRow·SelectEditor 는 "묶음형" ShellDialog 를 직접 받는다(파일 제거 확인 필수 — 브라우저 기본창 금지).
  // 미주입 시 안전 기본 — 확인은 취소(false), 알림은 무동작(절대 window.* 안 씀).
  const shellDialog: ShellDialog = injectedDialog ?? { confirm: () => Promise.resolve(false), alert: () => {} };

  // 공용 FilesTab 에 주입 — 노션 임시 보관함 링크가 만료됐으면 행을 다시 받아 새 링크로 자동 재시도.
  // 회복용 서버주소는 dataSource 로 주입(미지정 시 open-file-with-refresh 의 하이브/ERP 기본 경로).
  const handleOpenFile = (args: { href: string; entryId: string; fileName: string; category?: string }) => {
    openFileWithRefresh({
      url: args.href,
      entryId: args.entryId,
      fileName: args.fileName,
      category: args.category,
      onWarn: (m) => dialog.alert(m, { title: "파일 링크 만료" }),
      refetchEntryUrl: dataSource.refetchEntryUrl,
      notionRefreshUrl: dataSource.notionRefreshUrl,
    });
  };
  // 편집기(EditableFieldRow)용 파일 열기 — OpenFileFn 모양({url,...}). 위와 같은 회복 로직.
  const openFileForRow: OpenFileFn = (opts) => {
    openFileWithRefresh({
      url: opts.url,
      entryId: opts.entryId,
      fileName: opts.fileName,
      category: opts.category,
      onWarn: opts.onWarn,
      refetchEntryUrl: dataSource.refetchEntryUrl,
      notionRefreshUrl: dataSource.notionRefreshUrl,
    });
  };

  // ─── 담당 컨설턴트 드롭다운용 사용자 명단 ───
  // 앱이 넘겨준 명단을 사용(미지정 시 빈 명단). 사람 컬럼 편집 시엔 pickUserCandidates 로 분류.
  const userDirectory = userDirectoryProp ?? { all: [], leaders: [], members: [] };
  // 옛 호환 — 기존 자식 컴포넌트에 단일 명단으로 전달하던 곳은 전체(all) 사용.
  // 사람 컬럼 편집 시엔 pickUserCandidates 로 분류된 명단을 사용 (모듈 함수).
  const userNames = userDirectory.all;
  const pickUserOpts = (label: string | undefined): string[] => pickUserCandidates(label, userDirectory);

  // sectionMapping 동기화 — 앱별 서버 연결(dataSource.readSectionMapping)로 읽는다(예전 GET /api/detail-section-mapping).
  useEffect(() => {
    let canceled = false;
    setSectionMapping({}); // scope 변경 시 즉시 빈 상태로 — 이전 scope 매핑이 잔존하지 않게
    if (!dataSource.readSectionMapping) return;
    Promise.resolve(dataSource.readSectionMapping(scope))
      .then((data) => {
        if (canceled) return;
        if (data && typeof data === "object") {
          setSectionMapping(data as Record<string, string>);
        }
      })
      .catch(() => { /* fail-safe: empty mapping */ });
    return () => { canceled = true; };
    // deps 는 예전과 동일하게 scope 만 — 매핑은 scope 가 바뀔 때만 다시 읽는다(매 렌더 재조회 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // 섹션 컬럼 추가 모달 (어드민 전용)
  const [addColumnModal, setAddColumnModal] = useState<{ sectionId: string; sectionLabel: string } | null>(null);
  // 데이터 형식 변경 모달 — 어드민 전용. 사용자 정의 컬럼의 type 을 사후에 바꾼다.
  const [changeTypeModal, setChangeTypeModal] = useState<{ key: string; label: string; currentType: string } | null>(null);
  const [draftChangeType, setDraftChangeType] = useState<ShellFieldDef["type"]>("text");
  // 수식 형식 선택 시 입력하는 세부 정보 — 참조 컬럼 + 연산자 + 숫자
  const [draftFormulaRefKey, setDraftFormulaRefKey] = useState<string>("");
  const [draftFormulaOp, setDraftFormulaOp] = useState<"*" | "+" | "-" | "/">("*");
  const [draftFormulaOperand, setDraftFormulaOperand] = useState<string>("0.3");
  // 컬럼 삭제 모드 (어드민 전용) — 활성 탭 기준, 탭 바뀌면 자동 해제
  const [columnDeleteMode, setColumnDeleteMode] = useState(false);
  // 컬럼 수정 모드 — 평상시엔 드래그앤드롭·라벨 더블클릭 모두 잠금. 어드민이 토글하면 활성.
  // 사용자 보고(2026-05-24): 실수로 컬럼 위치/이름이 바뀌는 사고 방지 위해 게이팅.
  const [columnEditMode, setColumnEditMode] = useState(false);
  // 숨김 컬럼 복원 모달 — 어드민이 한 번에 숨긴 컬럼 목록 보고 개별 살리기
  const [showHiddenColumnsModal, setShowHiddenColumnsModal] = useState(false);
  // 섹션 추가/삭제 모달 — 어드민이 SectionAdminMenu 에서 "새 섹션 추가" / "이 섹션 삭제" 클릭 시
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [showDeleteSectionConfirm, setShowDeleteSectionConfirm] = useState(false);
  // 히스토리 카테고리 추가 모달 — 어드민이 카테고리 탭 옆 "+ 카테고리" 클릭 시
  const [showAddHistoryCategoryModal, setShowAddHistoryCategoryModal] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState<ShellHistoryColor>("blue");
  const [draftAddLabel, setDraftAddLabel] = useState("");
  const [draftAddType, setDraftAddType] = useState<ShellFieldDef["type"]>("text");
  // 새 컬럼 추가 모달의 "어느 섹션에 추가할지" 선택값. 모달 열릴 때 클릭한 섹션 id 로 초기화.
  const [draftAddSectionId, setDraftAddSectionId] = useState<string>("");
  // changeTypeModal 열릴 때 draft 초기화 (현재 type + 기존 수식 정보 가져오기)
  useEffect(() => {
    if (changeTypeModal) {
      setDraftChangeType(changeTypeModal.currentType as ShellFieldDef["type"]);
      const existing = customColumns.find((c) => c.key === changeTypeModal.key);
      if (existing?.formula) {
        setDraftFormulaRefKey(existing.formula.refKey);
        setDraftFormulaOp(existing.formula.op);
        setDraftFormulaOperand(String(existing.formula.operand));
      } else {
        setDraftFormulaRefKey("");
        setDraftFormulaOp("*");
        setDraftFormulaOperand("0.3");
      }
    }
  }, [changeTypeModal, customColumns]);
  const openAddColumnModal = useCallback((sectionId: string, sectionLabel: string) => {
    setDraftAddLabel("");
    setDraftAddType("text");
    setDraftAddSectionId(sectionId); // 초기값 = 클릭한 섹션. 어드민이 모달 안에서 다른 섹션으로 바꿀 수 있음.
    setAddColumnModal({ sectionId, sectionLabel });
  }, []);

  const moveColumnToSection = useCallback(async (
    columnKey: string,
    targetSectionId: string,
    opts?: {
      skipConfirm?: boolean;
      // 새 컬럼 추가 흐름에서 호출될 때 컬럼 이름을 함께 전달 — 아직 화면 목록(visibleFields)에 없으므로
      // 그냥 두면 알림에 내부 키(custom_1779...)가 그대로 나오는 사고를 막기 위함.
      fieldLabel?: string;
      // 새 컬럼이면 옛 값 일괄 이동·완료 알림 생략 (옮길 값이 0건이라 메시지 자체가 의미 없음).
      isNewColumn?: boolean;
    },
  ) => {
    // 차수 카드(계약/환불) 식별 — id / label / kind 셋 다 확인해 어떤 형태로 와도 잡히게.
    // ERP 측에서 보내는 섹션 정의가 id="contract" 가 아닌 다른 값일 수 있어 label 도 함께 본다.
    const targetFromSections = (sectionsProp || []).find((s) => s.id === targetSectionId);
    const targetSec = targetFromSections;
    const normLabel = (l: string | undefined) => (l || "").replace(/\s+/g, "");
    const labelNorm = normLabel(targetSec?.label);

    const isTieredContract =
      targetSectionId === "contract" ||
      labelNorm === "계약정보" ||
      targetSec?.kind === "tiered-contract";
    const isTieredRefund =
      targetSectionId === "refund" ||
      labelNorm === "환불정보" ||
      targetSec?.kind === "tiered-refund";
    const isTiered = isTieredContract || isTieredRefund;

    // 디버그 — 사용자가 어떤 입력으로 어떻게 판정됐는지 한눈에 알 수 있게 콘솔에 남김
    if (typeof console !== "undefined") {
      console.log("[moveColumnToSection]", {
        columnKey,
        targetSectionId,
        targetSec,
        labelNorm,
        isTiered,
        isTieredContract,
        isTieredRefund,
      });
    }

    // 차수 카드 처리: 사용자 확인 → 컬럼 정의 추가 → 1차 카드에 기존 값 매핑
    if (isTiered) {
      // 자동 마이그 깃발 — 이 함수가 컨테이너 setLocalRow/PATCH 를 하는 동안 다른 useEffect 가 같은 컨테이너를 만지면 충돌.
      // 깃발은 await dialog.confirm 이전엔 안 켜고, 사용자 확인 후에만 켜서 사용자 취소 케이스엔 영향 없음.
      // 새 컬럼이면 화면 목록에 아직 없을 수 있으므로 opts.fieldLabel 을 1순위로 사용.
      const fieldLabel = opts?.fieldLabel || visibleFields.find((f) => f.key === columnKey)?.label || columnKey;
      const cardName = isTieredContract ? "계약정보" : "환불정보";
      const prefix = isTieredContract ? "contract" : "refund";
      const containerKey = isTieredContract ? "계약정보_차수" : "환불정보_차수";
      // 같은 라벨의 다른 키에 값이 있을 수도 있음 (별도 키 케이스).
      // 예: "09이월공제금액" 키엔 값 없는데 "이월공제금액" 키에 값이 있는 경우 → 그 값도 1차 카드에 반영
      let existingValue: string | number | boolean | null | undefined = localRowRef.current?.[columnKey];
      let hasValue = existingValue != null && existingValue !== "";
      if (!hasValue && localRowRef.current) {
        const normLabHere = (s: string) => s.replace(/\s+/g, "");
        const defs = [
          ...CONTRACT_FIELDS.map((f) => ({ key: f.key, label: f.label })),
          ...COLUMNS.map((c) => ({ key: c.key, label: c.label })),
          ...customColumns.map((c) => ({ key: c.key, label: c.label || c.key })),
        ];
        const targetLabel = defs.find((d) => d.key === columnKey)?.label;
        const fallbackLabel = columnKey.replace(/^\d+/, "");
        const normTarget = normLabHere(targetLabel || fallbackLabel || columnKey);
        for (const k of Object.keys(localRowRef.current)) {
          if (k === columnKey || k.startsWith("_")) continue;
          const otherLabel = defs.find((d) => d.key === k)?.label || k;
          if (normLabHere(otherLabel) === normTarget) {
            const v = (localRowRef.current as Record<string, unknown>)[k];
            if (v != null && v !== "") {
              existingValue = v as string | number | boolean | null;
              hasValue = true;
              break;
            }
          }
        }
      }
      // skipConfirm 옵션이 있으면 확인 모달 생략 — 사용자가 이미 다른 모달에서 섹션을 명시 선택한 경우.
      if (!opts?.skipConfirm) {
        const confirmMsg = hasValue
          ? `'${fieldLabel}' 컬럼을 ${cardName} 차수 카드로 옮깁니다. 모든 차수 카드에 이 칸이 추가되고, 1차 카드에는 기존 값이 자동으로 채워집니다. 진행하시겠습니까?`
          : `'${fieldLabel}' 컬럼을 ${cardName} 차수 카드로 옮깁니다. 모든 차수 카드에 이 칸이 추가됩니다. 진행하시겠습니까?`;
        const ok = await dialog.confirm(confirmMsg, { title: "차수 카드로 이동" });
        if (!ok) return;
      }

      try {
        // 1) 차수 카드 컬럼 정의 조회 + 새 컬럼 추가 (key 중복 시 건너뜀) — 앱별 서버 연결로 읽기/쓰기.
        const tieredRaw = await dataSource.readTieredFields?.(prefix);
        const tieredFields = Array.isArray(tieredRaw) ? [...(tieredRaw as Array<{ key: string; label: string; type: string }>)] : [];
        if (!tieredFields.some((f) => f.key === columnKey)) {
          // 옛 컬럼 type → 차수 카드 type 매핑 (text/date/number/percent 만 허용)
          const origType = visibleFields.find((f) => f.key === columnKey)?.type;
          const newType: "text" | "date" | "number" | "percent" =
            origType === "date" ? "date"
              : origType === "number" ? "number"
              : "text";
          tieredFields.push({ key: columnKey, label: fieldLabel, type: newType });
          // 저장 실패 시 writeTieredFields 가 예외를 던지면 아래 catch 가 안내창을 띄운다(예전 컬럼 정의 저장 실패 처리).
          await dataSource.writeTieredFields?.(prefix, tieredFields);
        }

        // 2) 1차 카드 데이터에 기존 값 매핑 — 컨테이너 JSON 의 첫 차수 객체에 새 키 적용
        if (hasValue && localRowRef.current?._id) {
          const pageId = String(localRowRef.current._id);
          const raw = localRowRef.current[containerKey];
          let tiers: Record<string, unknown>[] = [];
          if (typeof raw === "string" && raw.trim().startsWith("[")) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) tiers = parsed.map((t) => (t && typeof t === "object") ? { ...t } : {});
            } catch { /* 빈 배열로 시작 */ }
          }
          if (tiers.length === 0) tiers.push({});
          tiers[0] = { ...tiers[0], [columnKey]: existingValue };
          const newContainer = JSON.stringify(tiers);
          setLocalRow((prev) => prev ? { ...prev, [containerKey]: newContainer, [columnKey]: null } : prev);
          // 컨테이너 + 원본 키 비우기 둘 다 저장 — 앱별 한 칸 저장 통로(patchField).
          await Promise.resolve(dataSource.patchField(pageId, containerKey, newContainer)).catch(() => { /* ignore */ });
          await Promise.resolve(dataSource.patchField(pageId, columnKey, null)).catch(() => { /* ignore */ });
        }
        // sectionMapping 갱신 — 메뉴 동작 일관성 위해 함께 저장 (옛 동작과 호환)
        // 응답 확인: 실패하면 모달 재오픈 시 sectionMapping fetch 가 옛 값 반환 → 차수 카드 컬럼이 일반 칸으로 다시 노출
        setSectionMapping((prev) => ({ ...prev, [columnKey]: targetSectionId }));
        try {
          await dataSource.writeSectionMapping?.(scope, columnKey, targetSectionId);
        } catch (err) {
          console.warn("[sectionMapping 저장 실패] 모달 재오픈 시 옛 컬럼이 다시 보일 수 있음", err);
        }

        // 모든 행의 옛 자리 값을 한 번에 1차 카드로 이동 — 매번 카드 열 때 정리하던 방식 대신.
        // 이 자리에 알리아스 키도 함께 보내 같은 라벨의 별도 키도 같이 옮겨짐.
        // (예: 옛 키 "이월공제금액" 과 새 키 "09이월공제금액" 이 데이터에 공존하는 케이스)
        const normLabHere = (s: string) => s.replace(/\s+/g, "");
        const targetLab = normLabHere(fieldLabel);
        const aliasKeys: string[] = [];
        const allDefsLocal: Array<{ key: string; label: string }> = [
          ...CONTRACT_FIELDS.map((f) => ({ key: f.key, label: f.label })),
          ...COLUMNS.map((c) => ({ key: c.key, label: c.label })),
          ...customColumns.map((c) => ({ key: c.key, label: c.label || c.key })),
        ];
        for (const d of allDefsLocal) {
          if (d.key === columnKey) continue;
          if (normLabHere(d.label) === targetLab) aliasKeys.push(d.key);
        }
        // 숫자 접두 다른 키도 후보 — "09이월공제금액" 옮기는데 "이월공제금액" 도 같이
        const stripped = columnKey.replace(/^\d+/, "");
        if (stripped && stripped !== columnKey && !aliasKeys.includes(stripped)) aliasKeys.push(stripped);
        const numbered = `0${columnKey}`;
        if (!aliasKeys.includes(numbered) && /^[가-힣]/.test(columnKey)) {
          // 숫자 prefix 가 0~9 인 다양한 가능성도 보냄
          for (let n = 0; n <= 9; n++) {
            const cand = `0${n}${columnKey}`;
            if (cand !== columnKey && !aliasKeys.includes(cand)) aliasKeys.push(cand);
          }
        }

        // 일괄 이동 — 모든 행의 옛 자리 값을 한 번에 1차 카드로 옮긴다.
        // 새 컬럼이면 옮길 값이 있을 리 없어서 호출 자체 생략 → 서버 부하 절약 + 의미 없는 0건 알림 차단.
        let bulkResultText = "";
        if (!opts?.isNewColumn) {
          try {
            const d = dataSource.bulkMigrateTier
              ? await Promise.resolve(dataSource.bulkMigrateTier({ columnKey, containerKey, aliasKeys }))
              : null;
            if (typeof console !== "undefined") {
              console.log("[bulk-migrate-tier 결과]", d);
            }
            if (d) {
              bulkResultText = ` (전체 ${d.total}건 중 ${d.migrated}건 값이 옮겨졌고, ${d.skipped}건은 옮길 값이 없거나 이미 채워져 있었습니다.)`;
              if ((d.failed ?? 0) > 0) bulkResultText += ` (실패 ${d.failed}건은 콘솔 로그 확인)`;
            }
          } catch (bulkErr) {
            console.warn("[bulk-migrate-tier 호출 실패]", bulkErr);
            bulkResultText = " (일괄 이동 통로 연결 실패 — 컬럼만 옮겨지고 값은 안 옮겨졌을 수 있음)";
          }
        }
        // 핵심: customColumns 정의 자체에서 그 컬럼 제거 — 부모 콜백 활용.
        // 이렇게 해야 어떤 경로로도 일반 칸으로 다시 안 그려짐 (visibleFields·effectiveSections·row 키 fallback 어디서도)
        // 사용자 보고: 모달 닫았다 열어도 옛 컬럼이 그대로 남음 → 근본 원인은 customColumns 정의가 남아 있어
        // visibleFields 의 customColumns 루프나 row 키 fallback 으로 다시 push 되는 것
        if (onDeleteColumn && isCustomColumn && isCustomColumn(columnKey)) {
          try { onDeleteColumn(columnKey); } catch { /* ignore */ }
        }
        // 즉시 화면 갱신 — 페이지 새로고침 없이 차수 카드만 다시 그림 (key 가 바뀌면 mount 다시 됨)
        setTieredReloadToken((t) => t + 1);
        // 부모 화면의 행 데이터도 새로 받아오게 트리거 — 옛 자리 비워졌음을 표 화면에 반영.
        // SubsidyClient 의 pull-refresh 청취자가 잡아서 entries 를 다시 불러옴.
        try {
          window.dispatchEvent(new CustomEvent("pull-refresh"));
        } catch { /* ignore */ }
        // 새 컬럼 추가 흐름이면 "추가됨" 메시지 — 옛 데이터 이동 안내가 의미 없으므로.
        if (opts?.isNewColumn) {
          void dialog.alert(`'${fieldLabel}' 컬럼이 ${cardName} 차수 카드에 추가되었습니다.`, { title: "추가 완료" });
        } else {
          void dialog.alert(`'${fieldLabel}' 컬럼이 ${cardName} 차수 카드로 이동했습니다.${bulkResultText}`, { title: "이동 완료" });
        }
      } catch (err) {
        console.error("[moveColumnToSection: tiered]", err);
        const msg = err instanceof Error ? err.message : String(err);
        void dialog.alert(`차수 카드로 이동에 실패했습니다. 원인: ${msg}`, { title: "이동 실패" });
      }
      return;
    }

    // 일반 섹션 이동 (또는 차수 카드 → 일반으로 되돌리기)
    // 차수 카드에서 빠지는 경우 — 컨테이너 데이터의 1차 객체에 그 키가 있다면 1차 값을 원본 키로 옮기고,
    // 차수 카드 컬럼 정의에서도 제거. 이렇게 해야 1차에 한 번 적용된 옛 값이 그대로 남는 사고 방지.
    const sourceSectionId = sectionMapping[columnKey];
    const sourceIsTieredContract = sourceSectionId === "contract";
    const sourceIsTieredRefund = sourceSectionId === "refund";
    if (sourceIsTieredContract || sourceIsTieredRefund) {
      try {
        const prefix = sourceIsTieredContract ? "contract" : "refund";
        const sourceContainerKey = sourceIsTieredContract ? "계약정보_차수" : "환불정보_차수";
        // 1) 컨테이너 1차 값 → 원본 키로 복원 (원본 row 키가 비어 있을 때만)
        if (localRowRef.current?._id) {
          const pageId = String(localRowRef.current._id);
          const raw = localRowRef.current[sourceContainerKey];
          if (typeof raw === "string" && raw.trim().startsWith("[")) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
                const firstTier = parsed[0] as Record<string, unknown>;
                const restoredValue = firstTier[columnKey];
                if (restoredValue != null && restoredValue !== "") {
                  // 원본 키에 값 복원
                  setLocalRow((prev) => prev ? { ...prev, [columnKey]: restoredValue as string | number | boolean | null } : prev);
                  await Promise.resolve(dataSource.patchField(pageId, columnKey, restoredValue as string | number | boolean | null)).catch(() => { /* ignore */ });
                }
                // 모든 차수에서 그 키 제거
                const cleanedTiers = parsed.map((t) => {
                  if (t && typeof t === "object") {
                    const copy = { ...(t as Record<string, unknown>) };
                    delete copy[columnKey];
                    return copy;
                  }
                  return t;
                });
                const newContainer = JSON.stringify(cleanedTiers);
                setLocalRow((prev) => prev ? { ...prev, [sourceContainerKey]: newContainer } : prev);
                await Promise.resolve(dataSource.patchField(pageId, sourceContainerKey, newContainer)).catch(() => { /* ignore */ });
              }
            } catch { /* 빈 컨테이너 — 무시 */ }
          }
        }
        // 2) 차수 카드 컬럼 정의에서도 제거
        const tieredRaw = await dataSource.readTieredFields?.(prefix);
        const tieredFields = Array.isArray(tieredRaw) ? (tieredRaw as Array<{ key: string; label: string; type: string }>) : [];
        const filtered = tieredFields.filter((f) => f.key !== columnKey);
        if (filtered.length !== tieredFields.length) {
          await Promise.resolve(dataSource.writeTieredFields?.(prefix, filtered)).catch(() => { /* ignore */ });
        }
      } catch (err) {
        console.warn("[moveColumnToSection: 차수 카드 정리 실패]", err);
      }
    }

    let prevMapping: Record<string, string> = {};
    setSectionMapping((prev) => {
      prevMapping = prev;
      return { ...prev, [columnKey]: targetSectionId };
    });
    try {
      await dataSource.writeSectionMapping?.(scope, columnKey, targetSectionId);
    } catch (err) {
      console.warn("[moveColumnToSection]", err);
      // 실패 시 이전 상태로 되돌림
      setSectionMapping(prevMapping);
      void dialog.alert("컬럼 위치 변경에 실패했습니다. 권한과 연결을 확인해주세요.", { title: "변경 실패" });
    }
  // dialog 안정된 클로저
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sectionsProp, visibleFields]);

  // ─── 컬럼 순서 hook 호출은 effectiveSections 정의 뒤로 옮김 (아래 참조)
  // 이전엔 visibleFields 가 모든 필드를 포함해 useFieldOrder("contract") 가 비-contract 키까지
  // server JsonCache 의 contract 배열에 PUT → 서버 데이터 노이즈. fieldKeys 기준 필터로 차단.

  const [saving, setSaving] = useState<string | null>(null);
  const [localRow, setLocalRow] = useState<RowData | null>(null);
  const [creating, setCreating] = useState(false);
  // 상위 패널 상태 — effectiveSections 빌드 안에서 activePanel 별 필터를 적용하므로 미리 선언.
  const [activePanel, setActivePanel] = useState<string>(initialPanel);
  // 새 패널 추가 모달 + 패널 관리 모달 + memo draft
  const [showAddPanelModal, setShowAddPanelModal] = useState(false);
  const [showPanelManagerModal, setShowPanelManagerModal] = useState(false);
  const [memoDraft, setMemoDraft] = useState<Record<string, string>>({});
  // 패널별 댓글 카운트 — 각 히스토리 패널이 글 fetch 시 onCountChange 로 알려줌. 탭 옆 작은 칩에 표시.
  // key: "default" (기본 히스토리 패널) 또는 사용자 정의 history 패널 id.
  const [panelCommentCounts, setPanelCommentCounts] = useState<Record<string, number>>({});
  // 메모 draft 를 즉시 저장 — 패널 전환·모달 닫기 시 사용자가 onBlur 안 거치고 잃지 않도록.
  // ref 로 최신 draft·row 를 추적, flushMemoDraft 가 그 값으로 미저장 키만 handleFieldSave.
  const memoDraftRef = useRef<Record<string, string>>({});
  useEffect(() => { memoDraftRef.current = memoDraft; }, [memoDraft]);

  // ERP에서 받은 section 정의 (없으면 Hive 기본값 사용) + 테이블에는 있지만 어떤 섹션에도
  // 들어가지 않은 컬럼들을 "기타" 섹션에 자동으로 모아 표시. 환불정보 옆에 위치.
  // sectionMapping: 어드민이 명시적으로 지정한 (컬럼→섹션) 매핑이 ERP 기본값을 덮어쓴다.
  const effectiveSections: ErpDetailSection[] = useMemo(() => {
    let base: ErpDetailSection[] = (sectionsProp && sectionsProp.length > 0)
      ? sectionsProp.map((s) => ({ ...s, fieldKeys: s.fieldKeys ? [...s.fieldKeys] : s.fieldKeys }))
      : [
          { id: "contract", label: "계약정보", kind: "fields", removable: false },
          { id: "settlement", label: "정산정보", kind: "settlement", removable: false },
          { id: "files", label: "파일", kind: "files", removable: false },
        ];
    // A-1 자동 활성: 계약·환불 섹션이 일반 fields 모드면 차수 카드 모드로 자동 변환
    // 옛 일반 컬럼들은 fieldKeys 에서 제외 — "기타" 섹션으로 자동 이동
    //
    // 매칭 기준: label 공백 무시 정규화 매칭 — 사용자가 "계약 정보"/"계약  정보" 처럼 띄어쓰기 다르게 입력해도 안전.
    // 사용자 요청: 계약정보·정산정보·환불정보 모두 차수 카드 구조여야 함 (settlement 는 별도 kind=settlement)
    const normLabel = (l: string | undefined) => (l || "").replace(/\s+/g, "");
    base = base.map((s) => {
      const ln = normLabel(s.label);
      if (ln === "계약정보" && (!s.kind || s.kind === "fields")) {
        return { ...s, kind: "tiered-contract", fieldKeys: [] };
      }
      if (ln === "환불정보" && (!s.kind || s.kind === "fields")) {
        return { ...s, kind: "tiered-refund", fieldKeys: [] };
      }
      return s;
    });
    // "기타" 섹션 — 어드민·일반 사용자 모두에게 노출.
    // 어드민 표시 설정에서 켜진 컬럼만 들어가므로 권한 분리는 컬럼 단위로 이미 처리됨.
    // 비어 있으면 화면 렌더 단계에서 자동 숨김(렌더 가드).
    // (이전에는 일반 사용자에게 기타 섹션 자체를 막아 검토보고서 등 별도 카테고리 파일 컬럼이 안 보이는 사고)
    let sections: ErpDetailSection[];
    {
      const otherSec: ErpDetailSection = {
        id: "other",
        label: "기타",
        kind: "fields",
        fieldKeys: [],
        removable: false,
      };
      sections = (() => {
        const refundIdx = base.findIndex((s) => s.id === "refund" || s.label === "환불정보");
        if (refundIdx >= 0) return [...base.slice(0, refundIdx + 1), otherSec, ...base.slice(refundIdx + 1)];
        const filesIdx = base.findIndex((s) => s.kind === "files");
        if (filesIdx >= 0) return [...base.slice(0, filesIdx), otherSec, ...base.slice(filesIdx)];
        return [...base, otherSec];
      })();
    }
    // 1) 어드민이 명시한 매핑을 적용 — 해당 키를 모든 섹션 fieldKeys 에서 제거 후 지정된 섹션에 추가
    // ⚠️ contract 처럼 "fieldKeys 미지정 = 모두 다룸" 인 섹션에 매핑이 들어오면, 그 섹션의 기본 키들이
    // 손실되지 않도록 매핑 적용 전 CONTRACT_FIELDS 로 초기화. 다른 섹션은 명시적 fieldKeys 기준.
    for (const [colKey, targetSectionId] of Object.entries(sectionMapping)) {
      sections = sections.map((s) => {
        let fk = s.fieldKeys;
        // contract 가 일반 fields 모드일 때만 백업 — tiered-contract 모드는 fieldKeys=[] 가 정상이므로 채우면 안 됨
        // (안 막으면 basic 섹션의 컬럼들이 contract 백업과 겹쳐서 화면이 빈 듯 보이는 회귀 발생)
        if (s.id === "contract" && s.kind !== "tiered-contract" && (!fk || fk.length === 0)) {
          fk = CONTRACT_FIELDS.map((f) => f.key);
        }
        const cleaned = (fk || []).filter((k) => k !== colKey);
        if (s.id === targetSectionId && !cleaned.includes(colKey)) {
          return { ...s, fieldKeys: [...cleaned, colKey] };
        }
        return { ...s, fieldKeys: cleaned };
      });
    }
    // 2) 어떤 섹션에도 안 속한 COLUMNS 키는 자동으로 기타 섹션에 추가
    // 핵심: 차수 카드 섹션(tiered-contract / tiered-refund) 과 특수 섹션(settlement / meetings / files)은
    // fieldKeys 가 본문에 일반 칸으로 그려지지 않음 → covered 로 치면 그 컬럼이 어디에도 안 보이는 사고.
    // 그 종류의 섹션에 매핑된 컬럼은 covered 에 추가하지 않아 자동으로 "기타" 섹션에 떨어지도록 처리.
    const NON_RENDERING_SECTION_KINDS = new Set(["tiered-contract", "tiered-refund", "settlement", "meetings", "files"]);
    const covered = new Set<string>();
    for (const s of sections) {
      // 차수 카드/특수 섹션의 fieldKeys 는 화면에 안 그려지므로 covered 에 안 넣음
      if (s.fieldKeys && !NON_RENDERING_SECTION_KINDS.has(s.kind || "")) {
        s.fieldKeys.forEach((k) => covered.add(k));
      }
      // kind 별 특수 키 — 해당 섹션 컴포넌트가 직접 사용하므로 기타에 중복 노출 방지
      if (s.kind === "settlement") covered.add("정산정보");
      if (s.kind === "meetings") covered.add("_meetings");
      if (s.kind === "files") covered.add("_files");
    }
    const contractSec = sections.find((s) => s.id === "contract");
    // tiered-contract 모드일 때는 fieldKeys=[] 가 정상이라 백업으로 CONTRACT_FIELDS 를 모두 covered 에 넣지 않음.
    // (안 막으면 basic 섹션의 일부 컬럼이 covered 에 들어가서 기타로 빠지는 등 부작용 발생)
    if (contractSec && contractSec.kind !== "tiered-contract" && (!contractSec.fieldKeys || contractSec.fieldKeys.length === 0)) {
      CONTRACT_FIELDS.forEach((f) => {
        if (!sectionMapping[f.key]) covered.add(f.key);
      });
    }
    // ─── 일반 섹션 "전체 보여주기" 모드의 covered 보강 (사용자 보고 2026-05-25) ───
    // 일반 fields 섹션이 fieldKeys 미지정/빈 배열이면 resolveSectionFields 가 모든 visibleFields 를
    // 그리는 옛 호환 동작. 그러나 covered 에 키가 안 들어가면 같은 컬럼들이 기타 자동 수집에도
    // 떨어져 두 곳 중복 노출. → 이런 섹션이 그릴 키들을 covered 에 미리 추가해 중복 차단.
    // 기타(other) 자체와 차수 카드/특수 섹션은 제외 — 그쪽은 별도 처리.
    for (const s of sections) {
      if (s.id === "other") continue;
      if (NON_RENDERING_SECTION_KINDS.has(s.kind || "")) continue;
      if (s.id === "contract") continue; // contract 는 위에서 별도 처리됨
      if (s.kind && s.kind !== "fields") continue; // fields 모드만 (안전)
      if (!s.fieldKeys || s.fieldKeys.length === 0) {
        // 이 섹션은 모든 visibleFields 를 그림 → 그 키들도 covered 로 간주.
        visibleFields.forEach((f) => covered.add(f.key));
      }
    }
    // 시스템 키 블랙리스트 — 기타에 노출되면 안 되는 키들 (JSON 통째로 보이는 등 시각적 노이즈 방지)
    const SYSTEM_KEYS = ["정산정보", "_meetings", "_files", "_id", "_createdTime", "_isNew", "_hiveTransferredAt", "매출VAT포함", "매출VAT제외"];
    SYSTEM_KEYS.forEach((k) => covered.add(k));
    // COLUMNS + customColumns + row 안의 모든 키 (안전망) 중 어디에도 안 들어간 키들 모두 기타에
    // 숨김 컬럼은 제외. 어드민이 인지 못 한 컬럼도 기타에 자동 노출.
    const allTableCols: Array<{ key: string; type?: string }> = [...COLUMNS, ...customColumns];
    if (row) {
      for (const k of Object.keys(row)) {
        if (k.startsWith("_") || k.startsWith("__")) continue;
        if (allTableCols.some((c) => c.key === k)) continue;
        allTableCols.push({ key: k, type: "text" });
      }
    }
    // _files 안 category 도 자동으로 가상 컬럼 등록 — 검토보고서 같은 파일 카테고리가 customColumns
    // 미등록·row 키 미존재여도 기타에 file 컬럼으로 노출되도록 (사용자 보고: 검토보고서 안 보임 fix)
    const rowFilesArr = (row as Record<string, unknown> | null)?._files;
    if (Array.isArray(rowFilesArr)) {
      for (const f of rowFilesArr) {
        if (f && typeof f === "object") {
          const cat = String((f as { category?: unknown }).category ?? "").trim();
          if (cat && cat !== "기타자료" && !allTableCols.some((c) => c.key === cat)) {
            allTableCols.push({ key: cat, type: "file" });
          }
        }
      }
    }
    // 차수 카드로 옮긴 키 — 차수 카드 섹션 id 가 환경마다 다름(contract/refund/payment 등)을 고려해
    // 라벨/kind 로 동적 판정
    const tieredSecIds = new Set<string>(["contract", "refund"]);
    for (const s of (sectionsProp || [])) {
      const lbl = (s.label || "").replace(/\s+/g, "");
      if (s.kind === "tiered-contract" || s.kind === "tiered-refund" || lbl === "계약정보" || lbl === "환불정보") {
        if (s.id) tieredSecIds.add(s.id);
      }
    }
    const movedToTieredKeys = new Set<string>();
    for (const [k, target] of Object.entries(sectionMapping)) {
      if (tieredSecIds.has(target)) movedToTieredKeys.add(k);
    }
    for (const ck of ["계약정보_차수", "환불정보_차수"]) {
      const raw = (row as Record<string, unknown> | null)?.[ck];
      if (typeof raw === "string" && raw.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const tier of parsed) {
              if (tier && typeof tier === "object") {
                for (const k of Object.keys(tier as Record<string, unknown>)) {
                  if (k && !k.startsWith("_")) movedToTieredKeys.add(k);
                }
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
    // 라벨 단위 차단 — 같은 라벨의 다른 키가 row 에 별도로 남아 있는 경우 (사용자 보고)
    const normLabel2 = (s: string) => s.replace(/\s+/g, "");
    const tieredLabels2 = new Set<string>();
    const allDefs2: Array<{ key: string; label: string }> = [
      ...CONTRACT_FIELDS.map((f) => ({ key: f.key, label: f.label })),
      ...COLUMNS.map((c) => ({ key: c.key, label: c.label })),
      ...customColumns.map((c) => ({ key: c.key, label: c.label || c.key })),
    ];
    // covered 키들의 라벨 집합 — 같은 라벨의 다른 키(예: row 에 잔존하는 "대표자명" 같은 별도 키)도
    // 기타에서 제외하기 위해 사용. 사용자 보고 2026-05-25 (이미지): 기본정보 섹션이 "03대표자명" 같은
    // 정식 키를 그리는데, row 안에는 옛 마이그 잔존으로 "대표자명" 별도 키가 함께 있어
    // 기타 자동 수집이 그 잔존 키를 또 가져가 두 곳 노출되던 사고.
    const coveredLabels = new Set<string>();
    for (const k of covered) {
      const def = allDefs2.find((d) => d.key === k);
      if (def?.label) coveredLabels.add(normLabel2(def.label));
      const stripped = k.replace(/^\d+/, "");
      if (stripped && stripped !== k) coveredLabels.add(normLabel2(stripped));
      coveredLabels.add(normLabel2(k));
    }
    // 컨테이너에 진짜 있는 키들만 기준으로 라벨 차단 (매핑만 된 옛 실패 케이스는 차단 안 함)
    const inContainer2 = new Set<string>();
    for (const ck of ["계약정보_차수", "환불정보_차수"]) {
      const raw = (row as Record<string, unknown> | null)?.[ck];
      if (typeof raw === "string" && raw.trim().startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const tier of parsed) {
              if (tier && typeof tier === "object") {
                for (const k of Object.keys(tier as Record<string, unknown>)) {
                  if (k && !k.startsWith("_") && k !== "id" && k !== "label") inContainer2.add(k);
                }
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
    for (const movedKey of inContainer2) {
      const def = allDefs2.find((d) => d.key === movedKey);
      if (def?.label) tieredLabels2.add(normLabel2(def.label));
      const stripped = movedKey.replace(/^\d+/, "");
      if (stripped && stripped !== movedKey) tieredLabels2.add(normLabel2(stripped));
    }
    // 같은 라벨의 row 키들도 모두 제외 대상에 추가
    for (const k of Object.keys((row as Record<string, unknown> | null) || {})) {
      if (k.startsWith("_")) continue;
      // 정의된 컬럼에서 같은 라벨 찾기 (row 키 자체가 라벨로 쓰이는 경우 포함)
      const def = allDefs2.find((d) => d.key === k);
      const lbl = def?.label || k;
      if (tieredLabels2.has(normLabel2(lbl))) movedToTieredKeys.add(k);
    }
    const seen = new Set<string>();
    const otherKeys = allTableCols
      .filter((c) => {
        if (c.key.startsWith("_") || c.type === "auto_increment_id") return false;
        if (covered.has(c.key)) return false;
        if (disabledColumns.includes(c.key)) return false;
        // 차수 카드로 옮긴 키는 기타에서 제외 — sectionMapping 기반 + 컨테이너 기반 둘 다 포함.
        // 사용자 보고(2026-05-24): 값이 빈 컬럼을 옮겼을 때 컨테이너 업데이트 단계가 건너뛰어
        //   컨테이너에 안 들어감 → inContainer2 에 없음 → 기타에 그대로 남는 사고. movedToTieredKeys 로 차단.
        // (tiered-fields 등록은 항상 성공하므로 차수 카드에는 반드시 노출됨 — 사라질 위험 없음)
        if (movedToTieredKeys.has(c.key)) return false;
        // 라벨 단위 차단 — 같은 라벨의 다른 키 (별도 키 잔존 케이스)
        const defForKey = allDefs2.find((d) => d.key === c.key);
        const lbl = defForKey?.label || c.key;
        if (tieredLabels2.has(normLabel2(lbl))) return false;
        // covered 라벨 매칭 — 다른 섹션이 같은 라벨의 정식 키를 그리고 있으면 잔존 키는 기타에서 제외.
        // 사용자 보고 2026-05-25 (이미지): 기본정보의 "03대표자명" 정식 키와 row 안 "대표자명" 잔존 키가
        // 함께 있어 기타에 중복 노출.
        if (coveredLabels.has(normLabel2(lbl))) return false;
        if (coveredLabels.has(normLabel2(c.key))) return false;
        if (seen.has(c.key)) return false;
        seen.add(c.key);
        return true;
      })
      .map((c) => c.key);
    sections = sections.map((s) =>
      s.id === "other" ? { ...s, fieldKeys: [...(s.fieldKeys || []), ...otherKeys] } : s
    );
    // ─── 기타 섹션 최종 정리 — 다른 일반 섹션과 라벨 겹치는 키 제거 ───
    // 사용자 보고 2026-05-25 (이미지 두 번째): 기본정보가 "03대표자명" 같은 정식 키를 그리고,
    // 기타가 옛 마이그 잔존 키 "대표자명" 을 명시적으로 또는 자동으로 가지고 있어 두 곳에 같은 라벨 표시.
    // 자동 수집 단계의 라벨 매칭으로는 "기타에 이미 명시 키로 들어간 잔존" 케이스를 못 잡음 → 최종 단계에서 정리.
    const otherSectionLabels = new Set<string>();
    for (const s of sections) {
      if (s.id === "other") continue;
      if (NON_RENDERING_SECTION_KINDS.has(s.kind || "")) continue;
      if (s.kind && s.kind !== "fields") continue;
      // ⚠️ 빈 fieldKeys 섹션은 "전체 보여주기" 모드인데, visibleFields 전체를 라벨 차단으로
      // 등록하면 기타에 남을 키가 없어 통째로 비는 회귀(code-reviewer 지적). 명시 fieldKeys 있는
      // 섹션만 라벨 차단에 등록. 빈 fieldKeys 섹션은 이미 위 covered 보강 단계에서 visibleFields
      // 키들을 covered 에 추가했으므로 자동 수집 필터에서 잡힘 — 명시 잔존 키만 여기서 정리.
      if (!s.fieldKeys || s.fieldKeys.length === 0) continue;
      const keysToRender = s.fieldKeys;
      for (const k of keysToRender) {
        const def = allDefs2.find((d) => d.key === k);
        if (def?.label) otherSectionLabels.add(normLabel2(def.label));
        const stripped = k.replace(/^\d+/, "");
        if (stripped && stripped !== k) otherSectionLabels.add(normLabel2(stripped));
        otherSectionLabels.add(normLabel2(k));
      }
    }
    sections = sections.map((s) => {
      if (s.id !== "other") return s;
      if (!s.fieldKeys || s.fieldKeys.length === 0) return s;
      const cleanedOther = s.fieldKeys.filter((k) => {
        const def = allDefs2.find((d) => d.key === k);
        const lbl = def?.label || k;
        // 라벨이 다른 일반 섹션과 겹치면 기타에서 제거
        if (otherSectionLabels.has(normLabel2(lbl))) return false;
        if (otherSectionLabels.has(normLabel2(k))) return false;
        return true;
      });
      return { ...s, fieldKeys: cleanedOther };
    });
    // "기타" 섹션 노출 여부 — 어드민이 섹션 편집 메뉴에서 토글로 결정. 기본 숨김.
    // 사용자 보고 2026-05-25: 평소 중복 노출 사고가 잦아 어드민이 명시적으로 켤 때만 표시.
    if (!showOtherSection) {
      sections = sections.filter((s) => s.id !== "other");
    } else if (!isAdmin) {
      // 어드민이 노출하기로 했어도 일반 사용자에겐 빈 기타 탭은 숨김 (텅 빈 탭 방지).
      sections = sections.filter((s) => s.id !== "other" || (s.fieldKeys && s.fieldKeys.length > 0));
    }
    // 상위 패널별 필터 (B 단계) — 활성 패널 소속 섹션만 보여줌.
    // panelId 없거나 "properties" → 기본 properties 패널 소속. 그 외 id → 그 사용자 정의 fields 패널 소속.
    const activePanelObj = customPanels.find((p) => p.id === activePanel);
    if (!activePanelObj) {
      // 기본 패널 (properties / history / files) 또는 패널 미일치 → properties 소속만
      sections = sections.filter((s) => !s.panelId || s.panelId === "properties");
    } else if (activePanelObj.kind === "fields") {
      // 사용자 정의 fields 패널 — 그 panelId 의 섹션만
      sections = sections.filter((s) => s.panelId === activePanel);
    } else {
      // 사용자 정의 memo/embed/history/files 패널 — 자체 섹션 없음
      sections = [];
    }
    return sections;
  }, [sectionsProp, sectionMapping, customColumns, disabledColumns, row, isAdmin, visibleFields, showOtherSection, activePanel, customPanels]);

  // 파일 패널 카테고리 후보 목록 — 실제 파일(file 형식) 컬럼 라벨 + 이미 첨부된 파일의 category.
  // 파일 패널 드롭다운에서 "검토보고서·경정청구 신고서" 같은 실제 카테고리로 분류·변경할 수 있게 한다.
  // (이전엔 고정 5종 계약서/재무제표 등만 보여 노션 컬럼 카테고리 파일이 모두 "기타"로 표시됐음)
  const fileCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of COLUMNS) {
      if (c.type === "file" && c.label) set.add(c.label);
    }
    for (const c of customColumns) {
      if (c.type === "file" && c.label) set.add(c.label);
    }
    const filesArr = (localRow?._files as unknown as FileMeta[] | undefined) || [];
    for (const f of filesArr) {
      const cat = (f?.category || "").trim();
      // 내부 식별자(panel_<id> — 사용자 정의 파일 패널 소속 키)는 드롭다운에 노출하지 않음
      if (cat && cat !== "기타자료" && !cat.startsWith("panel_")) set.add(cat);
    }
    return Array.from(set);
  }, [customColumns, localRow]);

  // Hive가 아는 모든 필드 key → DetailField 맵
  // CONTRACT_FIELDS + COLUMNS + customColumns + row 안의 모든 키 (안전망)
  const hiveFieldMap = useMemo(() => {
    const m = new Map<string, DetailField>();
    for (const f of CONTRACT_FIELDS) m.set(f.key, f);
    for (const c of COLUMNS) {
      if (!m.has(c.key) && !c.key.startsWith("_") && c.type !== "auto_increment_id") {
        m.set(c.key, columnToDetailField(c));
      }
    }
    // 어드민이 변경한 사용자 정의 컬럼 처리:
    // - 같은 키가 이미 있으면 라벨만 덮어쓰기. 정적 컬럼의 type/format(예: "title" 타입의 02상호명,
    //   "currency" format 의 환급액 등)이 무조건 덮어쓰여 편집 불가로 회귀하는 일 방지.
    // - 같은 키가 없으면 customColumns 의 type 그대로 새로 등록 (사용자가 추가한 새 컬럼)
    for (const c of customColumns) {
      if (c.key.startsWith("_") || c.type === "auto_increment_id") continue;
      const existing = m.get(c.key);
      if (existing) {
        m.set(c.key, { ...existing, label: c.label });
      } else {
        m.set(c.key, columnToDetailField(c));
      }
    }
    // 안전망: row 안에 값이 있는 키 중 위에 없는 것은 텍스트 필드로 fallback —
    // 어드민이 인지하지 못한 경로로 추가된 컬럼도 상세모달에서 보이도록.
    // 자동 생성된 키 패턴은 친근한 이름표로 추론 (사용자가 키를 그대로 보지 않게):
    //   team_member_* → "팀원", team_leader_* → "팀장"
    if (row) {
      for (const k of Object.keys(row)) {
        if (k.startsWith("_") || k.startsWith("__")) continue;
        if (m.has(k)) continue;
        let inferredLabel = k;
        if (k.startsWith("team_member_") || k === "team_member") inferredLabel = "팀원";
        else if (k.startsWith("team_leader_") || k === "team_leader") inferredLabel = "팀장";
        m.set(k, { key: k, label: inferredLabel, type: "text" });
      }
    }
    return m;
  }, [customColumns, row]);

  // 공유 헬퍼 — 한 섹션의 컬럼 목록을 일관되게 만든다. 화면 그리기·순서 저장·다른 섹션 그리기 세 곳에서 동일하게 사용.
  //
  // 사용자 보고(2026-05-24): 진행상태·팀장·팀원 등은 visibleFields 의 거름망에서 빠지는 경우 있음.
  // 그러나 화면 그리기는 hiveFieldMap 에서 보충하므로 그려지지만, 순서 저장 목록에는 없어 옮김이 차단됨.
  // 해결: 세 곳 모두 같은 보충 로직(visibleFields 우선 → hiveFieldMap 보충)을 쓰도록 통합.
  const resolveSectionFields = useCallback(
    (allowedKeys: string[] | null, customOrder?: string[]): DetailField[] => {
      // 명시된 키 목록 없으면 visibleFields 전체에서 꺼짐 컬럼만 제외 ("전체 보여주기" 옛 호환).
      // 호출자는 빈 배열을 null 로 변환해서 전달하도록 통일 (3 호출자 모두 동일 패턴).
      if (!allowedKeys || allowedKeys.length === 0) {
        return visibleFields.filter((f) => !disabledColumns.includes(f.key));
      }
      const visibleMap = new Map(visibleFields.map((f) => [f.key, f]));
      const allowedSet = new Set(allowedKeys);
      const seen = new Set<string>();
      const result: DetailField[] = [];
      // 1) customOrder 우선 (사용자 저장 순서) — allowedSet 안 키들만
      if (customOrder && customOrder.length > 0) {
        for (const k of customOrder) {
          if (seen.has(k)) continue;
          if (!allowedSet.has(k)) continue;
          if (disabledColumns.includes(k)) continue;
          const f = visibleMap.get(k) || hiveFieldMap.get(k);
          if (f) { result.push(f); seen.add(k); }
        }
      }
      // 2) allowedKeys 의 나머지 — 원래 순서대로
      for (const k of allowedKeys) {
        if (seen.has(k)) continue;
        if (disabledColumns.includes(k)) continue;
        const f = visibleMap.get(k) || hiveFieldMap.get(k);
        if (f) { result.push(f); seen.add(k); }
      }
      return result;
    },
    [visibleFields, hiveFieldMap, disabledColumns],
  );

  // contract 섹션 필드 목록 — useFieldOrder 의 visibleFields prop 으로 전달
  const contractFieldsForOrder = useMemo(() => {
    const contractSec = effectiveSections.find((s) => s.id === "contract");
    const allowedKeys = contractSec?.fieldKeys && contractSec.fieldKeys.length > 0
      ? contractSec.fieldKeys
      : null;
    return resolveSectionFields(allowedKeys);
  }, [effectiveSections, resolveSectionFields]);


  // ─── 컬럼 순서 — 드래그앤드롭 지원, server JsonCache 저장 (모든 사용자 공유) ───
  // ERP tax-amendment 와 동일 scope 를 공유 → ERP 사용자와 하이브 사용자가 같은 순서를 본다.
  const {
    orderedFields,
    draggingKey,
    dragOverKey,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    resetOrder: resetFieldOrder,
    hasCustomOrder: hasCustomFieldOrder,
    isOrderLoaded: isContractOrderLoaded,
  } = useFieldOrder<DetailField>(scope, "contract", contractFieldsForOrder, isAdmin && columnEditMode, shellDialog);

  // contract 직접 영역에서 그릴 컬럼 목록 — 사용자 저장 순서(orderedFields) 우선 반영
  // 입력 한 글자마다 재계산되지 않게 묶음. orderedFields/effectiveSections 변경 시만 갱신.
  // 계약 섹션은 fieldKeys 미지정/빈 배열 = "기본 컬럼 전체 보여주기" 의미 (옛 호환).
  // contractFieldsForOrder 와 같은 변환을 사용해 의미 일관성 유지.
  const contractDrawFields = useMemo(() => {
    const contractSec = effectiveSections.find((s) => s.id === "contract");
    const allowedKeys = contractSec?.fieldKeys && contractSec.fieldKeys.length > 0
      ? contractSec.fieldKeys
      : null;
    return resolveSectionFields(allowedKeys, orderedFields.map((f) => f.key));
  }, [effectiveSections, orderedFields, resolveSectionFields]);

  // "파일" 섹션은 별도 패널(상세 정보 / 히스토리와 같은 계층)로 분리되어 상단에 표시
  const filesSection = useMemo(
    () => effectiveSections.find((s) => s.kind === "files"),
    [effectiveSections]
  );
  // 하위 탭에서는 파일 섹션 제외, 어드민이 정한 sectionOrder 로 정렬
  const propertyTabs = useMemo(() => {
    const base = effectiveSections.filter((s) => s.kind !== "files");
    if (!sectionOrder || sectionOrder.length === 0) return base;
    const byId = new Map(base.map((s) => [s.id, s]));
    const ordered: typeof base = [];
    const used = new Set<string>();
    for (const id of sectionOrder) {
      const s = byId.get(id);
      if (s) { ordered.push(s); used.add(id); }
    }
    for (const s of base) {
      if (!used.has(s.id)) ordered.push(s);
    }
    return ordered;
  }, [effectiveSections, sectionOrder]);

  // 섹션 탭 드래그앤드롭
  const [draggingSection, setDraggingSection] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const handleSectionDragStart = (id: string) => (e: React.DragEvent) => {
    if (!isAdmin || !onReorderSections) return;
    setDraggingSection(id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const handleSectionDragOver = (id: string) => (e: React.DragEvent) => {
    if (!isAdmin || !onReorderSections || !draggingSection) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSection(id);
  };
  const handleSectionDrop = (targetId: string) => (e: React.DragEvent) => {
    if (!isAdmin || !onReorderSections || !draggingSection) return;
    e.preventDefault();
    const from = draggingSection;
    setDraggingSection(null);
    setDragOverSection(null);
    if (from === targetId) return;
    const cur = propertyTabs.map((s) => s.id);
    const fromIdx = cur.indexOf(from);
    const toIdx = cur.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...cur];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, from);
    onReorderSections(next);
  };
  const handleSectionDragEnd = () => {
    setDraggingSection(null);
    setDragOverSection(null);
  };

  const [activeTab, setActiveTab] = useState<string>(() => propertyTabs[0]?.id ?? "contract");
  useEffect(() => {
    if (!propertyTabs.find((s) => s.id === activeTab)) setActiveTab(propertyTabs[0]?.id ?? "contract");
  }, [propertyTabs, activeTab]);
  // 탭 변경 시 컬럼 삭제 모드 자동 해제
  useEffect(() => { setColumnDeleteMode(false); setColumnEditMode(false); }, [activeTab]);

  // 활성 섹션 — 여러 분기에서 반복 호출하던 propertyTabs.find 를 한 변수로 추출
  // (가독성 + 매 렌더마다 같은 .find 가 4번 도는 비효율 제거)
  const activeSection = useMemo(
    () => propertyTabs.find((s) => s.id === activeTab),
    [propertyTabs, activeTab],
  );
  // activePanel 관련 상태는 effectiveSections 위쪽 useFieldOrder 옆에서 이미 선언함 (선언 순서 문제 회피).
  // (옛 자리에 두면 effectiveSections useMemo 가 declaration before use 오류로 빌드 실패)
  // 파일 패널의 카테고리 필터 — file 형식 컬럼 셀 클릭 시 그 컬럼 라벨로 자동 설정.
  // 파일 패널 직접 진입 시엔 null → 전체 보기.
  const [fileFilterCategory, setFileFilterCategory] = useState<string | null>(null);
  // file 형식 컬럼 셀에서 호출 — 파일 패널로 점프 + 그 컬럼 라벨 카테고리 자동 적용
  const jumpToFiles = useCallback((category: string) => {
    setFileFilterCategory(category);
    setActivePanel("files");
  }, []);
  // 파일 패널 탭을 사용자가 직접 누르면 카테고리 필터 해제 (전체 보기)
  const openFilesPanel = useCallback(() => {
    setFileFilterCategory(null);
    setActivePanel("files");
  }, []);
  const [pendingComments, setPendingComments] = useState<string[]>([]);
  const [newCommentDraft, setNewCommentDraft] = useState("");

  const isNew = localRow?._isNew === true;
  const localRowRef = useRef(localRow);
  localRowRef.current = localRow;
  // 닫기 가드 함수 참조 — ESC 핸들러(위쪽 useEffect)가 본문 아래 정의된 handleCloseWithGuard 를
  // 호출할 수 있도록 안정적 ref 로 보관. 매 렌더 최신 함수 할당.
  const closeGuardRef = useRef<() => void>(() => {});

  useEffect(() => {
    // row 그대로 반영 — null 이면 모달이 호출부에서 안 그려지는 게 정상 (조건부 렌더)
    // 새 업체 모달은 호출부에서 row={{ _isNew: true }} 명시 전달해야 정상 동작
    if (!row) { setLocalRow(null); return; }
    setLocalRow((prev) => {
      // 처음 열거나 다른 행이 열리면 → 새 row 채택
      if (!prev || String(prev._id || "") !== String(row._id || "")) return row;
      // 같은 행이 부모 폴링(5초 주기)으로 갱신됨 — 사용자가 이 모달에서 보고/편집 중이므로
      // 로컬 값을 우선해 보존한다. 그렇지 않으면 파일 업로드·카테고리 변경·필드 편집 직후
      // 저장이 끝나기 전에 폴링 옛 데이터가 모달 내용을 덮어써 "방금 올린 파일이 사라졌다
      // 한참 뒤 다시 보인다"는 오류가 발생함.
      return prev;
    });
  }, [row]);
  // activePanel은 initialPanel이 바뀔 때만 초기화 — row가 polling으로 갱신될 때마다 탭이 리셋되는 버그 방지
  useEffect(() => {
    setActivePanel(initialPanel);
  }, [initialPanel]);

  // [참고] 매번 카드 열 때 자동 정리하던 useEffect 는 사용자 요청으로 제거됨.
  // 대신 moveColumnToSection 의 차수 분기에서 한 번 옮길 때 모든 행의 옛 자리 값을
  // bulk-migrate-tier 통로로 한꺼번에 옮긴다 — 더 명료한 동작·중복 호출 없음.

  // 모달 열림 여부만 의존 — localRow 자체를 의존성에 넣으면 필드 편집마다 키 리스너·body 잠금이 cleanup→재등록되어
  // 다른 코드가 같은 tick 에 body.style.overflow 를 만지면 잠금이 잠시 풀리는 race 위험
  const isModalOpen = !!localRow;
  // 상세 모달 루트 DOM 참조 — 휴대폰 키보드 자동 스크롤이 다른 모달의 입력에 잘못 작동 안 하게 영역 제한.
  const modalRootRef = useRef<HTMLDivElement | null>(null);
  // 모달 닫힐 때 수정 모드 자동 종료 — 다음 열림 시 항상 잠금 상태에서 시작 (사용자 보고: 실수 방지)
  useEffect(() => {
    if (!isModalOpen) {
      setColumnEditMode(false);
      setColumnDeleteMode(false);
    }
  }, [isModalOpen]);

  // 휴대폰에서 입력 칸 누르면 키보드가 떠올라 그 칸을 가리는 문제 해결.
  // focus 시 살짝 늦은 후 (키보드 떠올라온 후) 그 입력 칸을 화면 가운데로 끌어올림.
  // 사용자 보고(2026-05-24): 휴대폰 상세 모달에서 입력 칸 가림.
  useEffect(() => {
    if (!isModalOpen) return;
    if (typeof window === "undefined") return;
    // 손가락 터치 가능한 화면(약 768픽셀 이하 + 터치 지원) 에서만 적용
    const isTouchMobile = window.innerWidth < 768 && "ontouchstart" in window;
    if (!isTouchMobile) return;
    // 진행 중인 타이머 추적 — cleanup 시 모두 취소
    const pendingTimers = new Set<number>();
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
      // 다른 모달 안의 입력에는 작동 안 하게 — 이 모달 루트 안에 있는 입력만 처리
      const root = modalRootRef.current;
      if (!root || !root.contains(target)) return;
      const id = window.setTimeout(() => {
        pendingTimers.delete(id);
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          // scrollIntoView 옵션 미지원 환경 — 옛 브라우저 그냥 무시
        }
      }, 300);
      pendingTimers.add(id);
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      // 모달 닫힘·재마운트 시 진행 중 타이머 모두 취소 — 사라진 입력 칸에 스크롤 시도 차단
      for (const id of pendingTimers) window.clearTimeout(id);
      pendingTimers.clear();
    };
  }, [isModalOpen]);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // ESC 도 닫기 가드를 거침 — 새 업체 등록 중 저장 안 한 입력이 있으면 확인 후 닫기
      if (e.key === "Escape") closeGuardRef.current();
    }
    if (isModalOpen) {
      document.addEventListener("keydown", handleKey);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKey);
        document.body.style.overflow = "";
      };
    }
  }, [isModalOpen]);

  // 메모 draft flush — 패널 전환·모달 닫기 시 미저장 글이 사라지지 않도록 즉시 저장.
  const handleFieldSaveRef = useRef<((key: string, value: string | number | boolean | null) => void) | null>(null);
  const flushMemoDraft = () => {
    const draft = memoDraftRef.current;
    const row = localRowRef.current;
    if (!row) return;
    for (const [panelId, value] of Object.entries(draft)) {
      const key = `_panel_memo_${panelId}`;
      const saved = (row[key] as string | undefined) ?? "";
      if (value !== saved) {
        handleFieldSaveRef.current?.(key, value);
      }
    }
    setMemoDraft({});
  };

  const handleFieldSave = useCallback(
    async (key: string, value: string | number | boolean | null) => {
      setLocalRow((prev) => (prev ? { ...prev, [key]: value } : prev));

      const cur = localRowRef.current;
      if (!cur?._id || cur._isNew) return;
      const pageId = String(cur._id);
      // 부모(목록 화면·자동입력 규칙)에 값 변경 알림 — 저장 자체는 아래 dataSource.patchField 가 한다(역할 분리).
      onFieldChange?.(pageId, key, value);

      // 같은 행에 공존하는 같은 패턴(팀장/팀원) 다른 키들은 모두 빈 값으로 정리.
      // ── 정책: 단일 진실 원천(SoT) ──
      // 자기 키 = 새 값(위에서 이미 저장됨). 같은 패턴 다른 키들 = 항상 빈 값.
      // 이렇게 하면:
      //   1) 비우기 → 자기 빈 값 + 다른 빈 값 → 보정 함수가 fallback 못 함 → 화면 빈 칸 유지 (사용자 의도 달성)
      //   2) 값 입력 → 자기 값 + 다른 빈 값 → 보정 fallback 의미 없어짐 → 데이터 자연 정리 (같은 값 중복 키 부풀림 방지)
      const isLeaderKey = key.startsWith("team_leader_") || key === "team_leader";
      const isMemberKey = key.startsWith("team_member_") || key === "team_member";
      const cleanupKeys: string[] = [];
      if (isLeaderKey || isMemberKey) {
        for (const rk of Object.keys(cur)) {
          if (rk === key || rk.startsWith("_")) continue;
          if (isLeaderKey && (rk.startsWith("team_leader_") || rk === "team_leader")) cleanupKeys.push(rk);
          if (isMemberKey && (rk.startsWith("team_member_") || rk === "team_member")) cleanupKeys.push(rk);
        }
      }
      for (const ck of cleanupKeys) {
        setLocalRow((prev) => (prev ? { ...prev, [ck]: null } : prev));
        onFieldChange?.(pageId, ck, null);
        Promise.resolve(dataSource.patchField(pageId, ck, null)).catch((err) => console.warn("[팀장/팀원 옛 키 정리 저장 실패]", ck, err));
      }

      // 수식 컬럼 자동 갱신 — 변경된 키를 참조하는 수식 컬럼이 있으면 그 결과도 같이 계산해 저장
      // 예: 예상수수료(변경) → 예상매출이익(자동) = 예상수수료 × 0.3
      const dependents = customColumns.filter((c) => c.type === "formula" && c.formula?.refKey === key);
      const dependentUpdates: Array<{ key: string; value: number | null }> = [];
      for (const dep of dependents) {
        if (!dep.formula) continue;
        const base = Number(value);
        let result: number | null = null;
        if (!Number.isNaN(base) && Number.isFinite(base)) {
          switch (dep.formula.op) {
            case "*": result = base * dep.formula.operand; break;
            case "+": result = base + dep.formula.operand; break;
            case "-": result = base - dep.formula.operand; break;
            case "/": result = dep.formula.operand !== 0 ? base / dep.formula.operand : null; break;
          }
        }
        // 로컬·전역 state 즉시 반영
        setLocalRow((prev) => (prev ? { ...prev, [dep.key]: result } : prev));
        onFieldChange?.(pageId, dep.key, result);
        dependentUpdates.push({ key: dep.key, value: result });
      }

      setSaving(key);
      try {
        await dataSource.patchField(pageId, key, value);
        // 수식 결과도 서버에 저장 (순차 — 작은 수라 부담 없음)
        for (const upd of dependentUpdates) {
          await Promise.resolve(dataSource.patchField(pageId, upd.key, upd.value)).catch((err) => console.warn("[formula PATCH]", upd.key, err));
        }
      } catch (err) {
        console.error("Update error:", err);
      } finally {
        setSaving(null);
      }
    },
    [onFieldChange, customColumns]
  );

  // 첨부파일 형식 컬럼 셀에서 직접 업로드 — 그 컬럼 라벨 카테고리로 자동 분류
  // 결과는 _files 배열에 추가되어 파일 섹션에서도 한 번에 모아 볼 수 있음
  const handleUploadFilesInline = useCallback(async (fileList: FileList, category: string) => {
    const cur = localRowRef.current;
    if (!cur) return;
    // 새 업체 등록 중(_isNew)이어도 파일은 저장소에 미리 올려두고 화면에 보관한다.
    // 행이 아직 없어 서버 PATCH 는 못 하지만, 저장(생성) 시 _files 가 함께 저장된다.
    const isNewRow = !cur._id || cur._isNew;
    const existing = (cur._files as unknown as FileMeta[] | undefined) || [];
    const next: FileMeta[] = [...existing];
    // 실패는 누적해 마지막에 한 번에 알림 — N건 일괄 실패 시 N번 모달 띄우는 일 방지
    const failures: string[] = [];
    let totalSkipped = 0;
    for (const f of Array.from(fileList)) {
      try {
        // 업로드는 앱별 서버 연결(dataSource.uploadFile)이 담당 — 응답은 예전 /api/upload 와 같은 모양(파일목록·단건·skipped).
        const j = (await dataSource.uploadFile?.(f)) ?? null;
        if (j?.success && Array.isArray(j.files)) {
          // ZIP 자동 해제 — 압축 안의 여러 파일을 각각 첨부 목록에 추가
          if (typeof j.skipped === "number") totalSkipped += j.skipped;
          for (const ff of j.files) {
            next.push({
              id: ff.id,
              fileName: ff.fileName,
              url: ff.url,
              contentType: ff.mimeType,
              category,
            });
          }
        } else if (j?.success && j.data) {
          next.push({
            id: j.data.id,
            fileName: j.data.fileName,
            url: j.data.url,
            contentType: j.data.mimeType,
            category, // 컬럼 이름으로 자동 분류 — 파일 패널에서 같은 갈래로 모아 보임
          });
        } else {
          failures.push(`${f.name}: ${j?.error || "알 수 없는 오류"}`);
        }
      } catch (e) {
        console.error("[inline upload]", e);
        failures.push(`${f.name}: 업로드 중 오류 발생`);
      }
    }
    if (totalSkipped > 0) {
      void dialog.alert(
        `압축 안의 ${totalSkipped}개 파일은 제외됐습니다.\n(위험 형식, 크기 초과, 또는 개수 한도 초과)`,
        { title: "일부 파일 제외" },
      );
    }
    if (failures.length > 0) {
      const successCount = Array.from(fileList).length - failures.length;
      const head = successCount > 0 ? `${successCount}건 성공 · ${failures.length}건 실패\n\n` : `${failures.length}건 모두 실패:\n\n`;
      void dialog.alert(head + failures.join("\n"), { title: "업로드 결과" });
    }
    // 화면에 즉시 반영
    setLocalRow((prev) => prev ? ({ ...prev, _files: next as unknown as RowData[string] }) : prev);
    // 새 업체(_isNew)는 아직 행이 없어 서버 저장 안 함 — 저장(생성) 시 _files 가 함께 저장됨.
    // 기존 행이면 부모(표/카드) 반영 + 서버 저장.
    if (!isNewRow) {
      const pid = String(cur._id);
      onFieldChange?.(pid, "_files", next as unknown as string | number | boolean | null);
      try {
        await dataSource.patchField(pid, "_files", next as unknown as string | number | boolean | null);
      } catch (err) {
        console.error("[inline upload PATCH]", err);
      }
    }
  }, [onFieldChange]);

  // handleFieldSave 최신값을 ref 에 보관 — flushMemoDraft 가 호출할 수 있게.
  useEffect(() => { handleFieldSaveRef.current = handleFieldSave; }, [handleFieldSave]);

  // 패널 전환 또는 모달 닫기 시 미저장 메모 자동 저장.
  // cleanup 은 activePanel 이 바뀌기 직전·컴포넌트 unmount 직전에 실행 → 그 시점 ref 최신 draft 로 flush.
  useEffect(() => {
    return () => flushMemoDraft();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel]);

  // file 형식 컬럼 셀에서 한 파일 제거 — _files 에서 빼고 서버 동기화
  const handleRemoveFileInline = useCallback(async (fileId: string) => {
    const cur = localRowRef.current;
    if (!cur?._id || cur._isNew) return;
    const existing = (cur._files as unknown as FileMeta[] | undefined) || [];
    const next = existing.filter((f) => f.id !== fileId);
    setLocalRow((prev) => prev ? ({ ...prev, _files: next as unknown as RowData[string] }) : prev);
    const pid = String(cur._id);
    onFieldChange?.(pid, "_files", next as unknown as string | number | boolean | null);
    try {
      await dataSource.patchField(pid, "_files", next as unknown as string | number | boolean | null);
    } catch (err) {
      console.error("[remove file PATCH]", err);
    }
  }, [onFieldChange]);

  // 파일 목록(_files) 업데이트 — 파일 패널 업로드·카테고리 변경·삭제 후 호출.
  // 즉시 로컬 + 부모(표/카드) 반영 + 서버 저장.
  const handleFilesUpdate = useCallback(async (next: FileMeta[]) => {
    setLocalRow((prev) => prev ? ({ ...prev, _files: next as unknown as RowData[string] }) : prev);
    const cur = localRowRef.current;
    if (!cur?._id || cur._isNew) return;
    const pid = String(cur._id);
    onFieldChange?.(pid, "_files", next as unknown as string | number | boolean | null);
    try {
      await dataSource.patchField(pid, "_files", next as unknown as string | number | boolean | null);
    } catch (err) {
      console.error("[Files PATCH]", err);
    }
  }, [onFieldChange]);

  const handleCreate = useCallback(async () => {
    if (!localRow || creating) return;
    // 공백만 입력한 이름은 빈 것으로 간주 — 이름 없는 업체 생성 방지.
    // 이름(상호) 컬럼은 앱이 지정(primaryFieldKey). 미지정 시 이름 필수 검증 생략.
    const name = primaryFieldKey ? String(localRow[primaryFieldKey] || "").trim() : "";
    if (primaryFieldKey && !name) return;
    setCreating(true);

    const rowData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(localRow)) {
      if (!k.startsWith("_") && v !== null && v !== undefined && v !== "") {
        rowData[k] = v;
      }
    }
    // 등록 중 미리 첨부한 파일(_files)도 함께 저장 — 새 업체 등록 + 파일 동시 첨부 지원.
    const pendingFiles = localRow._files as unknown as FileMeta[] | undefined;
    if (Array.isArray(pendingFiles) && pendingFiles.length > 0) {
      rowData._files = pendingFiles;
    }

    const tempId = `local-${Date.now()}`;
    const optimisticRow: RowData = { ...localRow, _id: tempId, _isNew: null };
    onCreate?.(optimisticRow);
    onClose();

    try {
      // 신규 행 생성은 앱별 서버 연결(dataSource.createRow)이 담당 — 서버가 만든 실제 행을 돌려준다.
      const created = dataSource.createRow
        ? await Promise.resolve(dataSource.createRow(rowData as unknown as ShellRowData, pendingComments))
        : null;
      if (created) {
        onCreate?.({ ...optimisticRow, ...created });
      }
    } catch (err) {
      console.error("Create error:", err);
    } finally {
      setCreating(false);
    }
  }, [localRow, creating, onCreate, onClose, pendingComments]);

  // 새 업체 등록 모달 닫기 — 저장 안 한 입력이 있으면 확인 후 닫기 (실수로 입력 날리는 것 방지).
  const handleCloseWithGuard = async () => {
    if (isNew && localRow) {
      let hasInput = false;
      for (const [k, v] of Object.entries(localRow)) {
        if (k === "_isNew" || k === "_id" || k === "_source" || k === "_createdTime") continue;
        if (k === "_files") {
          if (Array.isArray(v) && v.length > 0) { hasInput = true; break; }
          continue;
        }
        if (!k.startsWith("_") && v !== null && v !== undefined && String(v).trim() !== "") {
          hasInput = true;
          break;
        }
      }
      if (hasInput) {
        const ok = await dialog.confirm(
          "저장하지 않은 입력이 있습니다. 저장하지 않고 닫으시겠어요?",
          { title: "저장 안 함", confirmLabel: "저장 안 하고 닫기", cancelLabel: "계속 작성", danger: true },
        );
        if (!ok) return;
      }
    }
    onClose();
  };
  // ESC 핸들러(위쪽 useEffect)가 참조하는 최신 닫기 가드 함수
  closeGuardRef.current = handleCloseWithGuard;

  if (!localRow) return null;

  // 이름(상호) 컬럼 키 — 앱이 지정(primaryFieldKey). 제목 표시·신규 입력칸에 쓰인다.
  const nameKey = primaryFieldKey ?? "";
  const title = isNew ? newRowTitle : ((nameKey ? localRow[nameKey] : "") || untitledLabel);
  const pageId = String(localRow._id || "");

  // External _files
  const extra = localRow as unknown as {
    _files?: FileMeta[];
  };
  const files: FileMeta[] = Array.isArray(extra?._files) ? extra._files! : [];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={handleCloseWithGuard} />

      <div ref={modalRootRef} data-modal="detail" className="relative w-full h-full sm:w-[90vw] sm:h-auto sm:max-w-[800px] sm:max-h-[92vh] bg-white shadow-2xl animate-modal-in flex flex-col rounded-none sm:rounded-2xl overflow-hidden">
        {/* Header — 모바일에서도 사용 편의 위해 충분히 크게. 가로 스크롤로 잘림 처리 */}
        <div className="border-b border-wedly-bd/60 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between flex-shrink-0 gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0",
              isNew ? "bg-wedly-accent" : "bg-wedly-navy"
            )}>
              {isNew ? "+" : "G"}
            </div>
            {isNew && nameKey ? (
              // 새 업체 등록 — 이름(상호) 컬럼은 title 형식이라 일반 칸으로 안 그려지므로 제목 자리에 직접 입력칸 제공.
              // 이 칸을 채워야 저장 버튼이 활성화된다 (이름 필수). primaryFieldKey 미지정 앱은 빈 키 기록 방지 위해 입력칸 대신 제목만 표시.
              <input
                type="text"
                value={String((nameKey ? localRow[nameKey] : "") || "")}
                onChange={(e) => setLocalRow((prev) => (prev ? { ...prev, [nameKey]: e.target.value } : prev))}
                placeholder="새 업체 상호명 입력 (필수)"
                autoFocus
                className="flex-1 min-w-0 text-[16px] sm:text-lg font-bold text-wedly-navy bg-transparent border-b border-wedly-bd focus:border-wedly-accent outline-none placeholder:text-wedly-muted placeholder:font-normal"
              />
            ) : (
              <h2 className="text-[16px] sm:text-lg font-bold text-wedly-navy truncate">{String(title)}</h2>
            )}
            {saving && <span className="text-[11px] text-wedly-accent animate-pulse flex-shrink-0">저장 중...</span>}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {isNew && (
              <button
                onClick={handleCreate}
                disabled={creating || (nameKey ? !String(localRow[nameKey] || "").trim() : false)}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 text-[13px] font-medium text-white bg-wedly-accent rounded-lg hover:bg-wedly-accent/90 disabled:opacity-40 transition-colors"
              >
                {creating ? "저장 중..." : "저장"}
              </button>
            )}
            <button
              onClick={handleCloseWithGuard}
              className="flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg hover:bg-wedly-bg-gray text-wedly-muted hover:text-wedly-t2 transition-colors"
              aria-label="닫기"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Panel toggle — 알약 칩 디자인으로 통일 (sub-tab과 동일) */}
        <div className="flex gap-1 px-3 sm:px-6 py-2 flex-shrink-0 bg-wedly-bg-gray/50 border-b border-wedly-bd/60 overflow-x-auto">
          <button
            onClick={() => setActivePanel("properties")}
            className={cn(
              "px-3 py-1.5 text-[14px] sm:text-[13px] font-semibold rounded-full transition-colors flex-shrink-0 whitespace-nowrap",
              activePanel === "properties"
                ? "bg-wedly-bg-blue text-wedly-accent"
                : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2"
            )}
          >
            상세 정보
          </button>
          <button
            onClick={() => setActivePanel("history")}
            className={cn(
              "px-3 py-1.5 text-[14px] sm:text-[13px] font-semibold rounded-full transition-colors flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap",
              activePanel === "history"
                ? "bg-wedly-bg-blue text-wedly-accent"
                : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12v8a1 1 0 01-1 1H5l-3 3V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            히스토리
            {panelCommentCounts["default"] > 0 && (
              <span className={cn(
                "tabular-nums text-[10.5px] font-semibold rounded px-1",
                activePanel === "history" ? "bg-white/70" : "bg-wedly-bg-gray"
              )}>
                {panelCommentCounts["default"]}
              </span>
            )}
          </button>
          {filesSection && (
            <button
              onClick={openFilesPanel}
              className={cn(
                "px-3 py-1.5 text-[14px] sm:text-[13px] font-semibold rounded-full transition-colors flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap",
                activePanel === "files"
                  ? "bg-wedly-bg-blue text-wedly-accent"
                  : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2"
              )}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 1.5h6L13 5v9a1 1 0 01-1 1H3.5a1 1 0 01-1-1V2.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              {filesSection.label || "파일"}
            </button>
          )}
          {/* 사용자 정의 상위 패널 — 추가/이름수정/삭제는 우상단 "탭 편집" 메뉴 안 "상위 패널 관리" 에서.
              history 종류는 글 개수 칩도 같이 표시 (기본 히스토리 탭과 동일 패턴). */}
          {customPanels.map((p) => {
            const cnt = panelCommentCounts[p.id];
            return (
              <button
                key={p.id}
                onClick={() => setActivePanel(p.id)}
                className={cn(
                  "px-3 py-1.5 text-[14px] sm:text-[13px] font-semibold rounded-full transition-colors inline-flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap",
                  activePanel === p.id
                    ? "bg-wedly-bg-blue text-wedly-accent"
                    : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2"
                )}
              >
                <span>{p.label}</span>
                {p.kind === "history" && cnt > 0 && (
                  <span className={cn(
                    "tabular-nums text-[10.5px] font-semibold rounded px-1",
                    activePanel === p.id ? "bg-white/70" : "bg-wedly-bg-gray"
                  )}>
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body — min-w-0 추가: flex 아이템 기본 min-width:auto 때문에 자식 overflow-x-auto 가 동작 안 했음
            (사용자 보고: 섹션 탭 가로 스크롤 안 됨 / 편집 시 컬럼이 왼쪽으로 잘림) */}
        <div className="flex flex-1 min-h-0 min-w-0">
          {/* Properties panel */}
          {(activePanel === "properties" || customPanels.find((p) => p.id === activePanel)?.kind === "fields") && (
            <div className="flex flex-col flex-1 min-w-0">
              {/* Sub-tabs — 드래그앤드롭으로 순서 변경 (어드민) + 모바일 가로 스크롤.
                  히스토리 패널과 동일한 구조: 왼쪽(스크롤) 탭들 / 오른쪽(고정) "탭 편집" 메뉴 버튼.
                  탭 편집 메뉴가 가로 스크롤에 잘리지 않도록 분리. */}
              <div className="border-b border-wedly-bd/60 flex-shrink-0 flex items-center">
                <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden pb-1 sm:pb-0">
                  <div className="flex px-3 sm:px-6 min-w-max">
                  {propertyTabs.map((s) => {
                    const isActive = activeTab === s.id;
                    const isDragging = draggingSection === s.id;
                    const isDragOver = dragOverSection === s.id && draggingSection && draggingSection !== s.id;
                    return (
                      <div
                        key={s.id}
                        draggable={isAdmin && !!onReorderSections}
                        onDragStart={handleSectionDragStart(s.id)}
                        onDragOver={handleSectionDragOver(s.id)}
                        onDragLeave={() => setDragOverSection(null)}
                        onDrop={handleSectionDrop(s.id)}
                        onDragEnd={handleSectionDragEnd}
                        className={cn(
                          "flex items-center transition-all whitespace-nowrap flex-shrink-0 my-1 mx-0.5",
                          isDragging && "opacity-40",
                          isDragOver && "bg-wedly-bg-blue/40 rounded-md",
                        )}
                      >
                        <button
                          onClick={() => setActiveTab(s.id)}
                          className={cn(
                            "px-3 py-1.5 text-[13px] font-semibold rounded-full transition-colors whitespace-nowrap",
                            isActive
                              ? "bg-wedly-bg-blue text-wedly-accent"
                              : "text-wedly-muted hover:bg-wedly-bg-gray hover:text-wedly-t2",
                          )}
                        >
                          {s.label}
                        </button>
                      </div>
                    );
                  })}
                  </div>
                </div>
                {/* 우상단 "탭 편집" 메뉴 — 옛 별도 줄에서 섹션 탭 줄 끝으로 이동.
                    스크롤 영역 밖이라 드롭다운이 안 잘림. */}
                {isAdmin && activeSection && (!activeSection.kind || activeSection.kind === "fields") && (
                  <div className="pr-3 sm:pr-6 my-1 flex-shrink-0">
                    <SectionAdminMenu
                      sectionId={activeTab}
                      sectionLabel={activeSection.label || activeTab}
                      onAddColumn={openAddColumnModal}
                      onResetOrder={activeTab === "contract" ? resetFieldOrder : undefined}
                      hasCustomOrder={activeTab === "contract" ? hasCustomFieldOrder : false}
                      onToggleDeleteMode={() => setColumnDeleteMode((v) => !v)}
                      deleteMode={columnDeleteMode}
                      onToggleEditMode={() => setColumnEditMode((v) => !v)}
                      editMode={columnEditMode}
                      onShowHiddenColumns={() => setShowHiddenColumnsModal(true)}
                      hiddenCount={disabledColumns.length}
                      onToggleOtherSection={onToggleOtherSection}
                      showOtherSection={showOtherSection}
                      onAddSection={onAddSection ? () => setShowAddSectionModal(true) : undefined}
                      onDeleteSection={onDeleteSection && customSectionIds.includes(activeTab) ? () => setShowDeleteSectionConfirm(true) : undefined}
                      canDeleteSection={customSectionIds.includes(activeTab)}
                      onManagePanels={onAddCustomPanel ? () => setShowPanelManagerModal(true) : undefined}
                    />
                  </div>
                )}
              </div>

              {/* Tab content — 좁은 화면에서 내용이 부모 폭을 못 넘게 overflow-x-hidden + min-w-0 */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-3 sm:px-6 py-4">
                {/* 진단 박스 — 어드민 + URL ?debug=1 일 때만 노출. 사업장 컬럼 구조 점검용 */}
                {isAdmin && typeof window !== "undefined" && window.location.search.includes("debug=1") && (() => {
                  const rowKeys = row ? Object.keys(row).filter((k) => !k.startsWith("_")) : [];
                  // 라벨별 키 그룹 — 같은 라벨로 묶인 키들을 함께 보여줌
                  const labelGroups = new Map<string, string[]>();
                  for (const f of visibleFields) {
                    const lbl = (f.label || f.key).replace(/\s+/g, "");
                    const arr = labelGroups.get(lbl) || [];
                    arr.push(f.key);
                    labelGroups.set(lbl, arr);
                  }
                  // row 안 키 중 visibleFields 에 없는 것 — 잔존 키 후보
                  const visibleKeySet = new Set(visibleFields.map((f) => f.key));
                  const orphanRowKeys = rowKeys.filter((k) => !visibleKeySet.has(k));
                  // 같은 라벨로 두 개 이상 묶인 그룹 = 중복 의심
                  const dupGroups = Array.from(labelGroups.entries()).filter(([, ks]) => ks.length > 1);
                  return (
                    <div className="mb-3 p-3 rounded-lg border border-wedly-orange/40 bg-wedly-bg-yellow/40 text-[11px] text-wedly-t2 space-y-1.5 font-mono">
                      <div className="font-bold text-wedly-orange">진단 정보 (URL 에 ?debug=1 일 때만 노출)</div>
                      <div>
                        <span className="font-bold">활성 섹션:</span> {activeSection?.id} ({activeSection?.label}) — 컬럼 키 [{(activeSection?.fieldKeys || []).join(", ") || "(없음 — 전체)"}]
                      </div>
                      <div>
                        <span className="font-bold">기본정보 fieldKeys:</span> [{(effectiveSections.find((s) => s.id === "basic" || s.label === "기본정보")?.fieldKeys || []).join(", ") || "(없음)"}]
                      </div>
                      <div>
                        <span className="font-bold">기타 fieldKeys:</span> [{(effectiveSections.find((s) => s.id === "other")?.fieldKeys || []).join(", ") || "(없음)"}]
                      </div>
                      <div className="border-t border-wedly-orange/30 pt-1.5">
                        <span className="font-bold">전체 섹션 ({effectiveSections.length}):</span>
                        {effectiveSections.map((s) => (
                          <div key={s.id} className="ml-2">
                            • id=<span className="text-wedly-accent">{s.id}</span> / label=<span className="text-wedly-accent">{s.label}</span> / kind={s.kind || "(fields)"} / 키 {s.fieldKeys?.length ?? 0}개
                          </div>
                        ))}
                      </div>
                      <div>
                        <span className="font-bold">visibleFields ({visibleFields.length}):</span> {visibleFields.slice(0, 30).map((f) => `${f.key}(${f.label})`).join(", ")}{visibleFields.length > 30 ? " …" : ""}
                      </div>
                      <div>
                        <span className="font-bold">사업장 키 ({rowKeys.length}):</span> {rowKeys.slice(0, 40).join(", ")}{rowKeys.length > 40 ? " …" : ""}
                      </div>
                      {orphanRowKeys.length > 0 && (
                        <div className="text-wedly-red">
                          <span className="font-bold">⚠️ 사업장 안에 있지만 컬럼 목록엔 없는 키:</span> {orphanRowKeys.join(", ")}
                        </div>
                      )}
                      {dupGroups.length > 0 && (
                        <div className="text-wedly-red">
                          <span className="font-bold">⚠️ 같은 라벨로 묶인 두 개 이상 키 (중복 의심):</span>
                          {dupGroups.map(([lbl, ks]) => ` "${lbl}" → [${ks.join(", ")}]`).join(";")}
                        </div>
                      )}
                      {dupGroups.length === 0 && orphanRowKeys.length === 0 && (
                        <div className="text-wedly-green font-bold">✓ 라벨 중복 없음 — 모든 섹션이 한 컬럼만 그릴 상태</div>
                      )}
                    </div>
                  );
                })()}
                {/* (옛 본문 위 별도 줄 "탭 편집" 위치 제거 — 섹션 탭 줄 끝으로 이동했음. 히스토리 패널과 통일.) */}
                {(() => {
                  const cur = activeSection;
                  if (!cur) return null;
                  // 분기 판단을 모두 cur.kind 기준으로 — 사용자 데이터의 식별 이름이 어긋나도 화면 정확
                  if (cur.kind === "settlement") return null;  // 아래 settlement 블록에서 렌더
                  if (cur.kind === "tiered-contract" || cur.kind === "tiered-refund") return null;  // 아래 tiered 블록에서 렌더
                  if (cur.kind === "meetings") {
                    const rawMeetings = localRow["_meetings"] ?? null;
                    return (
                      <MeetingsTab
                        key={`meet-${cur.id}`}
                        rawValue={rawMeetings}
                        onSave={(json) => handleFieldSave("_meetings", json)}
                        userNames={pickUserCandidates(meetingFieldLabels?.assignee || "담당 팀장", userDirectory)}
                        fieldLabels={meetingFieldLabels}
                        onFieldLabelsChange={isAdmin ? onChangeMeetingLabels : undefined}
                      />
                    );
                  }
                  // 일반 fields 섹션 — 드래그앤드롭 지원 (어드민만)
                  // contract id 면서 fields 모드인 경우는 아래 contract 블록에서 별도 렌더 (옛 호환)
                  if (cur.id === "contract") return null;
                  // 진단(2026-05-25) 결과 확정 fix:
                  // 일반 섹션이 빈 fieldKeys 면 "전체 보여주기" 옛 호환 동작이 사용자 데이터에선 사고
                  // (기본정보가 명시 60+ 키 그리고 기타가 fieldKeys=[] 로 visibleFields 6 개 통째 그려
                  //  같은 6 개가 두 곳 노출). 빈 fieldKeys = 빈 섹션 으로 강제.
                  // 계약 섹션은 별도 경로(contractDrawFields)라 영향 없음.
                  const sectionFields = (cur.fieldKeys && cur.fieldKeys.length > 0)
                    ? resolveSectionFields(cur.fieldKeys)
                    : [];
                  return (
                    <DraggableFieldsSection
                      key={`sec-${cur.id}`}
                      sectionId={cur.id}
                      sectionLabel={cur.label}
                      sectionFields={sectionFields}
                      scope={scope}
                      isAdmin={isAdmin}
                      localRow={localRow}
                      handleFieldSave={handleFieldSave}
                      userDirectory={userDirectory}
                      allSections={effectiveSections}
                      onMoveColumn={moveColumnToSection}
                      onHideColumn={onHideColumn}
                      onDeleteColumn={onDeleteColumn}
                      isCustomColumn={isCustomColumn}
                      onAddColumn={openAddColumnModal}
                      deleteMode={columnDeleteMode}
                      editMode={columnEditMode}
                      onChangeColumnType={onChangeColumnType ? (k) => {
                        const f = sectionFields.find((x) => x.key === k);
                        setChangeTypeModal({ key: k, label: f?.label || k, currentType: f?.type || "text" });
                      } : undefined}
                      onRenameColumn={columnEditMode ? onRenameColumn : undefined}
                      onJumpToFiles={jumpToFiles}
                      onUploadFiles={handleUploadFilesInline}
                      onRemoveFile={handleRemoveFileInline}
                      dialog={shellDialog}
                      openFile={openFileForRow}
                      selectDropdownBody={SelectDropdownBody}
                    />
                  );
                })()}
                {/* 계약정보 일반 fields 모드 — kind 기준 보호.
                    cur.id==="contract" 이고 kind 가 "fields" 일 때만 진입 (tiered-contract 변환됐을 땐 안 그림).
                    드래그 상태는 부모(이 파일)에서 useFieldOrder("contract") 로 이미 계산해 둠. */}
                {(activeSection?.id === "contract" && (activeSection.kind === "fields" || !activeSection.kind)) && (
                  <SharedDraggableFieldsSection<DetailField>
                    sectionId="contract"
                    sectionLabel={activeSection.label}
                    isAdmin={isAdmin}
                    editMode={columnEditMode}
                    deleteMode={columnDeleteMode}
                    orderedFields={contractDrawFields}
                    isOrderLoaded={isContractOrderLoaded}
                    draggingKey={draggingKey}
                    dragOverKey={dragOverKey}
                    handleDragStart={handleDragStart}
                    handleDragOver={handleDragOver}
                    handleDragLeave={handleDragLeave}
                    handleDrop={handleDrop}
                    handleDragEnd={handleDragEnd}
                    onHideColumn={onHideColumn}
                    renderRow={(field) => (
                      <EditableFieldRow
                        field={field}
                        value={resolveFieldValue(localRow, field)}
                        onSave={handleFieldSave}
                        userNames={pickUserOpts(field.label)}
                        row={localRow}
                        onJumpToFiles={jumpToFiles}
                        onUploadFiles={handleUploadFilesInline}
                        onRemoveFile={handleRemoveFileInline}
                        onRenameColumn={columnEditMode ? onRenameColumn : undefined}
                        isAdmin={isAdmin}
                        dialog={shellDialog}
                        openFile={openFileForRow}
                        SelectDropdownBody={SelectDropdownBody}
                      />
                    )}
                    renderAdminMenu={(field) => (
                      <FieldRowAdminMenu
                        fieldKey={field.key}
                        fieldLabel={field.label}
                        currentSectionId="contract"
                        allSections={effectiveSections}
                        onMoveColumn={moveColumnToSection}
                        onHideColumn={onHideColumn}
                        onDeleteColumn={onDeleteColumn}
                        canDelete={isCustomColumn ? isCustomColumn(field.key) : false}
                        onChangeType={onChangeColumnType ? (k) => setChangeTypeModal({ key: k, label: field.label, currentType: field.type }) : undefined}
                        canChangeType={isCustomColumn ? isCustomColumn(field.key) : false}
                      />
                    )}
                  />
                )}
                {/* 정산정보 차수 카드 — 활성 섹션의 kind 가 "settlement" 일 때만.
                    탭 식별 이름이 어긋나 있어도 종류 기준으로 정확히 분기 — 기본정보 탭에 정산 화면이 잘못 노출되지 않도록 보호 */}
                {activeSection?.kind === "settlement" && renderSettlementTab?.({
                  variant: "settlement",
                  sectionId: activeSection?.id,
                  row: localRow,
                  readOnly: isNew,
                  isAdmin,
                  reloadToken: tieredReloadToken,
                  onSaveField: handleFieldSave,
                  subSections: detailSubSections?.settlement,
                  onUpdateSubSections: onUpdateDetailSubSections ? (list) => onUpdateDetailSubSections("settlement", list) : undefined,
                })}
                {/* 계약정보·환불정보 차수별 카드 — 어드민이 섹션 kind 를 "tiered-contract" / "tiered-refund" 로 설정 */}
                {(() => {
                  const cur = activeSection;
                  if (!cur) return null;
                  if (cur.kind === "tiered-contract") {
                    return renderSettlementTab?.({
                      variant: "tiered-contract",
                      sectionId: cur.id,
                      row: localRow,
                      readOnly: isNew,
                      isAdmin,
                      reloadToken: tieredReloadToken,
                      onSaveField: handleFieldSave,
                      subSections: detailSubSections?.contract,
                      onUpdateSubSections: onUpdateDetailSubSections ? (list) => onUpdateDetailSubSections("contract", list) : undefined,
                    }) ?? null;
                  }
                  if (cur.kind === "tiered-refund") {
                    return renderSettlementTab?.({
                      variant: "tiered-refund",
                      sectionId: cur.id,
                      row: localRow,
                      readOnly: isNew,
                      isAdmin,
                      reloadToken: tieredReloadToken,
                      onSaveField: handleFieldSave,
                      subSections: detailSubSections?.refund,
                      onUpdateSubSections: onUpdateDetailSubSections ? (list) => onUpdateDetailSubSections("refund", list) : undefined,
                    }) ?? null;
                  }
                  return null;
                })()}
              </div>
            </div>
          )}

          {/* Files panel — 상세 정보 / 히스토리와 같은 계층 */}
          {activePanel === "files" && filesSection && (
            <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-4">
              <FilesTab
                files={files}
                pageId={pageId || ""}
                onFilesChange={(next) => handleFilesUpdate(next)}
                filterCategory={fileFilterCategory || undefined}
                defaultUploadCategory={fileFilterCategory || "기타자료"}
                uploadButtonLabel="파일 업로드"
                emptyMessage={fileFilterCategory ? `'${fileFilterCategory}' 분류 파일이 없습니다` : "첨부파일이 없습니다"}
                disabled={isNew}
                categoryOptions={fileCategoryOptions}
                downloadApiPath={dataSource.fileDownloadPath ?? "/api/files/download"}
                onOpenFile={handleOpenFile}
              />
            </div>
          )}

          {/* History panel — pending mode (new entries) */}
          {activePanel === "history" && isNew && (
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="px-4 py-3 border-b border-wedly-bd/60 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-wedly-accent">
                  <path d="M2 3h12v8a1 1 0 01-1 1H5l-3 3V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <h3 className="text-[13px] font-semibold text-wedly-navy">등록 히스토리</h3>
                <span className="text-[11px] text-wedly-muted ml-auto">저장 시 함께 등록됩니다</span>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-wedly-accent flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">자</div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-medium text-wedly-t1">자동 기록</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-wedly-bg-blue text-wedly-accent font-medium">저장 시</span>
                    </div>
                    <div className="text-[13px] text-wedly-t2 bg-wedly-bg-gray rounded-lg px-3 py-2">업체 등록</div>
                  </div>
                </div>
                {pendingComments.map((text, i) => (
                  <div key={i} className="flex items-start gap-2 group/pc">
                    <div className="w-5 h-5 rounded-full bg-wedly-muted flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">나</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-medium text-wedly-t1">나</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-wedly-bg-yellow text-wedly-gold font-medium">대기</span>
                        <button
                          onClick={() => setPendingComments((prev) => prev.filter((_, idx) => idx !== i))}
                          className="hidden group-hover/pc:inline text-[11px] text-wedly-muted hover:text-wedly-red"
                        >삭제</button>
                      </div>
                      <div className="text-[13px] text-wedly-t2 whitespace-pre-wrap bg-wedly-bg-gray rounded-lg px-3 py-2">{text}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-wedly-bd/60 px-4 py-3">
                <div className="flex gap-2">
                  <textarea
                    value={newCommentDraft}
                    onChange={(e) => setNewCommentDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (newCommentDraft.trim()) {
                          setPendingComments((prev) => [...prev, newCommentDraft.trim()]);
                          setNewCommentDraft("");
                        }
                      }
                    }}
                    placeholder="히스토리를 입력하세요... (Enter로 추가)"
                    rows={2}
                    className="flex-1 px-3 py-2 text-[16px] sm:text-[13px] border border-wedly-bd rounded-lg resize-none outline-none focus:ring-2 focus:ring-wedly-accent/20 focus:border-wedly-accent"
                  />
                  <button
                    onClick={() => {
                      if (newCommentDraft.trim()) {
                        setPendingComments((prev) => [...prev, newCommentDraft.trim()]);
                        setNewCommentDraft("");
                      }
                    }}
                    disabled={!newCommentDraft.trim()}
                    className="self-end px-3 py-2 text-[13px] font-medium text-white bg-wedly-accent rounded-lg hover:bg-wedly-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    추가
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* History panel — live (existing entries) — 기본 패널은 panelId 없는 카테고리만 노출.
              옛 기본 카테고리(정책자금/무상지원금/인증제도) 는 HistoryPanel 안 fallback 이 항상 자동 노출 — hiddenHistoryCategoryIds 로 숨김 가능. */}
          {activePanel === "history" && !isNew && pageId && (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              {renderHistoryPanel({
                pageId,
                isAdmin,
                onCountChange: (count) => {
                  onCommentCount?.(pageId, count);
                  setPanelCommentCounts((prev) => prev["default"] === count ? prev : { ...prev, default: count });
                },
                focusCommentId,
                onFocusHandled,
                categories: historyCategories?.filter((c) => !c.panelId),
                hiddenFallbackIds: hiddenHistoryCategoryIds,
                onHideFallback: onHideHistoryCategory,
                onUnhideFallback: onUnhideHistoryCategory,
                onRenameCategory: onRenameHistoryCategory,
                onReorderCategories: onReorderHistoryCategories,
                onAddCategory: onAddHistoryCategory ? () => setShowAddHistoryCategoryModal(true) : undefined,
                onDeleteCategory: onDeleteHistoryCategory ? async (catId) => {
                  const cat = historyCategories?.find((c) => c.id === catId);
                  const ok = await dialog.confirm(
                    `"${cat?.label || catId}" 히스토리 카테고리를 삭제하시겠습니까? 이 카테고리로 작성된 옛 글은 그대로 남고 "통합" 탭에서 계속 볼 수 있습니다.`,
                    { title: "카테고리 삭제", danger: true }
                  );
                  if (ok) onDeleteHistoryCategory(catId);
                } : undefined,
              })}
            </div>
          )}
          {/* 사용자 정의 상위 패널 본문 — memo / embed 우선 지원, 나머지 종류는 placeholder */}
          {customPanels.map((p) => {
            if (activePanel !== p.id) return null;
            if (p.kind === "memo") {
              const memoKey = `_panel_memo_${p.id}`;
              const current = (localRow[memoKey] as string | undefined) ?? memoDraft[p.id] ?? "";
              return (
                <div key={p.id} className="flex-1 min-w-0 min-h-0 flex flex-col p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-wedly-navy">{p.label}</h3>
                    <span className="text-[10px] text-wedly-muted">자동 저장</span>
                  </div>
                  <textarea
                    value={current}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMemoDraft((prev) => ({ ...prev, [p.id]: v }));
                    }}
                    onBlur={() => {
                      const v = memoDraft[p.id];
                      if (typeof v === "string" && v !== ((localRow[memoKey] as string | undefined) ?? "")) {
                        handleFieldSave(memoKey, v);
                      }
                    }}
                    placeholder="자유롭게 메모를 적어 주세요."
                    className="flex-1 min-h-[200px] w-full px-3 py-2 text-[15px] sm:text-[13px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent resize-none"
                  />
                </div>
              );
            }
            if (p.kind === "embed") {
              // 신뢰 호스트 화이트리스트 — 로그인 쿠키가 필요한 SaaS 만 allow-same-origin 부여.
              // 그 외 외부 사이트는 sandbox 를 강하게 — 사용자 쿠키 노출·DOM 접근 차단.
              // code-reviewer 지적 (MEDIUM-HIGH): allow-same-origin + allow-scripts 동시 = sandbox 무력화.
              const TRUSTED_HOSTS = new Set([
                "notion.so", "www.notion.so",
                "docs.google.com", "drive.google.com", "sheets.google.com",
                "airtable.com", "www.airtable.com",
              ]);
              let host = "";
              let isTrusted = false;
              try {
                if (p.embedUrl) {
                  const u = new URL(p.embedUrl);
                  host = u.hostname;
                  // 정확 일치 또는 .notion.so 같은 서브도메인 매칭
                  isTrusted = TRUSTED_HOSTS.has(host)
                    || Array.from(TRUSTED_HOSTS).some((h) => host.endsWith("." + h));
                }
              } catch { /* invalid url */ }
              // 화이트리스트만 allow-same-origin. 그 외는 강 sandbox.
              const sandboxAttr = isTrusted
                ? "allow-same-origin allow-scripts allow-popups allow-forms"
                : "allow-scripts allow-popups allow-forms";
              return (
                <div key={p.id} className="flex-1 min-w-0 min-h-0 flex flex-col p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-[13px] font-semibold text-wedly-navy truncate">{p.label}</h3>
                      {host && (
                        <span className={cn(
                          "text-[10px] font-mono px-1.5 py-0.5 rounded truncate",
                          isTrusted
                            ? "text-wedly-green bg-wedly-bg-green/40 border border-wedly-bd-green"
                            : "text-wedly-orange bg-wedly-bg-yellow/40 border border-wedly-orange/30"
                        )} title={isTrusted ? "신뢰 호스트 — 로그인 유지" : "외부 호스트 — 로그인 안 됨, 사용자 정보 보호 모드"}>
                          {host}
                        </span>
                      )}
                    </div>
                    {p.embedUrl && (
                      <a
                        href={p.embedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-wedly-accent hover:underline whitespace-nowrap flex-shrink-0"
                        title="새 탭에서 열기"
                      >
                        새 창 열기 ↗
                      </a>
                    )}
                  </div>
                  {p.embedUrl ? (
                    <iframe
                      key={p.embedUrl}
                      src={p.embedUrl}
                      title={p.label}
                      sandbox={sandboxAttr}
                      referrerPolicy="no-referrer"
                      className="flex-1 w-full rounded-xl border border-wedly-bd bg-white"
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[12px] text-wedly-muted">
                      외부 페이지 주소가 없습니다.
                    </div>
                  )}
                </div>
              );
            }
            // fields 종류는 properties 패널 본문이 그대로 렌더됨 (위 분기에서 처리) → 여기선 안 그림.
            if (p.kind === "fields") return null;
            // history 종류 — 별도 HistoryPanel 인스턴스. 코멘트는 같은 사업장 안 같은 묶음을 보지만,
            // 카테고리는 패널마다 별도. 패널 id 를 categories 의 namespace 로 활용해도 좋고
            // 우선은 기본 카테고리 그대로 사용 — 다음 단계에서 패널별 카테고리 분리 지원 예정.
            if (p.kind === "history" && !isNew && pageId) {
              return (
                <div key={p.id} className="flex-1 min-w-0 min-h-0 flex flex-col">
                  {renderHistoryPanel({
                    pageId,
                    isAdmin,
                    scopePanelId: p.id,
                    onCountChange: (count) => {
                      setPanelCommentCounts((prev) => prev[p.id] === count ? prev : { ...prev, [p.id]: count });
                    },
                    focusCommentId: undefined,
                    onFocusHandled: undefined,
                    // 이 패널 소속 카테고리만 노출
                    categories: historyCategories?.filter((c) => c.panelId === p.id),
                    hiddenFallbackIds: hiddenHistoryCategoryIds,
                    onHideFallback: onHideHistoryCategory,
                    onUnhideFallback: onUnhideHistoryCategory,
                    onRenameCategory: onRenameHistoryCategory,
                    onReorderCategories: onReorderHistoryCategories,
                    onAddCategory: onAddHistoryCategory ? () => setShowAddHistoryCategoryModal(true) : undefined,
                    onDeleteCategory: onDeleteHistoryCategory ? async (catId) => {
                      const cat = historyCategories?.find((c) => c.id === catId);
                      const ok = await dialog.confirm(
                        `"${cat?.label || catId}" 히스토리 카테고리를 삭제하시겠습니까? 이 카테고리로 작성된 옛 글은 그대로 남고 "통합" 탭에서 계속 볼 수 있습니다.`,
                        { title: "카테고리 삭제", danger: true }
                      );
                      if (ok) onDeleteHistoryCategory(catId);
                    } : undefined,
                  })}
                </div>
              );
            }
            if (p.kind === "history" && isNew) {
              return (
                <div key={p.id} className="flex-1 min-w-0 min-h-0 flex items-center justify-center px-4">
                  <p className="text-[12px] text-wedly-muted">사업장을 먼저 저장하면 히스토리를 쓸 수 있습니다.</p>
                </div>
              );
            }
            // files 종류 — 패널 id 를 파일 카테고리로 사용. 그 카테고리에 속한 파일만 노출 + 업로드 시 자동 분류.
            if (p.kind === "files") {
              const panelCategory = `panel_${p.id}`;
              return (
                <div key={p.id} className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-4">
                  <FilesTab
                    files={files}
                    pageId={pageId || ""}
                    onFilesChange={(next) => handleFilesUpdate(next)}
                    filterCategory={panelCategory}
                    defaultUploadCategory={panelCategory}
                    uploadButtonLabel={`${p.label} 업로드`}
                    emptyMessage={`'${p.label}' 패널에 첨부된 파일이 없습니다`}
                    disabled={isNew}
                    downloadApiPath={dataSource.fileDownloadPath ?? "/api/files/download"}
                    onOpenFile={handleOpenFile}
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* 어드민 — 섹션에 컬럼 추가 모달 (위들리 디자인) */}
      {addColumnModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setAddColumnModal(null)} />
          {/* ⚠️ overflow-hidden 제거 — 내부 CustomSelect 드롭다운이 모달 밖으로 펼쳐질 수 있어야 함 */}
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">새 컬럼 추가</h3>
              <p className="mt-1 text-[11px] text-wedly-muted">테이블·상세모달 양쪽에 즉시 표시됩니다.</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">컬럼 이름</span>
                <input
                  type="text"
                  autoFocus
                  value={draftAddLabel}
                  onChange={(e) => setDraftAddLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draftAddLabel.trim()) {
                      const colKey = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                      const label = draftAddLabel.trim();
                      const targetId = draftAddSectionId || addColumnModal.sectionId;
                      onAddColumnToSection?.({ key: colKey, label, type: draftAddType }, targetId);
                      // 새 컬럼이라 라벨·새 컬럼 표시 함께 보내야 알림이 키 노출·옛 값 이동 안내 안 띄움.
                      moveColumnToSection(colKey, targetId, { skipConfirm: true, fieldLabel: label, isNewColumn: true });
                      setAddColumnModal(null);
                    }
                    if (e.key === "Escape") setAddColumnModal(null);
                  }}
                  className="mt-1 block w-full px-3 py-2 text-[16px] sm:text-[13px] min-h-[44px] sm:min-h-[36px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent hover:border-wedly-accent/50 transition-colors"
                  placeholder="예: 담당 사무장"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">데이터 형식</span>
                <div className="mt-1">
                  <CustomSelect
                    value={draftAddType}
                    onChange={(v) => setDraftAddType(v as ShellFieldDef["type"])}
                    options={[
                      { value: "text", label: "텍스트" },
                      { value: "number", label: "숫자" },
                      { value: "date", label: "날짜" },
                      { value: "select", label: "선택" },
                      { value: "multi_select", label: "다중 선택" },
                      { value: "checkbox", label: "체크박스" },
                      { value: "person", label: "사람 (앱 사용자 중 선택)" },
                      { value: "email", label: "이메일" },
                      { value: "phone_number", label: "전화번호" },
                      { value: "file", label: "첨부파일" },
                    ]}
                  />
                </div>
              </label>
              {/* 어느 섹션에 추가할지 — 차수 카드/일반 섹션 모두 선택 가능. */}
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">어느 섹션에 추가</span>
                <div className="mt-1">
                  <CustomSelect
                    value={draftAddSectionId}
                    onChange={(v) => setDraftAddSectionId(v)}
                    options={effectiveSections
                      .filter((s) => {
                        // memo/embed 같은 비-fields 패널 자식이거나 file/meetings/settlement 종류는 새 컬럼 대상이 안 됨.
                        if (s.id === "other") return true;
                        if (!s.kind || s.kind === "fields") return true;
                        if (s.kind === "tiered-contract" || s.kind === "tiered-refund") return true;
                        return false;
                      })
                      .map((s) => ({
                        value: s.id,
                        label: s.kind === "tiered-contract" || s.kind === "tiered-refund"
                          ? `${s.label} (차수 카드)`
                          : s.label,
                      }))}
                  />
                </div>
                {(() => {
                  const sel = effectiveSections.find((s) => s.id === draftAddSectionId);
                  if (sel && (sel.kind === "tiered-contract" || sel.kind === "tiered-refund")) {
                    return (
                      <p className="mt-1.5 text-[11px] text-wedly-orange bg-wedly-bg-yellow/40 border border-wedly-orange/30 rounded p-2">
                        차수 카드 섹션입니다 — 모든 차수 카드에 이 칸이 추가됩니다.
                      </p>
                    );
                  }
                  return null;
                })()}
              </label>
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAddColumnModal(null)} className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors">취소</button>
              <button
                type="button"
                onClick={() => {
                  const label = draftAddLabel.trim();
                  if (!label || !addColumnModal) return;
                  const colKey = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const targetId = draftAddSectionId || addColumnModal.sectionId;
                  onAddColumnToSection?.({ key: colKey, label, type: draftAddType }, targetId);
                  // 어드민이 모달 안에서 명시적으로 섹션을 선택했으니 차수 카드 이동 확인 모달 생략.
                  // 새 컬럼이라 라벨 명시 전달 → 알림에 내부 키 노출 방지. isNewColumn=true → "옮길 값 없음" 메시지 차단.
                  moveColumnToSection(colKey, targetId, { skipConfirm: true, fieldLabel: label, isNewColumn: true });
                  setAddColumnModal(null);
                }}
                disabled={!draftAddLabel.trim()}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 어드민 — 숨김 컬럼 복원 모달 */}
      {showHiddenColumnsModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowHiddenColumnsModal(false)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">숨긴 컬럼 복원</h3>
              <p className="mt-1 text-[11px] text-wedly-muted">살릴 컬럼을 하나씩 골라 누르세요.</p>
            </div>
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
              {(() => {
                const visibleKeys = unhidableColumnKeys && unhidableColumnKeys.length > 0
                  ? unhidableColumnKeys
                  : disabledColumns;
                if (visibleKeys.length === 0) {
                  return (
                    <div className="rounded-xl border border-dashed border-wedly-bd p-6 text-center text-[13px] text-wedly-muted">
                      지금 상세 모달에서 숨긴 컬럼이 없습니다.
                    </div>
                  );
                }
                return (
                <ul className="space-y-1.5">
                  {visibleKeys.map((key) => {
                    // 컬럼 라벨 — hiveFieldMap 에서 찾고, 없으면 키 자체 표시
                    const def = hiveFieldMap.get(key);
                    const label = def?.label || key;
                    return (
                      <li key={key} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-wedly-bd bg-white hover:border-wedly-accent/40 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-wedly-t1 truncate">{label}</div>
                          {label !== key && <div className="text-[10px] text-wedly-muted truncate">키: {key}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (onUnhideColumn) onUnhideColumn(key);
                          }}
                          className="px-3 py-2 text-[14px] sm:text-[12px] min-h-[40px] sm:min-h-[30px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors flex-shrink-0"
                        >
                          살리기
                        </button>
                      </li>
                    );
                  })}
                </ul>
                );
              })()}
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end">
              <button
                onClick={() => setShowHiddenColumnsModal(false)}
                className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 어드민 — 새 섹션 추가 모달 */}
      <SectionEditorAddModal
        open={showAddSectionModal}
        existingIds={effectiveSections.map((s) => s.id)}
        onClose={() => setShowAddSectionModal(false)}
        onConfirm={(payload) => {
          // 현재 활성 패널이 사용자 정의 fields 패널이면 그 panelId 로 저장 → 그 패널 안에만 노출.
          const activePanelObj = customPanels.find((p) => p.id === activePanel);
          const targetPanelId = activePanelObj?.kind === "fields" ? activePanel : "properties";
          onAddSection?.({ id: payload.id, label: payload.label, kind: payload.kind, panelId: targetPanelId });
          setShowAddSectionModal(false);
        }}
      />

      {/* 어드민 — 이 섹션 삭제 확인 모달.
          순서: 안 컬럼들을 모두 "기타" 로 이동 성공 후에만 섹션 자체 삭제.
          (code-reviewer 지적: 부분 실패 시 옛 컬럼이 매핑만 옮긴 채 섹션은 사라지는 사고 방지) */}
      <SectionEditorDeleteConfirm
        open={showDeleteSectionConfirm}
        sectionLabel={activeSection?.label || activeTab}
        hasContent={!!(activeSection?.fieldKeys && activeSection.fieldKeys.length > 0)}
        otherSectionHidden={!showOtherSection}
        onClose={() => setShowDeleteSectionConfirm(false)}
        onConfirm={async () => {
          const deletedTab = activeTab;
          // 1) 안 컬럼들을 모두 "기타" 로 이동 — 모두 성공해야 다음 단계 진행
          if (activeSection?.fieldKeys && activeSection.fieldKeys.length > 0) {
            try {
              await Promise.all(activeSection.fieldKeys.map((k) => moveColumnToSection(k, "other")));
            } catch {
              // 이동 실패 — 섹션 삭제 중단. 어드민이 다시 시도하면 됨.
              setShowDeleteSectionConfirm(false);
              return;
            }
          }
          // 2) 이동 모두 성공 → 섹션 자체 삭제
          onDeleteSection?.(deletedTab);
          setShowDeleteSectionConfirm(false);
          // 3) 활성 탭이 사라지므로 첫 번째 가용 탭으로 전환.
          // effectiveSections 는 같은 렌더 사이클의 옛 메모이즈 값이지만, 현재 탭 id 를 명시 필터링하므로 안전.
          const remaining = effectiveSections.filter((s) => s.id !== deletedTab);
          if (remaining.length > 0) setActiveTab(remaining[0].id);
        }}
      />

      {/* 어드민 — 상위 패널 관리 모달 (추가/이름수정/삭제 통합) */}
      <PanelManagerModal
        open={showPanelManagerModal}
        customPanels={customPanels}
        builtinPanels={[
          { id: "properties", label: "상세 정보" },
          { id: "history", label: "히스토리" },
          { id: "files", label: "파일" },
        ]}
        onClose={() => setShowPanelManagerModal(false)}
        onRequestAdd={() => {
          setShowPanelManagerModal(false);
          setShowAddPanelModal(true);
        }}
        onRename={(panelId, newLabel) => onRenameCustomPanel?.(panelId, newLabel)}
        onDelete={async (panelId) => {
          const p = customPanels.find((x) => x.id === panelId);
          if (!p) return;
          const ok = await dialog.confirm(
            `"${p.label}" 패널을 삭제하시겠습니까?${p.kind === "memo" ? " 안 메모도 함께 사라집니다." : ""}`,
            { title: "패널 삭제", danger: true }
          );
          if (ok) {
            // memo 종류는 현재 사업장의 메모 키도 함께 비움 (잔재 정리).
            if (p.kind === "memo") {
              const memoKey = `_panel_memo_${p.id}`;
              const cur = (localRow?.[memoKey] as string | undefined) ?? "";
              if (cur) handleFieldSave(memoKey, "");
              setMemoDraft((prev) => {
                if (!(p.id in prev)) return prev;
                const next = { ...prev };
                delete next[p.id];
                return next;
              });
            }
            onDeleteCustomPanel?.(panelId);
            if (activePanel === panelId) setActivePanel("properties");
          }
        }}
      />

      {/* 어드민 — 새 상위 패널 추가 모달 */}
      <PanelEditorAddModal
        open={showAddPanelModal}
        existingIds={[...customPanels.map((p) => p.id), "properties", "history", "files"]}
        onClose={() => setShowAddPanelModal(false)}
        onConfirm={(payload) => {
          onAddCustomPanel?.(payload);
          setShowAddPanelModal(false);
          setActivePanel(payload.id); // 새 패널을 즉시 활성화
        }}
      />

      {/* 어드민 — 새 히스토리 카테고리 추가 모달 */}
      {showAddHistoryCategoryModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowAddHistoryCategoryModal(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">새 히스토리 카테고리</h3>
              <p className="mt-1 text-[12px] text-wedly-muted">히스토리 패널의 새 카테고리 탭을 만듭니다.</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-wedly-t2 mb-1.5">이름</label>
                <input
                  type="text"
                  value={newCategoryLabel}
                  onChange={(e) => setNewCategoryLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const trimmed = newCategoryLabel.trim();
                      if (trimmed) {
                        const id = `hcat-${Date.now().toString(36).slice(-4)}-${Math.floor(Math.random() * 1000).toString(36)}`;
                        // 활성 패널이 사용자 정의 history 면 그 패널 id 를 panelId 로 동봉 → 그 패널에만 노출.
                        const activeHistoryPanel = customPanels.find((p) => p.id === activePanel && p.kind === "history");
                        onAddHistoryCategory?.({ id, label: trimmed, color: newCategoryColor, ...(activeHistoryPanel ? { panelId: activeHistoryPanel.id } : {}) });
                        setShowAddHistoryCategoryModal(false);
                        setNewCategoryLabel("");
                      }
                    }
                    if (e.key === "Escape") setShowAddHistoryCategoryModal(false);
                  }}
                  placeholder="예: 세무신고 / 자금조달"
                  autoFocus
                  className="w-full px-3 py-2 text-[16px] sm:text-[13px] min-h-[44px] sm:min-h-[36px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 placeholder:text-wedly-muted focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-wedly-t2 mb-1.5">색상</label>
                <div className="flex flex-wrap gap-1.5">
                  {(["blue","green","purple","orange","red","gold","gray"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewCategoryColor(c)}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition",
                        CATEGORY_COLOR_CLASS[c],
                        newCategoryColor === c ? "ring-2 ring-wedly-accent ring-offset-1" : "opacity-60 hover:opacity-100"
                      )}
                      title={c}
                    >
                      샘플
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddHistoryCategoryModal(false)}
                className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const trimmed = newCategoryLabel.trim();
                  if (!trimmed) return;
                  const id = `hcat-${Date.now().toString(36).slice(-4)}-${Math.floor(Math.random() * 1000).toString(36)}`;
                  // 활성 패널이 사용자 정의 history 면 panelId 동봉
                  const activeHistoryPanel = customPanels.find((p) => p.id === activePanel && p.kind === "history");
                  onAddHistoryCategory?.({ id, label: trimmed, color: newCategoryColor, ...(activeHistoryPanel ? { panelId: activeHistoryPanel.id } : {}) });
                  setShowAddHistoryCategoryModal(false);
                  setNewCategoryLabel("");
                }}
                disabled={!newCategoryLabel.trim()}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors disabled:opacity-50"
              >
                만들기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 어드민 — 데이터 형식 변경 모달 (사용자 정의 컬럼만 대상) */}
      {changeTypeModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setChangeTypeModal(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-wedly-bd animate-modal-in">
            <div className="px-5 pt-5 pb-3 border-b border-wedly-bd/60">
              <h3 className="text-[15px] font-bold text-wedly-navy">
                데이터 형식 변경 — {changeTypeModal.label}
              </h3>
              <p className="mt-1 text-[11px] text-wedly-muted">
                값은 그대로 유지되며 표시·편집 방식만 바뀝니다.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold text-wedly-t2">새 데이터 형식</span>
                <div className="mt-1">
                  <CustomSelect
                    value={draftChangeType}
                    onChange={(v) => setDraftChangeType(v as ShellFieldDef["type"])}
                    options={[
                      { value: "text", label: "텍스트" },
                      { value: "number", label: "숫자" },
                      { value: "date", label: "날짜" },
                      { value: "select", label: "선택" },
                      { value: "multi_select", label: "다중 선택" },
                      { value: "checkbox", label: "체크박스" },
                      { value: "person", label: "사람 (앱 사용자 중 선택)" },
                      { value: "email", label: "이메일" },
                      { value: "phone_number", label: "전화번호" },
                      { value: "file", label: "첨부파일" },
                      { value: "formula", label: "수식 (자동 계산)" },
                    ]}
                  />
                </div>
              </label>

              {/* 수식 형식 선택 시 — 참조 컬럼 + 연산자 + 숫자 입력 */}
              {draftChangeType === "formula" && (
                <div className="space-y-2 border border-wedly-accent/30 rounded-lg p-3 bg-wedly-bg-blue/20">
                  <p className="text-[12px] font-medium text-wedly-accent">
                    수식 설정 — 다른 컬럼 값을 기준으로 자동 계산
                  </p>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-wedly-t2">참조 컬럼</span>
                    <div className="mt-1">
                      <CustomSelect
                        value={draftFormulaRefKey}
                        onChange={(v) => setDraftFormulaRefKey(v)}
                        options={[
                          { value: "", label: "선택하세요" },
                          ...Array.from(hiveFieldMap.values())
                            .filter((f) => f.key !== changeTypeModal.key && (f.type === "number" || f.type === "text"))
                            .map((f) => ({ value: f.key, label: f.label })),
                        ]}
                      />
                    </div>
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="flex-1">
                      <span className="text-[11px] font-semibold text-wedly-t2">연산</span>
                      <div className="mt-1">
                        <CustomSelect
                          value={draftFormulaOp}
                          onChange={(v) => setDraftFormulaOp(v as "*" | "+" | "-" | "/")}
                          options={[
                            { value: "*", label: "× (곱하기)" },
                            { value: "+", label: "+ (더하기)" },
                            { value: "-", label: "− (빼기)" },
                            { value: "/", label: "÷ (나누기)" },
                          ]}
                        />
                      </div>
                    </label>
                    <label className="flex-1">
                      <span className="text-[11px] font-semibold text-wedly-t2">숫자</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draftFormulaOperand}
                        onChange={(e) => setDraftFormulaOperand(e.target.value)}
                        placeholder="0.3"
                        className="mt-1 block w-full px-3 py-2 text-[16px] sm:text-[13px] min-h-[40px] sm:min-h-[34px] border border-wedly-bd rounded-lg bg-white text-wedly-t1 focus:outline-none focus:ring-2 focus:ring-wedly-accent/30 focus:border-wedly-accent"
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-wedly-muted leading-relaxed">
                    💡 비율은 소수로 입력 — 예: 30% 는 0.3. <br />
                    예: 예상수수료 × 0.3 → 예상매출이익 자동 계산
                  </p>
                </div>
              )}

              <p className="text-[11px] text-wedly-muted leading-relaxed">
                현재 형식: <span className="font-medium text-wedly-t2">{(() => {
                  const labelMap: Record<string, string> = {
                    text: "텍스트", number: "숫자", date: "날짜",
                    select: "선택", multi_select: "다중 선택", checkbox: "체크박스",
                    person: "사람", email: "이메일", phone_number: "전화번호",
                    formula: "수식 (자동 계산)",
                  };
                  return labelMap[changeTypeModal.currentType] || changeTypeModal.currentType;
                })()}</span>
              </p>
              {/* 사용자 안내 — 호환성 + 옵션 채우기 동선 */}
              {(draftChangeType === "select" || draftChangeType === "multi_select") && (
                <div className="px-3 py-2 rounded-lg bg-wedly-bg-blue/40 border border-wedly-accent/30">
                  <p className="text-[11px] text-wedly-t2 leading-relaxed">
                    💡 "선택" 형식으로 바꾼 뒤, 해당 컬럼의 셀을 클릭하면 "검색 또는 새 옵션 추가" 입력칸에서
                    원하는 옵션을 직접 추가할 수 있습니다.
                  </p>
                </div>
              )}
              {(draftChangeType === "number" || draftChangeType === "date" || draftChangeType === "email" || draftChangeType === "phone_number") && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-[11px] text-wedly-t2 leading-relaxed">
                    ⚠️ 기존 값이 새 형식과 안 맞으면 표시가 깨질 수 있습니다.
                    (예: 텍스트 "abc" → 숫자 형식 변경 시 셀이 비어 보일 수 있음)
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-wedly-bg-gray/50 border-t border-wedly-bd/60 flex items-center justify-end gap-2">
              <button
                onClick={() => setChangeTypeModal(null)}
                className="px-4 py-2 text-[13px] font-medium text-wedly-t2 bg-white border border-wedly-bd rounded-lg hover:bg-wedly-bg-gray transition-colors"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (!changeTypeModal || !onChangeColumnType) return;
                  // 수식 형식이면 세부 정보 확인 후 함께 전달
                  if (draftChangeType === "formula") {
                    const operand = Number(draftFormulaOperand);
                    if (!draftFormulaRefKey) {
                      await dialog.alert("참조할 컬럼을 선택해주세요.", { title: "입력 확인" });
                      return;
                    }
                    if (Number.isNaN(operand) || !Number.isFinite(operand)) {
                      await dialog.alert("숫자를 올바르게 입력해주세요. (예: 0.3)", { title: "입력 확인" });
                      return;
                    }
                    onChangeColumnType(changeTypeModal.key, "formula", {
                      refKey: draftFormulaRefKey,
                      op: draftFormulaOp,
                      operand,
                    });
                  } else {
                    onChangeColumnType(changeTypeModal.key, draftChangeType);
                  }
                  setChangeTypeModal(null);
                }}
                disabled={(() => {
                  if (!changeTypeModal) return true;
                  // 수식이면 참조 컬럼·숫자 검증
                  if (draftChangeType === "formula") {
                    return !draftFormulaRefKey || Number.isNaN(Number(draftFormulaOperand));
                  }
                  // 형식이 그대로면 비활성
                  return draftChangeType === changeTypeModal.currentType;
                })()}
                className="px-4 py-2 text-[13px] font-bold text-white bg-wedly-accent rounded-lg hover:brightness-110 transition-colors disabled:bg-wedly-bg-gray disabled:text-wedly-muted disabled:cursor-not-allowed"
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
