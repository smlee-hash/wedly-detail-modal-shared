import { describe, it, expect } from "vitest";
import { resolveHistoryGate } from "./gov-history-gate";

describe("resolveHistoryGate", () => {
  it("항목(entryId)이 있으면 무조건 panel — 보기전용 앱 포함", () => {
    expect(
      resolveHistoryGate({ entryId: "policy-1", canWriteHistory: false, hasCreateContract: false }),
    ).toBe("panel");
  });

  it("항목 없음 + 댓글쓰기 가능 + 자동생성 → composer (값 편집 불가인 하이브도 동일)", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: true, hasCreateContract: true }),
    ).toBe("composer");
  });

  it("식별값(사업자번호/연락처) 없어도 composer — 앵커 꼬리표(_anchorRef)로 회사와 묶인다(재작업 2026-07-15)", () => {
    // 게이트는 더 이상 식별값을 보지 않는다 — 반려 지적 ①(사업자번호 없이 히스토리) 반영.
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: true, hasCreateContract: true }),
    ).toBe("composer");
  });

  it("항목 없음 + 댓글쓰기 불가(보기전용) → empty", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: false, hasCreateContract: true }),
    ).toBe("empty");
  });

  it("항목 없음 + createContract 미주입 → empty (자동생성 불가)", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: true, hasCreateContract: false }),
    ).toBe("empty");
  });
});
