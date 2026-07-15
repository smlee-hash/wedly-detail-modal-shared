import { describe, it, expect } from "vitest";
import { resolveHistoryGate } from "./gov-history-gate";

describe("resolveHistoryGate", () => {
  it("항목(entryId)이 있으면 무조건 panel — 보기전용 앱 포함", () => {
    expect(
      resolveHistoryGate({ entryId: "policy-1", canWriteHistory: false, hasCreateContract: false, hasAnchorIdentity: true }),
    ).toBe("panel");
  });

  it("항목 없음 + 댓글쓰기 가능 + 자동생성 + 식별값 → composer (값 편집 불가인 하이브도 동일)", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: true, hasCreateContract: true, hasAnchorIdentity: true }),
    ).toBe("composer");
  });

  it("항목 없음 + 댓글쓰기 가능 + 자동생성 + 식별값 없음 → needAnchor (고아 항목 방지)", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: true, hasCreateContract: true, hasAnchorIdentity: false }),
    ).toBe("needAnchor");
  });

  it("항목 없음 + 댓글쓰기 불가(보기전용) → empty", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: false, hasCreateContract: true, hasAnchorIdentity: true }),
    ).toBe("empty");
  });

  it("항목 없음 + createContract 미주입 → empty (자동생성 불가)", () => {
    expect(
      resolveHistoryGate({ entryId: "", canWriteHistory: true, hasCreateContract: false, hasAnchorIdentity: true }),
    ).toBe("empty");
  });
});
