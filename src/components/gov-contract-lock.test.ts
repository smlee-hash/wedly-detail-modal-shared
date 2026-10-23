import { describe, expect, it } from "vitest";
import {
  CONTRACT_LOAD_FAILED_TITLE,
  CONTRACT_LOCK_BODY,
  CONTRACT_LOCK_DROPPED_NOTICE,
  HISTORY_LOCK_BODY,
  resolveContractLock,
} from "./gov-contract-lock";

// 정부지원금 4개 탭(계약정보·정산정보·환불정보·미팅정보) 잠금 판정.
// 히스토리 탭의 loadFailed 와 같은 조건 — 「목록을 못 받았고, 그래서 계약이 하나도 없어 보일 때만」 잠근다.
describe("resolveContractLock", () => {
  it("★목록을 못 받았고 계약이 하나도 안 보이면 잠근다 — 거기 저장하면 새 계약 줄이 생긴다", () => {
    expect(resolveContractLock({ rowsLoadFailed: true, policyRowCount: 0 })).toBe(true);
  });

  it("목록을 제대로 받았으면 계약이 없어도 잠그지 않는다 — 계약이 정말 없는 회사는 지금처럼 첫 칸에서 계약이 만들어진다", () => {
    expect(resolveContractLock({ rowsLoadFailed: false, policyRowCount: 0 })).toBe(false);
  });

  it("조용한 새로고침이 실패했어도 이미 보이는 계약이 있으면 지금처럼 고칠 수 있다", () => {
    expect(resolveContractLock({ rowsLoadFailed: true, policyRowCount: 2 })).toBe(false);
  });

  it("평소(받음 + 계약 있음)에는 잠그지 않는다", () => {
    expect(resolveContractLock({ rowsLoadFailed: false, policyRowCount: 3 })).toBe(false);
  });

  it("실패 여부를 안 넘긴 호출부(상자가 없는 앱)는 잠그지 않는다 — 기존 동작 그대로", () => {
    expect(resolveContractLock({ policyRowCount: 0 })).toBe(false);
  });
});

describe("잠금 안내 문구(승인된 시안과 글자 그대로)", () => {
  it("상자 제목은 히스토리와 같고, 4개 탭 본문은 「입력하면」으로 시작한다", () => {
    expect(CONTRACT_LOAD_FAILED_TITLE).toBe("계약 정보를 불러오지 못했어요");
    expect(CONTRACT_LOCK_BODY).toBe(
      "지금 입력하면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다. 화면을 새로 고친 뒤 다시 열어 주세요.",
    );
  });

  it("히스토리 본문은 지금 그대로다", () => {
    expect(HISTORY_LOCK_BODY).toBe(
      "지금 글을 남기면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다. 화면을 새로 고친 뒤 다시 열어 주세요.",
    );
  });

  it("입력하던 중에 끊긴 경우의 빨간 줄 안내", () => {
    expect(CONTRACT_LOCK_DROPPED_NOTICE).toBe(
      "계약 정보를 불러오지 못해 방금 입력한 값은 저장하지 않았습니다. 화면을 새로 고친 뒤 다시 입력해 주세요.",
    );
  });
});
