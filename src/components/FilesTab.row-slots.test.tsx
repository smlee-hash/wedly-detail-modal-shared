// @vitest-environment jsdom
// 파일 행 끼움 자리(NO.567 첨부 파일 이름 정리) — 앱이 행마다 배지·단추·이름 고치기 칸을 끼울 수 있다.
// 끼울 것을 안 넘기면 지금 화면과 같아야 한다(하이브·일루아는 넘기지 않는다).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesTab, type FileMeta } from "./FilesTab";

const FILES: FileMeta[] = [
  { fileName: "미가라멘_계약서_20261002.pdf", url: "/api/upload/11111111-1111-1111-1111-111111111111", category: "계약서", at: "2026-10-02T02:20:00.000Z" },
  { fileName: "paste_1.png", url: "/api/upload/22222222-2222-2222-2222-222222222222", category: "기타자료", at: "2026-10-12T00:41:00.000Z" },
];

describe("FilesTab — 파일 행 끼움 자리", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function render(extra: Partial<React.ComponentProps<typeof FilesTab>> = {}) {
    await act(async () => {
      root.render(
        <FilesTab
          files={FILES}
          pageId="row-1"
          onFilesChange={() => {}}
          defaultUploadCategory="기타자료"
          uploadButtonLabel="파일 업로드"
          emptyMessage="파일이 없습니다"
          downloadApiPath="/api/files/download"
          {...extra}
        />,
      );
    });
  }
  const rows = () => [...container.querySelectorAll<HTMLDivElement>("div.space-y-1\\.5 > div")];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("끼울 것을 안 넘기면 행은 지금 그대로 — 이름 링크·올린 때·분류·내려받기·제거", async () => {
    await render();
    const [first] = rows();
    expect(rows()).toHaveLength(2);
    expect(first.querySelector("a[target=_blank]")?.textContent).toContain("미가라멘_계약서_20261002.pdf");
    expect(first.querySelector("span.tabular-nums")?.textContent).toMatch(/^2026\.10\.02 \d\d:20$/);
    expect(first.querySelector("a[aria-label=다운로드]")).toBeTruthy();
    expect(first.querySelector("button[aria-label='파일 제거']")).toBeTruthy();
    expect(first.querySelector("[data-file-note]")).toBeNull();
  });

  it("renderFileNote 는 올린 때 옆(이름 아래 줄)에 붙는다", async () => {
    await render({ renderFileNote: (f) => (f.fileName === "paste_1.png" ? <span data-testid="chip">이름 확인 필요</span> : null) });
    const [first, second] = rows();
    expect(first.querySelector("[data-testid=chip]")).toBeNull();
    const chip = second.querySelector("[data-testid=chip]");
    expect(chip?.textContent).toBe("이름 확인 필요");
    // 같은 줄 — 올린 때 글자와 한 부모 안
    const line = chip!.parentElement!;
    expect(line.querySelector("span.tabular-nums")?.textContent).toMatch(/^2026\.10\.12/);
  });

  it("올린 때가 없는 옛 파일도 표시는 보인다", async () => {
    await act(async () => root.render(
      <FilesTab
        files={[{ fileName: "옛파일.pdf", url: "/api/upload/33333333-3333-3333-3333-333333333333" }]}
        pageId="row-1"
        onFilesChange={() => {}}
        defaultUploadCategory="기타자료"
        uploadButtonLabel="파일 업로드"
        emptyMessage="파일이 없습니다"
        renderFileNote={() => <span data-testid="chip">이름 확인 필요</span>}
      />,
    ));
    expect(container.querySelector("[data-testid=chip]")).toBeTruthy();
  });

  it("renderFileActions 는 분류 단추 뒤, 내려받기 앞에 놓인다", async () => {
    await render({ renderFileActions: () => <button type="button" aria-label="이름 바꾸기">연필</button> });
    const [first] = rows();
    const kids = [...first.children];
    const pen = kids.findIndex((el) => el.querySelector("button[aria-label='이름 바꾸기']") || el.matches("button[aria-label='이름 바꾸기']"));
    const cat = kids.findIndex((el) => el.querySelector("button[title='카테고리 변경']"));
    const dl = kids.findIndex((el) => el.matches("a[aria-label=다운로드]"));
    expect(cat).toBeGreaterThanOrEqual(0);
    expect(pen).toBeGreaterThan(cat);
    expect(dl).toBeGreaterThan(pen);
  });

  it("renderFileEditor 가 내용을 주면 그 행만 고치기 칸으로 바뀐다(링크·단추 없음)", async () => {
    await render({
      renderFileEditor: (f) => (f.fileName === "paste_1.png" ? <input aria-label="새 파일 이름" defaultValue="paste_1" /> : null),
      renderFileActions: () => <button type="button" aria-label="이름 바꾸기">연필</button>,
    });
    const [first, second] = rows();
    expect(first.querySelector("a[target=_blank]")).toBeTruthy();
    expect(second.querySelector("input[aria-label='새 파일 이름']")).toBeTruthy();
    expect(second.querySelector("a")).toBeNull();
    expect(second.querySelector("button[aria-label='이름 바꾸기']")).toBeNull();
    expect(second.querySelector("button[aria-label='파일 제거']")).toBeNull();
  });
});
