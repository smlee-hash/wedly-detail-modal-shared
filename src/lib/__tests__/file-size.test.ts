import { describe, it, expect } from "vitest";
import {
  formatFileSize,
  partitionFilesBySize,
  oversizeMessage,
  DEFAULT_MAX_UPLOAD_BYTES,
} from "../file-size";

describe("formatFileSize", () => {
  it("0/바이트", () => {
    expect(formatFileSize(0)).toBe("0B");
    expect(formatFileSize(512)).toBe("512B");
  });
  it("KB(소수/정수)", () => {
    expect(formatFileSize(1536)).toBe("1.5KB");
    expect(formatFileSize(2048)).toBe("2KB");
  });
  it("MB(소수/정수)", () => {
    expect(formatFileSize(2516582)).toBe("2.4MB");
    expect(formatFileSize(1024 * 1024)).toBe("1MB");
    expect(formatFileSize(DEFAULT_MAX_UPLOAD_BYTES)).toBe("100MB");
  });
  it("음수/비정상은 빈 문자열", () => {
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(NaN)).toBe("");
  });
});

describe("partitionFilesBySize", () => {
  it("정확히 한도는 통과, 한도+1은 제외", () => {
    const r = partitionFilesBySize(
      [{ name: "ok", size: 100 }, { name: "big", size: 101 }],
      100,
    );
    expect(r.accepted.map((f) => f.name)).toEqual(["ok"]);
    expect(r.rejected.map((f) => f.name)).toEqual(["big"]);
  });
  it("전부 통과", () => {
    const r = partitionFilesBySize([{ name: "a", size: 10 }], 100);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
  it("전부 초과", () => {
    const r = partitionFilesBySize([{ name: "x", size: 200 }], 100);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });
});

describe("oversizeMessage", () => {
  const max = DEFAULT_MAX_UPLOAD_BYTES;
  it("빈 목록은 빈 문자열", () => expect(oversizeMessage([], max)).toBe(""));
  it("한 개", () => {
    const m = oversizeMessage([{ name: "big.pdf", size: 120.5 * 1024 * 1024 }], max);
    expect(m).toContain("'big.pdf'");
    expect(m).toContain("120.5MB");
    expect(m).toContain("100MB");
    expect(m).toContain("업로드할 수 없습니다");
  });
  it("여러 개는 '외 N개'", () => {
    const m = oversizeMessage(
      [{ name: "a", size: 200 * 1024 * 1024 }, { name: "b", size: 200 * 1024 * 1024 }],
      max,
    );
    expect(m).toContain("외 1개");
  });
});
