// @vitest-environment jsdom
// 한 개 고르기 드롭다운 본문 — 하이브·일루아·ERP 가 같이 쓰는 지금 동작을 그대로 묶어 둔다.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SelectDropdownBody, { type SelectDropdownBodyProps, type SelectDropdownColorFamily } from "./SelectDropdown";

const FAMILIES: SelectDropdownColorFamily[] = [
  { name: "파랑", shades: [{ shade: "연", bg: "var(--wedly-bg-blue)", text: "var(--wedly-accent-ink)", bgHex: "var(--wedly-bg-blue)" }] },
];

describe("SelectDropdownBody — 한 개 고르기", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSave: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  async function render(props: Partial<SelectDropdownBodyProps> = {}) {
    await act(async () => {
      root.render(<SelectDropdownBody value="" options={["가나", "Alpha", "다라"]} onSave={onSave} onClose={onClose} {...props} />);
    });
  }
  async function click(target: Element | null | undefined) {
    if (!target) throw new Error("Missing actual UI target");
    await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  }
  async function key(target: Element | null | undefined, keyName: string) {
    if (!target) throw new Error("Missing actual UI target");
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true })); });
  }
  async function type(text: string) {
    const input = container.querySelector("input");
    if (!input) throw new Error("Missing search input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => { setter?.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text);
  const optionTexts = () => [...container.querySelectorAll("button span.rounded-md")].map(s => s.textContent);

  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    onSave = vi.fn(); onClose = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("이름을 누르면 그 값을 저장하고 닫는다 — 고른 값에는 ✓", async () => {
    await render({ value: "다라" });
    expect(document.activeElement).toBe(container.querySelector("input"));
    expect(button("다라✓")).toBeTruthy();
    await click(button("Alpha"));
    expect(onSave).toHaveBeenCalledWith("Alpha");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("「비우기」는 값이 있을 때만 빈 값을 저장하고, 언제나 닫는다", async () => {
    await render({ value: "가나" });
    await click(button("비우기"));
    expect(onSave).toHaveBeenCalledWith("");
    expect(onClose).toHaveBeenCalledTimes(1);
    onSave.mockClear(); onClose.mockClear();
    await render({ value: "" });
    await click(button("비우기"));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("찾기는 대소문자 없이 글자가 든 이름만 남기고, Esc 는 저장 없이 닫는다", async () => {
    await render();
    await type("alp");
    expect(optionTexts()).toEqual(["Alpha"]);
    await key(container.querySelector("input"), "Escape");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("추가 콜백이 있으면 새 이름을 넣자마자 저장하고 닫는다 — 단추·Enter 모두", async () => {
    const onAddOption = vi.fn();
    await render({ onAddOption });
    expect(button("새 옵션 추가")).toBeTruthy();
    await type("가나");
    await click(button("새 옵션 추가"));
    expect(onAddOption).not.toHaveBeenCalled();
    await type("마바");
    await click(button("“마바” 추가"));
    expect(onAddOption).toHaveBeenCalledWith("마바");
    expect(onSave).toHaveBeenCalledWith("마바");
    expect(onClose).toHaveBeenCalledTimes(1);

    await render({ onAddOption, options: ["가나"] });
    await type("사아");
    await key(container.querySelector("input"), "Enter");
    expect(onAddOption).toHaveBeenLastCalledWith("사아");
    expect(onSave).toHaveBeenLastCalledWith("사아");
  });

  it("추가 콜백이 없으면 추가 단추가 없고 Enter 도 아무것도 하지 않는다", async () => {
    await render();
    expect(button("새 옵션 추가")).toBeUndefined();
    await type("마바");
    await key(container.querySelector("input"), "Enter");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["단추", "Enter"])("한 개 고르기의 쉼표 옵션 추가는 %s에서 그대로 저장한다", async (path) => {
    const onAddOption = vi.fn();
    await render({ onAddOption });
    await type("이름, 설명");
    if (path === "Enter") await key(container.querySelector("input"), "Enter");
    else await click(button("“이름, 설명” 추가"));
    expect(onAddOption).toHaveBeenCalledWith("이름, 설명");
    expect(onSave).toHaveBeenCalledWith("이름, 설명");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("색 판은 드롭다운 바깥에 뜨고, 판 안 누름은 바깥 감시로 새지 않으며, 색을 고르면 판만 닫힌다", async () => {
    const onSetColor = vi.fn();
    const outside = vi.fn();
    document.addEventListener("mousedown", outside);
    const changed = vi.fn();
    window.addEventListener("opt-changed", changed);
    try {
      await render({ colorFamilies: FAMILIES, onSetColor, globalChangeEvent: "opt-changed" });
      const colorButtons = [...container.querySelectorAll('button[title="색상 변경"]')];
      expect(colorButtons).toHaveLength(3);
      await click(colorButtons[1]);
      const swatch = document.querySelector('button[title="파랑 · 연"]');
      expect(swatch).not.toBeNull();
      expect(container.contains(swatch)).toBe(false);
      await act(async () => { swatch?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
      expect(outside).not.toHaveBeenCalled();
      await click(swatch);
      expect(onSetColor).toHaveBeenCalledWith("Alpha", { bg: "var(--wedly-bg-blue)", text: "var(--wedly-accent-ink)" });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("opt-changed", changed);
    }
  });

  it("색 판은 같은 단추를 다시 누르거나 화면이 굴러가면 닫힌다", async () => {
    await render({ colorFamilies: FAMILIES, onSetColor: vi.fn() });
    const colorButton = container.querySelector('button[title="색상 변경"]');
    await click(colorButton);
    expect(document.querySelector('button[title="파랑 · 연"]')).not.toBeNull();
    await click(colorButton);
    expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
    await click(colorButton);
    await act(async () => { window.dispatchEvent(new Event("scroll")); });
    expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
    await click(colorButton);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
  });

  it("색 콜백이나 팔레트가 없으면 색상 변경 단추가 없다", async () => {
    await render({ colorFamilies: FAMILIES });
    expect(container.querySelector('button[title="색상 변경"]')).toBeNull();
    await render({ onSetColor: vi.fn(), colorFamilies: [] });
    expect(container.querySelector('button[title="색상 변경"]')).toBeNull();
  });

  it("지운다 단추는 허용했을 때만 있고, 누르면 목록에서 빠진다", async () => {
    const onDeleteOption = vi.fn();
    await render({ onDeleteOption });
    expect(container.querySelector('button[title="옵션 삭제"]')).toBeNull();
    await render({ onDeleteOption, allowDelete: true });
    await click(container.querySelectorAll('button[title="옵션 삭제"]')[0]);
    expect(onDeleteOption).toHaveBeenCalledWith("가나");
    expect(optionTexts()).toEqual(["Alpha", "다라"]);
  });

  it("고정색이 있으면 칩에 그 색을 입힌다", async () => {
    await render({ optionColors: { 가나: { bg: "var(--wedly-bg-green)", text: "var(--wedly-green)" } } });
    const chip = [...container.querySelectorAll<HTMLSpanElement>("button span.rounded-md")].find(s => s.textContent === "가나");
    expect(chip?.getAttribute("style")).toContain("var(--wedly-bg-green)");
  });
});
