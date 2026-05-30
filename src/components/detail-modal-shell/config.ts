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

import type { ReactNode, ComponentType } from "react";

// ---------------------------------------------------------------------------
// 1) 기본 데이터 형태
// ---------------------------------------------------------------------------

/** 한 행(업체 1건)의 값 모음. 키=컬럼키, 값=문자열/숫자/불리언/빈값. */
export type ShellRowData = Record<string, string | number | boolean | null>;

/** 수식 컬럼 정의 — 참조 컬럼 × 연산자 × 숫자 (예: 예상수수료 × 0.3). 예전 하이브 FormulaSpec 과 동일. */
export type ShellFormula = {
  refKey: string;
  op: "*" | "+" | "-" | "/";
  operand: number;
};

/** 한 컬럼(필드) 정의 — 앱이 넘겨주는 "컬럼 이름·형식". (앱별로 다른 부분) */
export type ShellFieldDef = {
  key: string;
  label: string;
  /** text/number/date/select/multi_select/person/email/phone_number/file/last_edited_time/formula 등 공통 형식 이름 */
  type: string;
  format?: "currency";
  /** type === "formula" 인 사용자 정의 컬럼에서만 사용 — 자동 계산 규칙. */
  formula?: ShellFormula;
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
//    ⚠️ 실패 처리 계약(중요): 저장·이동·생성·매핑이 실패하면(서버 4xx·5xx 포함) 이 함수들은
//       반드시 "예외를 던지거나(reject)" 거부해야 한다. 그래야 틀이 예전 하이브처럼 화면을
//       원래대로 되돌리고(낙관적 반영 취소) 오류 안내창을 띄운다.
//       → 실패인데 조용히 resolve 하면, 옛 "되돌리기·안내" 동작이 사라져 회귀가 된다.
//       (특히 writeSectionMapping·writeTieredFields·patchField·createRow·bulkMigrateTier)
// ---------------------------------------------------------------------------

/** 업로드 결과 — 예전 하이브 /api/upload 응답과 같은 모양. files(여러 개, ZIP 해제) 또는 data(단건). */
export type ShellUploadResult = {
  success?: boolean;
  files?: Array<{ id?: number | string; fileName?: string; url?: string; mimeType?: string }>;
  data?: { id?: number | string; fileName?: string; url?: string; mimeType?: string };
  skipped?: number;
  error?: string;
};

export type ShellDataSource = {
  /** 한 칸 값을 서버 DB 에 저장 (예전 본체 안에 박혀 있던 직접 저장 호출).
   *  ⚠️ 주의(증거 기반): 이것은 "사용자가 고친 그 값의 DB 저장"만 담당한다.
   *  목록 화면 갱신·자동입력 규칙 실행은 별도 콜백 onFieldChange 가 맡는다(역할 분리). */
  patchField: (pageId: string, key: string, value: string | number | boolean | null) => void | Promise<void>;
  /** 신규 행 생성 — 입력값(밑줄키 제외)과 등록 시 함께 남길 코멘트를 받아 서버에 만들고,
   *  서버가 만든 실제 행을 돌려준다(없으면 null). 미지정 시 "신규 등록" 동작 숨김. */
  createRow?: (newRow: ShellRowData, comments?: string[]) => Promise<ShellRowData | null> | void;
  /** 파일 업로드 → 업로드 결과 반환(예전 /api/upload 응답 모양 그대로: 파일목록·단건·skipped).
   *  미지정 시 업로드 비활성. ZIP 자동 해제·제외 건수까지 본체가 예전과 동일하게 처리한다. */
  uploadFile?: (file: File) => Promise<ShellUploadResult | null>;
  /** 파일 다운로드 경로(앞부분). 예: "/api/files/download" */
  fileDownloadPath?: string;
  /** 차수 카드(차수별 계약·환불·정산) 묶음 읽기/쓰기. prefix = "contract"|"refund"|"settlement" */
  readTieredFields?: (prefix: string) => Promise<unknown>;
  writeTieredFields?: (prefix: string, value: unknown) => Promise<void>;
  /** 컬럼-섹션 위치 매핑 읽기/쓰기 — 어드민이 "컬럼을 어느 섹션에" 둘지 바꿀 때.
   *  scope = 페이지 구분 키(예: "tax-amendment"). */
  readSectionMapping?: (scope: string) => Promise<Record<string, string>>;
  writeSectionMapping?: (scope: string, columnKey: string, sectionId: string) => Promise<void>;
  /** 어드민이 컬럼을 차수 카드로 일괄 이전할 때(예전 POST /api/entries/bulk-migrate-tier).
   *  ⚠️ 실제 호출 모양에 맞춤(증거 기반): 보내는 값 = { columnKey, containerKey, aliasKeys },
   *  받는 값 = { total, migrated, skipped, failed } (없으면 null). 미지정 시 일괄 이전 단계 건너뜀. */
  bulkMigrateTier?: (payload: { columnKey: string; containerKey: string; aliasKeys: string[] }) => Promise<{ total?: number; migrated?: number; skipped?: number; failed?: number } | null> | void;
  /** 파일 안전 열기에 쓰는 두 서버 주소 생성기(만료 링크 회복용). 미지정 시 하이브/ERP 기본 경로.
   *  open-file-with-refresh 의 refetchEntryUrl·notionRefreshUrl 로 그대로 전달된다. */
  refetchEntryUrl?: (entryId: string) => string | null | undefined;
  notionRefreshUrl?: (entryId: string, fileName: string) => string | null | undefined;
};

// ---------------------------------------------------------------------------
// 3) 댓글·이력 패널 — 앱마다 저장소(노션/자체DB/REST)가 완전히 달라
//    틀이 직접 만들지 않고, 앱이 만든 패널을 통째로 넘겨받아(render-prop) 그 자리에 끼운다.
//    → 틀(겉)은 같게, 댓글 저장 방식은 앱별로.
// ---------------------------------------------------------------------------

/** 히스토리 카테고리 색상 이름 — 카테고리 탭/추가 모달이 쓰는 공통 색 이름. */
export type ShellHistoryColor = "blue" | "green" | "purple" | "orange" | "red" | "gold" | "gray";

/** 한 히스토리 카테고리 정의(앱·틀 공통). 예전 하이브 HistoryCategoryDef 와 동일 형태. */
export type ShellHistoryCategory = { id: string; label: string; color?: ShellHistoryColor; panelId?: string };

/** 댓글·이력 패널이 한 번 그려질 때 틀이 넘겨주는 모든 것.
 *  ⚠️ 카테고리 목록·추가모달은 "틀"이 소유(어드민 동작 콜백은 SharedDetailModalProps 로 받음)하고,
 *  실제 댓글 목록·저장소(노션/REST/자체DB)만 앱이 만든 패널이 책임진다.
 *  → 틀은 이 args 를 계산해 넘기고, 앱의 renderHistoryPanel 은 자기 패널에 그대로 꽂으면 된다(하이브 동작 0 변화). */
export type ShellHistoryRenderArgs = {
  pageId: string;
  isAdmin: boolean;
  /** 사용자 정의 history 상위 패널일 때 그 패널 id (코멘트를 패널별로 분리). 기본 패널이면 없음. */
  scopePanelId?: string;
  focusCommentId?: string;
  onFocusHandled?: () => void;
  /** 댓글 개수 변동 알림 — 틀이 목록 배지·패널별 카운트를 갱신하도록 이미 감싸서 넘김. */
  onCountChange?: (count: number) => void;
  /** 이 패널에 노출할 카테고리 목록(틀이 panelId 기준으로 걸러서 넘김). */
  categories?: ShellHistoryCategory[];
  /** 카테고리 탭 옆 "+ 카테고리" — 틀의 추가 모달을 연다. */
  onAddCategory?: () => void;
  /** 카테고리 삭제 — 틀이 확인창까지 감싸서 넘김. */
  onDeleteCategory?: (categoryId: string) => void | Promise<void>;
  onRenameCategory?: (categoryId: string, newLabel: string) => void;
  onReorderCategories?: (nextOrder: string[]) => void;
  /** 옛 기본 카테고리(코드 박힌 fallback) 중 숨긴 id 목록. */
  hiddenFallbackIds?: string[];
  onHideFallback?: (categoryId: string) => void;
  onUnhideFallback?: (categoryId: string) => void;
};
export type RenderHistoryPanel = (args: ShellHistoryRenderArgs) => ReactNode;

// ---------------------------------------------------------------------------
// 3-b) 정산/차수 카드 탭 — 앱마다 저장 필드키·서버주소가 달라(예: "정산정보" vs ERP 키)
//    틀이 직접 만들지 않고, 앱이 만든 정산탭을 통째로 끼운다(render-prop). renderHistoryPanel 과 같은 방식.
// ---------------------------------------------------------------------------

export type ShellSettlementRenderArgs = {
  /** 어떤 카드인지: 일반 정산 / 차수별 계약 / 차수별 환불. 앱이 이걸로 저장 필드키·서버주소를 고른다. */
  variant: "settlement" | "tiered-contract" | "tiered-refund";
  row: ShellRowData;
  readOnly: boolean;
  isAdmin: boolean;
  /** 차수 카드 강제 새로고침 토큰(차수 일괄 이전 후 다시 읽기). */
  reloadToken: number;
  /** 정산탭이 값을 저장할 때 부르는 함수 = 틀의 한 칸 저장(handleFieldSave). 앱이 자기 필드키로 호출. */
  onSaveField: (key: string, value: string | number | boolean | null) => void;
  subSections?: Array<{ id: string; label: string }>;
  onUpdateSubSections?: (list: Array<{ id: string; label: string }>) => void;
};
export type RenderSettlementTab = (args: ShellSettlementRenderArgs) => ReactNode;

// ---------------------------------------------------------------------------
// 4) 앱별 보조 부품 — 사람(담당자) 후보 명단, 확인/알림창.
//    앱마다 출처가 달라 주입. (틀의 드롭다운·확인창은 공용 위들리 부품 사용)
// ---------------------------------------------------------------------------

/** 담당자(person) 칸 후보 명단 — 팀장 칸엔 팀장 후보, 팀원 칸엔 팀원 후보, 그 외 전체. */
export type ShellUserDirectory = { all: string[]; leaders: string[]; members: string[] };

/** 위들리 디자인 확인/알림창 — 브라우저 기본 창(confirm/alert) 금지 규칙 준수용. */
export type ShellDialog = {
  confirm: (opts: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>;
  alert?: (opts: { title: string; message?: string }) => Promise<void> | void;
};

/** 옵션 드롭다운 본문 — 앱별 옵션 시스템(추가/삭제/색상)에 연결된 부품. 예전 하이브 HiveSelectDropdownBody.
 *  편집기(SelectEditor)가 이 부품을 받아 옵션 선택 UI 를 그린다. (FieldEditors 의 동일 타입과 구조 호환) */
export type SelectDropdownBodyComponent = ComponentType<{
  value: string;
  options: string[];
  fieldKey: string;
  onSave: (next: string) => void;
  onClose: () => void;
  allowDelete?: boolean;
}>;

/** 파일 안전 열기 함수 — 만료 링크 자동 회복(예전 하이브 openFileWithRefresh).
 *  본체가 만들어 편집기·파일탭에 넘긴다(회복용 서버주소는 dataSource 로 주입). */
export type OpenFileFn = (opts: {
  url: string;
  entryId: string;
  fileName: string;
  category?: string;
  onWarn?: (message: string) => void;
}) => void;

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
  /** ① 컬럼 정의(이름·형식) — 예전 하이브의 CONTRACT_FIELDS(상세창에 그릴 필드)가 입력값이 됨. */
  fields: ShellFieldDef[];
  /** ② 권한 — 예전엔 useAccess() 직접 호출. 이제 앱이 넘겨줌. */
  isAdmin: boolean;
  /** ③ 앱별 서버 연결. */
  dataSource: ShellDataSource;
  /** ④ 댓글·이력 패널(앱이 만든 것을 끼움). */
  renderHistoryPanel: RenderHistoryPanel;

  // ── 옵션 드롭다운(앱별 옵션 시스템 연결) — 예전 하이브 HiveSelectDropdownBody ──
  /** 선택·파일 컬럼 편집의 옵션 드롭다운 본문. 앱별 옵션 저장소에 연결된 부품을 넘긴다. */
  selectDropdownBody: SelectDropdownBodyComponent;

  // ── 정산/차수 카드 패널(앱이 만든 것을 끼움) ──
  /** 정산·차수 카드 탭. 미지정 시 그 종류 섹션은 빈 화면. (저장 필드키·서버주소가 앱별이라 주입) */
  renderSettlementTab?: RenderSettlementTab;

  // ── 컬럼 전체 등록부(라벨 보충·기타 자동수집용) ──
  /** 앱의 전체 컬럼 목록(예전 하이브 COLUMNS). fields 에 없는 컬럼의 라벨/형식을 찾고,
   *  어느 섹션에도 안 든 컬럼을 "기타" 로 자동 수집할 때 쓴다. 미지정 시 fields 로 간주. */
  columns?: ShellFieldDef[];

  // ── 값 변경을 부모에 알림(예전 onUpdate) — 저장(dataSource.patchField)과 역할 분리 ──
  /** 한 칸이 바뀔 때 부모(목록 화면·자동입력 규칙)에 알림. 저장 자체는 dataSource.patchField 가 함.
   *  ⚠️ 증거 기반 분리: 예전 하이브는 onUpdate(부모 알림+규칙)와 직접 저장 호출을 둘 다 했음. */
  onFieldChange?: (pageId: string, key: string, value: string | number | boolean | null) => void;

  // ── 제목·신규 등록 검증(앱별 이름 컬럼/문구) ──
  /** 제목 표시·신규 등록 필수값 검증에 쓰는 "이름" 컬럼 키. 예전 하이브 "02상호명". 미지정 시 검증 생략. */
  primaryFieldKey?: string;
  /** 신규 등록 모드 제목. 기본 "새 항목 등록". (하이브 "새 업체 등록") */
  newRowTitle?: string;
  /** 이름이 비었을 때 제목 대체 문구. 기본 "상세". (하이브 "업체 상세") */
  untitledLabel?: string;

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
  onChangeColumnType?: (key: string, newType: string, formula?: ShellFormula) => void;
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
  historyCategories?: ShellHistoryCategory[];
  onAddHistoryCategory?: (payload: { id: string; label: string; color?: ShellHistoryColor; panelId?: string }) => void;
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
