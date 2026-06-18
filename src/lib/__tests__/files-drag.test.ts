import { describe, it, expect } from "vitest";
import { isFileDrag } from "../files-drag";

describe("isFileDrag", () => {
  it("파일 드래그면 true", () => {
    expect(isFileDrag(["Files"])).toBe(true);
  });
  it("파일과 다른 타입이 섞여도 true", () => {
    expect(isFileDrag(["application/x-moz-file", "Files"])).toBe(true);
  });
  it("글자만 끌면 false (화면 안 텍스트 드래그 무시)", () => {
    expect(isFileDrag(["text/plain"])).toBe(false);
  });
  it("빈 목록·null·undefined 는 false", () => {
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});
