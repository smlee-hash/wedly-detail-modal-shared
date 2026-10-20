/**
 * 정부지원금 4개 탭(계약정보·정산정보·환불정보·미팅정보) 입력 잠금 판정 (앱 등록 계약 중복 생성 막기 — 2026-10-20).
 * - 히스토리 탭의 loadFailed(gov-history-gate.ts)와 같은 조건이다: 분야 행 목록을 **못 불러왔고**,
 *   그래서 계약이 하나도 안 보일 때. 이때 칸에 저장하면 acquireOwner() 가 **새 계약 줄을 만든다**(자료 어긋남).
 *   10/15 「테스트」 업체: 목록 받기가 끊긴 채 계약정보를 저장해 계약 1 이 자동 생성됐다.
 * - 이미 계약이 보이면(조용한 새로고침만 실패) 잠그지 않는다 — 새 줄이 만들어질 일이 없고, 평소처럼 고칠 수 있다.
 * - rowsLoadFailed 를 안 넘긴 호출부(상자가 없는 앱)는 잠그지 않는다 — 기존 동작 그대로.
 */
export function resolveContractLock(args: {
  rowsLoadFailed?: boolean;
  /** 지금 보이는 계약 줄 수. */
  policyRowCount: number;
}): boolean {
  return args.rowsLoadFailed === true && args.policyRowCount === 0;
}

/** 잠금 상자 제목 — 히스토리 탭과 같다. */
export const CONTRACT_LOAD_FAILED_TITLE = "계약 정보를 불러오지 못했어요";
/** 4개 탭 잠금 상자 본문. */
export const CONTRACT_LOCK_BODY =
  "지금 입력하면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다. 화면을 새로 고친 뒤 다시 열어 주세요.";
/** 히스토리 탭 잠금 상자 본문 — 예전 문구 그대로. */
export const HISTORY_LOCK_BODY =
  "지금 글을 남기면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다. 화면을 새로 고친 뒤 다시 열어 주세요.";
/** 입력하던 중에 목록 받기가 끊겨 값을 저장하지 않았을 때 위쪽 빨간 줄에 한 번 띄우는 안내. */
export const CONTRACT_LOCK_DROPPED_NOTICE =
  "계약 정보를 불러오지 못해 방금 입력한 값은 저장하지 않았습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.";

/** 잠긴 뒤 계약을 만들려는 시도를 막을 때 던진다 — 호출부는 오류 문구 대신 안내 한 줄로 바꿔 보여 준다. */
export class ContractLockedError extends Error {
  constructor() {
    super(CONTRACT_LOCK_DROPPED_NOTICE);
    this.name = "ContractLockedError";
  }
}
