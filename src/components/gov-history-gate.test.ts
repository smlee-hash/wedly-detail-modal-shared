import { describe, expect, it } from "vitest";
import { resolveHistoryGate } from "./gov-history-gate";

// 정부지원금 탭 히스토리 게이트 — 항목(entryId) 없어도 편집 가능하면 첫 메모 입력(composer)을 연다.
describe("resolveHistoryGate", () => {
  it("항목이 있으면 항상 히스토리 패널(panel)", () => {
    expect(resolveHistoryGate({ entryId: "abc", canEditValues: true, hasCreateContract: true })).toBe("panel");
    // 보기 전용(하이브)이라도 항목이 있으면 패널은 보여준다(읽기전용은 패널 내부 처리).
    expect(resolveHistoryGate({ entryId: "abc", canEditValues: false, hasCreateContract: false })).toBe("panel");
  });

  it("항목이 없어도 편집 가능 + 자동생성 경로(createContract) 있으면 첫 메모 입력(composer)", () => {
    expect(resolveHistoryGate({ entryId: "", canEditValues: true, hasCreateContract: true })).toBe("composer");
  });

  it("항목 없음 + 보기 전용(하이브·비관리자)이면 빈 안내(empty) — 권한 모델 유지", () => {
    expect(resolveHistoryGate({ entryId: "", canEditValues: false, hasCreateContract: true })).toBe("empty");
  });

  it("항목 없음 + 자동생성 경로가 없는 앱이면 빈 안내(empty)", () => {
    expect(resolveHistoryGate({ entryId: "", canEditValues: true, hasCreateContract: false })).toBe("empty");
  });
});
