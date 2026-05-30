// 상세창 공용 틀 — "설정 약속"(앱이 넘겨주는 입력값) 정의.
//
// 목표: 하이브·일루아·ERP 가 이 한 틀을 같이 쓰고, 앱마다 다른 것은
//   ① 컬럼 이름(fields) ② 컬럼 순서·위치(sections) ③ 켤 탭 선택 ④ 앱별 서버 연결(dataSource·renderHistoryPanel)
// 뿐이 되게 한다. 틀(겉 모양·탭 배치·동작)은 100% 공용.
//
// 이 파일은 "약속(타입)"만 정의한다. 실제 틀 본체(DetailModalShell)는 별도 파일에서
// 이 타입을 받아 동작한다. 아직 어느 앱에도 연결되지 않은 신규 추가물이라 운영 위험이 없다.
//
// 설계 근거: 하이브 현재 DetailModal 의 입력값(약 40개)을 그대로 따르고, 지금까지
// 하이브 안에 "박혀 있던" 4가지만 입력값으로 추가로 빼낸다.

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// 1) 기본 데이터 형태
// ---------------------------------------------------------------------------

/** 한 행(업체 1건)의 값 모음. 키=컬럼키, 값=문자열/숫자/불리언/빈값. */
export type ShellRowData = Record<string, string | number | boolean | null>;

/** 한 컬럼(필드) 정의 — 앱이 넘겨주는 "컬럼 이름·형식". (앱별로 다른 부분) */
export type ShellFieldDef = {
  key: string;
  label: string;
  /** text/number/date/select/multi_select/person/email/phone_number/file/last_edited_time 등 공통 형식 이름 */
  type: string;
  format?: "currency";
};

/** 한 섹션(탭) 정의 — 순서·위치·종류. 하이브의 ErpDetailSection 과 동일 형태.
 *  fieldKeys = 그 섹션에 놓일 컬럼들의 "위치(순서 포함)". (앱별로 다른 부분) */
export type ShellSection = {
  id: string;
  label: string;
  /** fields | settlement | meetings | files | tiered-contract | tiered-refund */
  kind?: string;
  fieldKeys?: string[];
  removable?: boolean;
  /** 어느 상위 패널 소속인지. 미지정 시 기본 "properties" 패널. */
  panelId?: string;
};

/** 상위 패널(상세정보/히스토리/파일 + 어드민이 추가한 사용자 정의 패널) */
export type ShellPanel = {
  id: string;
  label: string;
  kind: "memo" | "embed" | "fields" | "history" | "files";
  embedUrl?: string;
};

// ---------------------------------------------------------------------------
// 2) 앱별 서버 연결 — 앱마다 주소가 달라 "함수"로 주입한다.
//    틀은 이 함수들만 부른다. (어느 서버에 어떻게 저장하는지는 앱이 책임)
// ---------------------------------------------------------------------------

