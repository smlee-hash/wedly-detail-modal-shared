import { describe, expect, it } from "vitest";
import { resolveHistoryGate } from "./gov-history-gate";

// 정부지원금 탭 히스토리 게이트 — 항목(entryId) 없어도
// "값 편집 가능(canEditValues)" 또는 "댓글 작성 가능(canWriteHistory)" 이면 첫 메모 입력(composer)을 연다.
// 두 권한을 '또는'으로 묶은 것이 세 갈래 통합(2026-08-15)의 핵심 판정이라, 두 축을 각각 덮는다:
//   ERP·일루아 = 값 편집 참 / 하이브 = 값 편집 거짓 + 댓글 참.
describe("resolveHistoryGate", () => {
  it("항목이 있으면 항상 히스토리 패널(panel)", () => {
    expect(resolveHistoryGate({ entryId: "abc", canEditValues: true, canWriteHistory: true, hasCreateContract: true })).toBe("panel");
    // 보기 전용이라도 항목이 있으면 패널은 보여준다(읽기전용은 패널 내부 처리).
    expect(resolveHistoryGate({ entryId: "abc", canEditValues: false, canWriteHistory: false, hasCreateContract: false })).toBe("panel");
  });

  it("항목이 없어도 값 편집 가능 + 자동생성 경로(createContract)면 첫 메모 입력(composer) — ERP·일루아", () => {
    expect(resolveHistoryGate({ entryId: "", canEditValues: true, canWriteHistory: true, hasCreateContract: true })).toBe("composer");
  });

  it("★값 편집은 막혀 있어도 댓글 작성이 열려 있으면 composer — 하이브(값 잠금 + 댓글 개방)", () => {
    // 이 갈래가 '그리고'로 묶였을 때 사라진다. 하이브에서 계약 항목이 없는 회사의
    // 첫 메모 입력칸이 통째로 없어지는 것을 여기서 막는다.
    expect(resolveHistoryGate({ entryId: "", canEditValues: false, canWriteHistory: true, hasCreateContract: true })).toBe("composer");
  });

  it("식별값(사업자번호/연락처) 없어도 composer — 앵커 꼬리표(_anchorRef)로 회사와 묶인다(재작업 2026-07-15)", () => {
    // 게이트는 더 이상 식별값을 보지 않는다 — 노션 반려 지적 ①(사업자번호 없이 히스토리) 반영.
    expect(resolveHistoryGate({ entryId: "", canEditValues: true, canWriteHistory: true, hasCreateContract: true })).toBe("composer");
  });

  it("항목 없음 + 두 권한이 모두 막힌 앱(보기 전용·댓글 잠금)이면 빈 안내(empty) — 권한 모델 유지", () => {
    expect(resolveHistoryGate({ entryId: "", canEditValues: false, canWriteHistory: false, hasCreateContract: true })).toBe("empty");
  });

  it("항목 없음 + 자동생성 경로가 없는 앱이면 빈 안내(empty) — 권한이 열려 있어도", () => {
    expect(resolveHistoryGate({ entryId: "", canEditValues: true, canWriteHistory: true, hasCreateContract: false })).toBe("empty");
    expect(resolveHistoryGate({ entryId: "", canEditValues: false, canWriteHistory: true, hasCreateContract: false })).toBe("empty");
  });
});
