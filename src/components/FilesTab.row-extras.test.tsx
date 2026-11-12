// @vitest-environment jsdom
// 파일 행 줄 끝 자리(NO.732 PPT 재생성) — getRowExtras 가 행마다 상태 글·단추·제거 가능 여부·분류 잠금을 준다.
// 안 넘기거나 null 을 돌려주면 그 행은 지금 화면과 같아야 한다(하이브·일루아는 넘기지 않는다).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesTab, type FileMeta } from "./FilesTab";

const FILES: FileMeta[] = [
  { fileName: "회사소개.pptx", url: "/api/upload/11111111-1111-1111-1111-111111111111", category: "기타자료", at: "2026-11-12T02:20:00.000Z", size: 2048 },
  { fileName: "계약서.pdf", url: "/api/upload/22222222-2222-2222-2222-222222222222", category: "계약서", at: "2026-11-11T00:41:00.000Z", size: 1024 },
];

describe("FilesTab — 줄 끝 자리(getRowExtras)", () => {
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
  const kidIndex = (row: HTMLElement, pred: (el: Element) => boolean) => [...row.children].findIndex(pred);

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

  it("null 을 돌려주는 행은 속성을 안 넘긴 화면과 마크업이 같다", async () => {
    await render();
    const before = rows().map((r) => r.outerHTML);
    await render({ getRowExtras: () => null });
    expect(rows().map((r) => r.outerHTML)).toEqual(before);
  });

  it("빈 객체를 돌려줘도 그 행은 지금 그대로(제거 단추·분류 단추·올린 때)", async () => {
    await render();
    const before = rows()[0].outerHTML;
    await render({ getRowExtras: () => ({}) });
    expect(rows()[0].outerHTML).toBe(before);
  });

  it("sub 는 이름 아래 줄의 올린 때 대신 들어간다(링크 안)", async () => {
    await render({
      getRowExtras: (f) => (f.fileName === "회사소개.pptx" ? { sub: <span data-testid="st">디자인 중 · 8분</span> } : null),
    });
    const [ppt, pdf] = rows();
    const link = ppt.querySelector("a[target=_blank]")!;
    const st = link.querySelector("[data-testid=st]");
    expect(st?.textContent).toBe("디자인 중 · 8분");
    expect(st!.closest("[data-file-sub]")?.tagName).toBe("SPAN");
    // 올린 때 글자는 그 행에서 사라진다(다른 행은 그대로)
    expect(link.textContent).not.toMatch(/2026\.11\.12/);
    expect(pdf.querySelector("a[target=_blank]")?.textContent).toMatch(/2026\.11\.11/);
  });

  it("action 은 이름 링크 바로 뒤·크기 앞에 놓인다", async () => {
    await render({
      getRowExtras: (f) => (f.fileName === "회사소개.pptx" ? { action: <button type="button">재생성</button> } : null),
    });
    const [ppt, pdf] = rows();
    const link = kidIndex(ppt, (el) => el.matches("a[target=_blank]"));
    const action = kidIndex(ppt, (el) => el.textContent === "재생성");
    const size = kidIndex(ppt, (el) => el.matches("span.tabular-nums") && /KB|B$/.test(el.textContent ?? ""));
    expect(link).toBe(0);
    expect(action).toBe(link + 1);
    expect(size).toBe(action + 1);
    expect(pdf.textContent).not.toContain("재생성");
  });

  it("removable:false 면 「파일 제거」 단추 대신 같은 폭(24px) 빈칸", async () => {
    await render({ getRowExtras: (f) => (f.fileName === "회사소개.pptx" ? { removable: false } : null) });
    const [ppt, pdf] = rows();
    expect(ppt.querySelector("button[aria-label='파일 제거']")).toBeNull();
    const spacer = ppt.lastElementChild as HTMLElement;
    expect(spacer.matches("[data-file-remove-spacer]")).toBe(true);
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(spacer.className).toContain("w-6");
    expect(pdf.querySelectorAll("button[aria-label='파일 제거']").length).toBe(1);
  });

  it("categoryLocked 면 분류는 누를 수 없는 글로 보인다(분류 이름은 그대로)", async () => {
    await render({ getRowExtras: (f) => (f.fileName === "회사소개.pptx" ? { categoryLocked: true } : null) });
    const [ppt, pdf] = rows();
    expect(ppt.querySelector("button[title='카테고리 변경']")).toBeNull();
    const chip = ppt.querySelector("[data-file-category-locked]");
    expect(chip?.tagName).toBe("SPAN");
    // 옛 5종 모드 — 파일 이름에 분류 낱말이 없어 「기타」
    expect(chip?.textContent?.trim()).toBe("기타");
    expect(pdf.querySelector("button[title='카테고리 변경']")?.textContent?.trim()).toBe("계약서");
  });

  it("실제 분류 목록 모드에서도 categoryLocked 는 글로, 이름은 저장값 그대로", async () => {
    await render({
      categoryOptions: ["제안서", "계약서"],
      files: [{ ...FILES[0], category: "제안서" }],
      getRowExtras: () => ({ categoryLocked: true }),
    });
    const [ppt] = rows();
    expect(ppt.querySelector("button[title='카테고리 변경']")).toBeNull();
    expect(ppt.querySelector("[data-file-category-locked]")?.textContent?.trim()).toBe("제안서");
  });

  it("여러 칸을 함께 — sub·action·removable·categoryLocked 가 한 행에", async () => {
    await render({
      getRowExtras: (f) =>
        f.fileName === "회사소개.pptx"
          ? { sub: <span data-testid="st">차례 기다림 · 앞 1건</span>, action: <button type="button">취소</button>, removable: false, categoryLocked: true }
          : null,
    });
    const [ppt] = rows();
    expect(ppt.querySelector("[data-testid=st]")?.textContent).toBe("차례 기다림 · 앞 1건");
    expect([...ppt.children].some((el) => el.textContent === "취소")).toBe(true);
    expect(ppt.querySelector("button[aria-label='파일 제거']")).toBeNull();
    expect(ppt.querySelector("button[title='카테고리 변경']")).toBeNull();
    // 내려받기는 그대로
    expect(ppt.querySelectorAll("a[aria-label=다운로드]").length).toBe(1);
  });
});
