// @wedly/detail-modal-shared — 하이브·ERP 공용 DB 상세모달 부품
//
// 사용 앱은 자체 위들리 디자인 토큰(bg-wedly-accent 등)을 globals.css 에 정의해야 합니다.

// 부품
export { default as CustomSelect } from "./components/CustomSelect";
export type { CustomSelectOption } from "./components/CustomSelect";

export { default as MeetingsTab } from "./components/MeetingsTab";

export { default as SettlementInfoTab } from "./components/SettlementInfoTab";

export { FilesTab, detectFileTag } from "./components/FilesTab";
export type { FileMeta } from "./components/FilesTab";

export { default as SelectDropdownBody } from "./components/SelectDropdown";
export type {
  SelectDropdownBodyProps,
  SelectDropdownColor,
  SelectDropdownColorFamily,
} from "./components/SelectDropdown";

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

// 상세창 공용 틀 (1단계-C) — 하이브·일루아·ERP 가 함께 쓰는 한 틀.
// 앱은 "설정 표면"(fields·sections·dataSource·renderHistoryPanel·renderSettlementTab 등)만 넘기고,
// 틀(겉 모양·탭 배치·동작)은 100% 공용. 아직 어느 앱에도 연결되지 않은 신규 추가물(운영 위험 0).
export { default as DetailModalShell } from "./components/detail-modal-shell/DetailModalShell";
export type {
  SharedDetailModalProps,
  ShellRowData,
  ShellFormula,
  ShellFieldDef,
  ShellSection,
  ShellPanel,
  ShellDataSource,
  ShellUploadResult,
  ShellHistoryColor,
  ShellHistoryCategory,
  ShellHistoryRenderArgs,
  RenderHistoryPanel,
  ShellSettlementRenderArgs,
  RenderSettlementTab,
  ShellUserDirectory,
  ShellDialog,
  SelectDropdownBodyComponent,
  OpenFileFn,
} from "./components/detail-modal-shell/config";
