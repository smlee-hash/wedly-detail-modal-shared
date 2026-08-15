/**
 * 정부지원금 탭 히스토리 하위탭 게이트 판정 (도메인 탭 항상 활성화 — 2026-07-15).
 * - "panel": 항목(entryId)이 있으면 기존 히스토리 패널.
 * - "composer": 항목이 없어도 **값 편집 가능(canEditValues) 또는 댓글 작성 가능(canWriteHistory)** 이고
 *   자동생성 경로(createContract)가 있으면 첫 메모 입력칸 — 저장 시 ensureEntryId()로 항목 자동생성.
 *   두 권한을 '또는'으로 묶는 이유(2026-08-15 세 갈래 통합): ERP·일루아는 값 편집이 이미 참이라
 *   동작이 안 바뀌고, 하이브(값 잠금 + 댓글 개방)는 첫 메모 입력칸이 기존대로 열린다.
 *   '그리고'로 묶으면 하이브에서 계약 항목이 없는 회사의 첫 메모 입력칸이 통째로 사라진다.
 *   식별값(사업자번호/연락처)이 없어도 열린다 — 자동생성 항목은 앵커 꼬리표(_anchorRef,
 *   각 앱 createContract prefill이 부여)로 원래 회사와 묶여 고아가 되지 않는다(재작업 2026-07-15).
 * - "empty": 그 외(보기 전용 앱·비관리자·자동생성 불가) — 빈 안내만(권한 모델 유지).
 */
export type HistoryGate = "panel" | "composer" | "empty";

export function resolveHistoryGate(args: {
  entryId: string;
  /** 값 편집 가능 여부(ERP·일루아는 참). */
  canEditValues: boolean;
  /** 히스토리(댓글) 작성 가능 여부 — 값 편집 권한과 분리(하이브 = 값 잠금 + 댓글 개방). */
  canWriteHistory: boolean;
  hasCreateContract: boolean;
}): HistoryGate {
  if (args.entryId) return "panel";
  if ((args.canEditValues || args.canWriteHistory) && args.hasCreateContract) return "composer";
  return "empty";
}
