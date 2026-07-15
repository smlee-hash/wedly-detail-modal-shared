/**
 * 정부지원금 탭 히스토리 하위탭 게이트 판정 (도메인 탭 항상 활성화 — 2026-07-15).
 * - "panel": 항목(entryId)이 있으면 기존 히스토리 패널.
 * - "composer": 항목이 없어도 값 편집 가능(canEditValues)하고 자동생성 경로(createContract)가
 *   있으면 첫 메모 입력칸 — 저장 시 ensureEntryId()로 항목 자동생성.
 * - "empty": 그 외(보기 전용 앱·비관리자·자동생성 불가) — 빈 안내만(권한 모델 유지).
 */
export type HistoryGate = "panel" | "composer" | "empty";

export function resolveHistoryGate(args: {
  entryId: string;
  canEditValues: boolean;
  hasCreateContract: boolean;
}): HistoryGate {
  if (args.entryId) return "panel";
  if (args.canEditValues && args.hasCreateContract) return "composer";
  return "empty";
}
