// @wedly/detail-modal-shared — 하이브·ERP 공용 DB 상세모달 부품
//
// 사용 앱은 자체 위들리 디자인 토큰(bg-wedly-accent 등)을 globals.css 에 정의해야 합니다.

// 부품
export { default as CustomSelect } from "./components/CustomSelect";
export type { CustomSelectOption } from "./components/CustomSelect";

export { default as MeetingsTab } from "./components/MeetingsTab";

export { default as SettlementInfoTab } from "./components/SettlementInfoTab";

// 정부지원금 상세 섹션 공용 패널(3앱 공통) — 어댑터가 createGovSubsidyPanel(config) 로 주입.
export { createGovSubsidyPanel } from "./components/GovSubsidyPanel";
// 하위 탭 고르기(순수 판정) — 앱 쪽 배포 관문이 이 판정을 시험으로 지킬 수 있게 함께 내보낸다.
export { resolveGovSubTab, isGovSubTab, GOV_SUB_TABS } from "./components/gov-subtab";
export type { GovSubTab } from "./components/gov-subtab";
export type { GovSubsidyPanelConfig } from "./components/GovSubsidyPanel";

// 분야(섹션)별 정산 탭 래퍼 — 앱별 정산 칸/설정 주소(settlementApiBase) 주입.
export { default as SectionSettlementTab } from "./components/SectionSettlementTab";

export { FilesTab, detectFileTag } from "./components/FilesTab";
export type { FileMeta } from "./components/FilesTab";

// 파일 용량 표기·키 헬퍼 — 앱 패널이 옛 파일 용량 보강(resolveSizes) 연결에 사용.
export {
  formatFileSize,
  fileSizeKey,
  filesMissingSize,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "./lib/file-size";

export { default as SelectDropdownBody } from "./components/SelectDropdown";
export type {
  SelectDropdownBodyProps,
  SelectDropdownColor,
  SelectDropdownColorFamily,
} from "./components/SelectDropdown";

export { default as MultiPersonEditor } from "./components/MultiPersonEditor";
export type { MultiPersonEditorProps } from "./components/MultiPersonEditor";

// 헬퍼
export {
  type FieldDef,
  type FieldType,
  type TierData,
  type ScoreCardDef,
  type ScoreCardColor,
  DEFAULT_FIELDS,
  DEFAULT_SCORECARDS,
  SCORECARD_COLOR_CLASSES,
  ORDINAL_KO,
  makeEmptyTier,
  makeScoreCardId,
  parseTiers,
  parseScoreCards,
  relabelTiers,
  generateFieldKey,
} from "./lib/settlement-info-helpers";

// 훅
export { useFieldOrder } from "./hooks/use-field-order";
export type { OrderableField } from "./hooks/use-field-order";

// 유틸
export { cn } from "./lib/cn";

// 사람 항목 유틸 (이름/이메일 파싱·통일) — 사람 선택 칸에서 공용 사용
export {
  parsePersonItem,
  personDisplayName,
  formatPersonItem,
  unifyPersonDisplay,
  splitPersonListSafe,
} from "./lib/person-helpers";
