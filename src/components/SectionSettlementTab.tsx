"use client";

// 분야(섹션)별 정산 탭 — 공용 SettlementInfoTab을 "그 분야 전용 저장소"로 감싼 얇은 래퍼.
// 앱별 정산 칸/설정 주소는 settlementApiBase prop으로 주입(ERP·하이브·일루아 공용).
// 비율 자동계산은 분야 공통 의미가 없어 끄고(더미 키), 합계카드 기본값도 비워 둔다(관리자가 분야별로 추가).
import SharedSettlementInfoTab from "./SettlementInfoTab";
import type { ScoreCardDef } from "../lib/settlement-info-helpers";

const EMPTY_CARDS: ScoreCardDef[] = [];

export default function SectionSettlementTab({
  section,
  rawValue,
  onSave,
  isAdmin = false,
  settlementApiBase,
  enableConditionalFormula,
  conditionFieldOptions,
  row,
}: {
  section: string;
  rawValue: unknown;
  onSave: (jsonValue: string) => void;
  isAdmin?: boolean;
  // 앱별 정산 칸/설정 API의 베이스 경로. 예: "/api/unified-collab/section-settlement" (뒤에 /{section} 자동)
  settlementApiBase: string;
  // 조건별 수식 게이트 + 비교용 기본정보 칸 후보 (ERP만 주입). 미주입이면 기존과 동일.
  enableConditionalFormula?: boolean;
  conditionFieldOptions?: Array<{ key: string; label: string }>;
  // 조건 평가용 기본정보 행 값 — conditionValues 로 전달돼 기본정보 칸 조건 매칭에 사용.
  row?: Record<string, unknown> | null;
}) {
  const base = `${settlementApiBase}/${encodeURIComponent(section)}`;
  return (
    <SharedSettlementInfoTab
      rawValue={rawValue}
      onSave={onSave}
      isAdmin={isAdmin}
      allowStructureEdit
      fieldsApiPath={`${base}/fields?kind=settlement`}
      configApiPath={`${base}/config`}
      ratioBaseKey="__uc_none_base"
      ratioFeeKey="__uc_none_fee"
      ratioBaseLabel="기준"
      ratioFeeLabel="수수료"
      defaultScoreCards={EMPTY_CARDS}
      enableConditionalFormula={enableConditionalFormula}
      conditionFieldOptions={conditionFieldOptions}
      row={row as Record<string, string | number | boolean | null> | null | undefined}
    />
  );
}