export type ShellDataSource = {
  /** 한 칸 값 저장. (기존 onUpdate 역할 — 행 1건의 한 컬럼을 서버에 반영) */
  patchField: (pageId: string, key: string, value: string | number | boolean | null) => void | Promise<void>;
  /** 신규 행 생성. 미지정 시 "신규 등록" 동작 숨김. */
  createRow?: (newRow: ShellRowData) => void | Promise<void>;
  /** 파일 업로드 → 저장된 접근 주소(url) 반환. 미지정 시 업로드 비활성. */
  uploadFile?: (file: File) => Promise<{ url: string } | null>;
  /** 파일 다운로드 경로(앞부분). 예: "/api/files/download" */
  fileDownloadPath?: string;
  /** 차수 카드(차수별 계약·환불·정산) 묶음 읽기/쓰기. prefix = "contract"|"refund"|"settlement" */
  readTieredFields?: (prefix: string) => Promise<unknown>;
  writeTieredFields?: (prefix: string, value: unknown) => Promise<void>;
  /** 컬럼-섹션 위치 매핑 읽기/쓰기 — 어드민이 "컬럼을 어느 섹션에" 둘지 바꿀 때.
   *  scope = 페이지 구분 키(예: "tax-amendment"). */
  readSectionMapping?: (scope: string) => Promise<Record<string, string>>;
  writeSectionMapping?: (scope: string, columnKey: string, sectionId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// 3) 댓글·이력 패널 — 앱마다 저장소(노션/자체DB/REST)가 완전히 달라
//    틀이 직접 만들지 않고, 앱이 만든 패널을 통째로 넘겨받아(render-prop) 그 자리에 끼운다.
//    → 틀(겉)은 같게, 댓글 저장 방식은 앱별로.
// ---------------------------------------------------------------------------

export type ShellHistoryRenderArgs = {
  pageId: string;
  isAdmin: boolean;
  focusCommentId?: string;
  onFocusHandled?: () => void;
  /** 댓글 개수 변동을 바깥(목록 배지 등)에 알릴 때 */
  onCommentCount?: (pageId: string, count: number) => void;
};
export type RenderHistoryPanel = (args: ShellHistoryRenderArgs) => ReactNode;

// ---------------------------------------------------------------------------
// 4) 앱별 보조 부품 — 사람(담당자) 후보 명단, 확인/알림창.
//    앱마다 출처가 달라 주입. (틀의 드롭다운·확인창은 공용 위들리 부품 사용)
// ---------------------------------------------------------------------------

/** 담당자(person) 칸 후보 명단 — 팀장 칸엔 팀장 후보, 팀원 칸엔 팀원 후보, 그 외 전체. */
export type ShellUserDirectory = { all: string[]; leaders: string[]; members: string[] };

/** 위들리 디자인 확인/알림창 — 브라우저 기본 창(confirm/alert) 금지 규칙 준수용. */
export type ShellDialog = {
  confirm: (opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  alert?: (opts: { title: string; message?: string }) => Promise<void> | void;
};

// ---------------------------------------------------------------------------
// 5) 공용 틀이 받는 전체 입력값 = 기존 하이브 입력값 + 새로 빼낸 4가지(+보조).
//    (어드민 동작 콜백들은 하이브가 이미 입력값으로 받고 있던 것 — 이름 그대로 유지해
//     나중에 하이브를 갈아끼울 때 1:1 로 맞춘다.)
// ---------------------------------------------------------------------------

export type SharedDetailModalProps = {
  // ── 핵심 데이터 ──
  row: ShellRowData | null;
  onClose: () => void;

  // ── 새로 빼낸 4가지(앱별) ──
  /** ① 컬럼 정의(이름·형식) — 예전 하이브의 CONTRACT_FIELDS 가 입력값이 됨. */
  fields: ShellFieldDef[];
  /** ② 권한 — 예전엔 useAccess() 직접 호출. 이제 앱이 넘겨줌. */
  isAdmin: boolean;
  /** ③ 앱별 서버 연결. */
  dataSource: ShellDataSource;
  /** ④ 댓글·이력 패널(앱이 만든 것을 끼움). */
  renderHistoryPanel: RenderHistoryPanel;

  // ── 보조 주입 ──
  userDirectory?: ShellUserDirectory;
  dialog?: ShellDialog;

  // ── 섹션·패널(위치/순서/켤 탭) ──
  sections?: ShellSection[];
  sectionOrder?: string[];
  customPanels?: ShellPanel[];
  /** 컬럼 순서·섹션매핑 저장 구분 키. 기본 "tax-amendment". */
  scope?: string;
  /** "기타" 섹션 노출 여부(기본 숨김). */
  showOtherSection?: boolean;

  // ── 행 단위 동작 ──
  onCreate?: (newRow: ShellRowData) => void;
  initialPanel?: "properties" | "history";
  focusCommentId?: string;
  onFocusHandled?: () => void;
  onCommentCount?: (pageId: string, count: number) => void;

  // ── 어드민: 컬럼 숨김/삭제/형식/이름 ──
  disabledColumns?: string[];
  unhidableColumnKeys?: string[];
  onHideColumn?: (key: string) => void;
  onUnhideColumn?: (key: string) => void;
  onDeleteColumn?: (key: string) => void;
  isCustomColumn?: (key: string) => boolean;
  /** 어드민이 테이블에 추가한 사용자 정의 컬럼 — 형식 정보 보강용. (앱별 컬럼 타입 그대로 전달) */
  customColumns?: ShellFieldDef[];
  onAddColumnToSection?: (column: { key: string; label: string; type: string }, sectionId: string) => void;
  onChangeColumnType?: (key: string, newType: string, formula?: unknown) => void;
  onRenameColumn?: (key: string, newLabel: string) => void;

  // ── 어드민: 섹션 추가/삭제/순서 ──
  onAddSection?: (payload: { id: string; label: string; kind: string; panelId?: string }) => void;
  onDeleteSection?: (sectionId: string) => void;
  customSectionIds?: string[];
  onReorderSections?: (nextOrder: string[]) => void;
  onToggleOtherSection?: () => void;

  // ── 어드민: 미팅 차수 카드 컬럼명 ──
  meetingFieldLabels?: { datetime: string; assignee: string; memo: string };
  onChangeMeetingLabels?: (next: { datetime: string; assignee: string; memo: string }) => void;

  // ── 어드민: 히스토리 카테고리 ──
  historyCategories?: Array<{ id: string; label: string; color?: string; panelId?: string }>;
  onAddHistoryCategory?: (payload: { id: string; label: string; color?: string; panelId?: string }) => void;
  onDeleteHistoryCategory?: (categoryId: string) => void;
  hiddenHistoryCategoryIds?: string[];
  onHideHistoryCategory?: (categoryId: string) => void;
  onUnhideHistoryCategory?: (categoryId: string) => void;
  onRenameHistoryCategory?: (categoryId: string, newLabel: string) => void;
  onReorderHistoryCategories?: (nextOrder: string[]) => void;

  // ── 어드민: 사용자 정의 상위 패널 ──
  onAddCustomPanel?: (payload: ShellPanel) => void;
  onDeleteCustomPanel?: (panelId: string) => void;
  onRenameCustomPanel?: (panelId: string, newLabel: string) => void;

  // ── 차수 카드 세부 섹션 ──
  detailSubSections?: Record<string, Array<{ id: string; label: string }>>;
  onUpdateDetailSubSections?: (prefix: "contract" | "refund" | "settlement", list: Array<{ id: string; label: string }>) => void;
};
