/**
 * 정부지원금 탭 히스토리 하위탭 게이트 판정 (도메인 탭 항상 활성화 — 2026-07-15).
 * - "panel": 항목(entryId)이 있으면 기존 히스토리 패널.
 * - "composer": 항목이 없어도 댓글 작성 가능(canWriteHistory)하고 자동생성 경로(createContract)와
 *   고객 식별값(사업자번호/연락처)이 있으면 첫 메모 입력칸 — 저장 시 ensureEntryId()로 항목 자동생성.
 * - "needAnchor": 편집 가능하지만 식별값이 하나도 없으면 안내만 — 자동생성된 항목은
 *   사업자번호/연락처로 회사와 묶이므로, 둘 다 없으면 메모가 이 회사 상세에 안 보이는
 *   고아 항목이 된다(코드리뷰 지적 반영).
 * - "empty": 그 외(보기 전용 앱·비관리자·자동생성 불가) — 빈 안내만(권한 모델 유지).
 */
export type HistoryGate = "panel" | "composer" | "needAnchor" | "empty";

export function resolveHistoryGate(args: {
  entryId: string;
  /** 히스토리(댓글) 작성 가능 여부 — 값 편집 권한과 분리(2단계: 하이브 = 값 잠금 + 댓글 개방). */
  canWriteHistory: boolean;
  hasCreateContract: boolean;
  hasAnchorIdentity: boolean;
}): HistoryGate {
  if (args.entryId) return "panel";
  if (args.canWriteHistory && args.hasCreateContract) {
    return args.hasAnchorIdentity ? "composer" : "needAnchor";
  }
  return "empty";
}
