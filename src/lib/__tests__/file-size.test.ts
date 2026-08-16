import { describe, it, expect } from "vitest";
import {
  formatFileSize,
  partitionFilesBySize,
  oversizeMessage,
  fileSizeKey,
  filesMissingSize,
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

describe("fileSizeKey", () => {
  it("url 우선", () => {
    expect(fileSizeKey({ url: "/api/upload/abc", objectKey: "k" })).toBe("/api/upload/abc");
  });
  it("url 없으면 objectKey", () => {
    expect(fileSizeKey({ objectKey: "k1" })).toBe("k1");
  });
  it("둘 다 없으면 빈 문자열", () => {
    expect(fileSizeKey({})).toBe("");
  });
});

describe("filesMissingSize", () => {
  it("용량 없는 것만, 키 있는 것만 남긴다", () => {
    const r = filesMissingSize([
      { url: "/a", size: 10 }, // 용량 있음 → 제외
      { url: "/b" }, // 없음 → 포함
      { objectKey: "k" }, // 없음 → 포함
      {}, // 키 없음 → 제외
    ]);
    expect(r.map((f) => f.url ?? f.objectKey)).toEqual(["/b", "k"]);
  });
  it("용량이 0이면 '있음'으로 보고 제외(빈 파일도 기록값 존중)", () => {
    expect(filesMissingSize([{ url: "/zero", size: 0 }])).toEqual([]);
  });
});
