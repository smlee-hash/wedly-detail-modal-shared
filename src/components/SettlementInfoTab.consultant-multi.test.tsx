// @vitest-environment jsdom
// 차수 카드 「담당 컨설턴트」 여러 명 고르기(NO.197 안 B) — 실제 카드를 그려 누르고 저장값을 본다.
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";
import type { SelectDropdownColorFamily } from "./SelectDropdown";

type Intent = { kind: string; tierId: string; fieldKey: string; previous: { present: false } | { present: true; value: unknown } };
const COLORS = {
  "담당자 1": { bg: "var(--wedly-bg-green)", text: "var(--wedly-green)" },
  "담당자 2": { bg: "var(--wedly-bg-yellow)", text: "var(--wedly-gold)" },
  "담당자 3": { bg: "var(--wedly-bg-purple)", text: "var(--wedly-purple)" },
};
const FAMILIES: SelectDropdownColorFamily[] = [
  { name: "파랑", shades: [{ shade: "연", bg: "var(--wedly-bg-blue)", text: "var(--wedly-accent-ink)", bgHex: "var(--wedly-bg-blue)" }] },
];
const props = { storagePrefix: "contract", ensureFirstTier: true, addButtonSuffixOverride: "계약", fieldsApiPath: "/multi-fields", configApiPath: "/multi-config", ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "계약금", ratioFeeLabel: "수수료", defaultScoreCards: [], hideSummaryCards: true };

describe("차수 카드 담당 컨설턴트 — 여러 명 고르기", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saves: { raw: string; intent: Intent | undefined }[];
  let puts: { url: string; body: { fields: FieldDef[] } }[];
  let fields: FieldDef[];
  let error: ReturnType<typeof vi.spyOn>;
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5));

  // single — 여러 명 고르기를 켜지 않은 호출(다른 분야 카드·하이브·일루아)
  type RenderOptions = { isAdmin?: boolean; readOnly?: boolean; colorFamilies?: SelectDropdownColorFamily[]; savedBasisVersion?: string; single?: boolean; showEditor?: boolean; multiKeys?: readonly string[] };
  async function render(value: string | undefined, options: RenderOptions = {}) {
    const row = { id: "one", label: "1차 계약", ...(value === undefined ? {} : { 담당컨설턴트: value }) };
    await act(async () => {
      root.render(<StrictMode><SettlementInfoTab {...props} rawValue={JSON.stringify([row])} isAdmin={!!options.isAdmin} allowColumnEdit={!!options.isAdmin}
        multiPersonSelectKeys={options.single ? undefined : options.multiKeys ?? ["담당컨설턴트"]} hideSummaryCards={!options.showEditor}
        readOnly={!!options.readOnly} colorFamilies={options.colorFamilies} savedBasisVersion={options.savedBasisVersion}
        onSave={(raw, intent?: Intent) => saves.push({ raw, intent })} /></StrictMode>);
      await settle();
    });
  }
  function fieldBox(label: string) {
    const labelEl = document.querySelector<HTMLElement>(`[title="${label}"]`);
    if (!labelEl?.parentElement) throw new Error(`Missing field ${label}`);
    return labelEl.parentElement;
  }
  async function click(target: Element | null | undefined) {
    if (!target) throw new Error("Missing actual UI target");
    await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); await settle(); });
  }
  async function mousedown(target: Element | null | undefined) {
    if (!target) throw new Error("Missing actual UI target");
    await act(async () => { target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); await settle(); });
  }
  async function key(target: Element | null | undefined, keyName: string, init: KeyboardEventInit = {}) {
    if (!target) throw new Error("Missing actual UI target");
    await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, ...init })); await settle(); });
  }
  async function type(input: HTMLInputElement | null, text: string) {
    if (!input) throw new Error("Missing search input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => { setter?.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); await settle(); });
  }
  const openConsultant = () => click(fieldBox("담당 컨설턴트").querySelector(".cursor-pointer"));
  const search = () => document.querySelector<HTMLInputElement>('input[aria-label="이름 찾기"]');
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
  const row = (name: string) => rows().find(b => b.textContent?.trim() === name);
  const pressed = (name: string) => row(name)?.getAttribute("aria-pressed");
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text);
  const savedValue = (i = 0) => JSON.parse(saves[i].raw)[0].담당컨설턴트;
  async function refreshFields() {
    await act(async () => { window.dispatchEvent(new Event("focus")); await settle(); });
  }
  async function openTypeEditor(label: string) {
    await click(button("편집"));
    const definition = [...container.querySelectorAll('[draggable="true"]')].find(el =>
      [...el.querySelectorAll("span")].some(span => span.textContent === label));
    await click([...definition!.querySelectorAll("button")].find(b => b.textContent === "타입"));
  }
  async function chooseSelectType() {
    const label = [...document.querySelectorAll("label")].find(el => el.textContent?.includes("컬럼 타입"));
    await click(label?.querySelector("button"));
    await click([...document.querySelectorAll('button[role="option"]')].find(el => el.textContent === "드롭다운"));
  }

  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    saves = []; puts = [];
    fields = [
      { key: "담당컨설턴트", label: "담당 컨설턴트", type: "select", options: ["담당자 1", "담당자 2", "담당자 3"], optionColors: COLORS },
      { key: "컨설팅담당", label: "컨설팅 담당", type: "select", options: ["일루아", "위들리"] },
    ];
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PUT") {
        puts.push({ url, body: JSON.parse(String(init.body)) });
        return { ok: true, json: async () => ({ success: true, data: null }) };
      }
      return { ok: true, json: async () => ({ success: true, data: url.includes("fields") ? fields : {} }) };
    }));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    // 겹친 key·act 밖 갱신 같은 React 경고가 없어야 한다.
    const reactWarnings = error.mock.calls.map(c => String(c[0])).filter(m => m.includes("Warning") || m.includes("same key") || m.includes("act("));
    error.mockRestore(); vi.unstubAllGlobals();
    expect(reactWarnings).toEqual([]);
  });

  it("카드에는 사람마다 색 칩 하나씩 — 대표 표시는 없다", async () => {
    await render("담당자 1, 담당자 2");
    const chips = [...fieldBox("담당 컨설턴트").querySelectorAll<HTMLSpanElement>(".cursor-pointer span.rounded-md")];
    expect(chips.map(c => c.textContent)).toEqual(["담당자 1", "담당자 2"]);
    expect(chips[0].getAttribute("style")).toContain("var(--wedly-bg-green)");
    expect(chips[1].getAttribute("style")).toContain("var(--wedly-bg-yellow)");
    expect(document.body.textContent).not.toContain("대표");
  });

  it("목록에 체크가 붙고, 눌러도 창이 열린 채 고른 순서대로 「완료」에서 한 번 저장한다", async () => {
    await render("담당자 1, 담당자 2");
    await openConsultant();
    expect(search()).not.toBeNull();
    expect(search()?.getAttribute("placeholder")).toBeNull();
    expect(rows().map(b => b.textContent?.trim())).toEqual(["담당자 1", "담당자 2", "담당자 3"]);
    expect([pressed("담당자 1"), pressed("담당자 2"), pressed("담당자 3")]).toEqual(["true", "true", "false"]);
    expect(button("완료 (2)")).toBeTruthy();
    expect(button("취소")).toBeTruthy();
    expect(document.body.textContent).not.toContain("대표");

    await click(row("담당자 3"));
    expect(pressed("담당자 3")).toBe("true");
    expect(button("완료 (3)")).toBeTruthy();
    await click(row("담당자 1"));
    expect(pressed("담당자 1")).toBe("false");
    expect(saves).toEqual([]);
    expect(search()).not.toBeNull();

    await click(button("완료 (2)"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 2, 담당자 3");
    expect(saves[0].intent).toMatchObject({ kind: "field", tierId: "one", fieldKey: "담당컨설턴트", previous: { present: true, value: "담당자 1, 담당자 2" } });
    expect(search()).toBeNull();
    const chips = [...fieldBox("담당 컨설턴트").querySelectorAll(".cursor-pointer span.rounded-md")];
    expect(chips.map(c => c.textContent)).toEqual(["담당자 2", "담당자 3"]);
  });

  it("고른 이름 칩의 ✕ 로 빼고, 창 밖을 누르면 고른 대로 저장한다", async () => {
    await render("담당자 1, 담당자 2");
    await openConsultant();
    await click(document.querySelector('button[aria-label="담당자 1 빼기"]'));
    expect(pressed("담당자 1")).toBe("false");
    expect(document.querySelector('button[aria-label="담당자 1 빼기"]')).toBeNull();
    await click(row("담당자 3"));
    await mousedown(search());
    expect(saves).toEqual([]);
    await mousedown(document.body);
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 2, 담당자 3");
    expect(search()).toBeNull();
  });

  it("「취소」와 Esc 는 저장하지 않고 닫는다 — Esc 는 상세창까지 닫지 않는다", async () => {
    await render("담당자 1");
    await openConsultant();
    await click(row("담당자 2"));
    await click(button("취소"));
    expect(saves).toEqual([]);
    expect(search()).toBeNull();

    // 정부지원금 상세창은 문서 전체에서 Esc 를 받아 창을 닫는다(ERP DetailModal) — 고르기 창의 Esc 가 거기까지 가면 안 된다.
    const modalEscape = vi.fn();
    document.addEventListener("keydown", modalEscape);
    try {
      await openConsultant();
      expect(pressed("담당자 2")).toBe("false");
      await click(row("담당자 3"));
      await key(search(), "Escape", { isComposing: true });
      expect(search()).not.toBeNull();
      await key(search(), "Escape");
      expect(modalEscape.mock.calls.filter(([e]) => (e as KeyboardEvent).key === "Escape" && !(e as KeyboardEvent).isComposing)).toEqual([]);
    } finally {
      document.removeEventListener("keydown", modalEscape);
    }
    expect(saves).toEqual([]);
    expect(search()).toBeNull();
    const trigger = fieldBox("담당 컨설턴트").querySelector('[role="button"]');
    expect(document.activeElement).toBe(trigger);
    const chips = [...fieldBox("담당 컨설턴트").querySelectorAll(".cursor-pointer span.rounded-md")];
    expect(chips.map(c => c.textContent)).toEqual(["담당자 1"]);
  });

  it("칸은 키보드로 열 수 있고, 열린 채 칸을 다시 누르면 저장하고 닫힌 뒤 다시 열리지 않는다", async () => {
    await render("담당자 1");
    const trigger = fieldBox("담당 컨설턴트").querySelector<HTMLElement>('[role="button"]');
    expect(trigger?.getAttribute("tabindex")).toBe("0");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    await key(trigger, "Enter");
    expect(search()).not.toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    await click(row("담당자 2"));
    // 실제 누름 순서: mousedown(창 밖 → 저장하고 닫음) → click(칸) — 다시 열리면 안 된다.
    await mousedown(trigger);
    await click(trigger);
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 1, 담당자 2");
    expect(search()).toBeNull();
    await key(trigger, " ");
    expect(search()).not.toBeNull();
  });

  it("키보드로 칩을 지운 뒤 현재 초점에서 Esc → 바깥 클릭을 해도 저장은 0회다", async () => {
    await render("담당자 1, 담당자 2");
    await openConsultant();
    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="담당자 1 빼기"]')!;
    remove.focus();
    await key(remove, "Enter");
    // jsdom 은 Enter의 기본 click을 만들지 않으므로 브라우저가 만드는 활성화를 이어 보낸다.
    await click(remove);
    expect(document.querySelector('button[aria-label="담당자 1 빼기"]')).toBeNull();
    const modalEscape = vi.fn();
    document.addEventListener("keydown", modalEscape);
    try {
      await key(document.activeElement, "Escape");
      await mousedown(document.body);
      expect(saves).toEqual([]);
      expect(search()).toBeNull();
      expect(modalEscape).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(fieldBox("담당 컨설턴트").querySelector('[role="button"]'));
      expect([...fieldBox("담당 컨설턴트").querySelectorAll(".cursor-pointer span.rounded-md")].map(c => c.textContent))
        .toEqual(["담당자 1", "담당자 2"]);
    } finally { document.removeEventListener("keydown", modalEscape); }
  });

  it("바뀐 것이 없으면 「완료」·창 밖 누름 모두 저장하지 않는다", async () => {
    await render("담당자 1, 담당자 2");
    await openConsultant();
    await click(button("완료 (2)"));
    await openConsultant();
    await click(row("담당자 3"));
    await click(row("담당자 3"));
    await mousedown(document.body);
    expect(saves).toEqual([]);
  });

  it("「비우기」는 값이 있을 때만 빈 값으로 저장한다", async () => {
    await render("담당자 1, 담당자 2");
    await openConsultant();
    expect(search()).not.toBeNull();
    await click(button("비우기"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("");
    expect(search()).toBeNull();

    saves = [];
    await render(undefined);
    await openConsultant();
    await click(button("비우기"));
    expect(saves).toEqual([]);
    expect(search()).toBeNull();
  });

  it("같은 이름이 두 번 저장돼 있어도 칩·체크는 한 번만, 손대지 않으면 저장하지 않는다", async () => {
    await render("담당자 1, 담당자 2, 담당자 1");
    const chips = [...fieldBox("담당 컨설턴트").querySelectorAll(".cursor-pointer span.rounded-md")];
    expect(chips.map(c => c.textContent)).toEqual(["담당자 1", "담당자 2"]);
    await openConsultant();
    expect(button("완료 (2)")).toBeTruthy();
    expect(document.querySelectorAll('button[aria-label="담당자 1 빼기"]')).toHaveLength(1);
    await click(button("완료 (2)"));
    expect(saves).toEqual([]);
  });

  it("목록에 없는 기존 이름도 체크된 채 보이고, 찾기는 글자가 든 이름만 남긴다", async () => {
    await render("담당자 1, 외부 담당");
    await openConsultant();
    expect(rows().map(b => b.textContent?.trim())).toEqual(["담당자 1", "담당자 2", "담당자 3", "외부 담당"]);
    expect(pressed("외부 담당")).toBe("true");
    await type(search(), "2");
    expect(rows().map(b => b.textContent?.trim())).toEqual(["담당자 2"]);
  });

  it("목록 밖 기존 이름은 해제 후에도 후보에 남고 재선택하면 고른 순서의 끝에 저장된다", async () => {
    await render("외부 담당, 담당자 1");
    await openConsultant();
    await click(row("외부 담당"));
    expect(pressed("외부 담당")).toBe("false");
    await click(row("담당자 2"));
    await click(row("외부 담당"));
    await click(button("완료 (3)"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 1, 담당자 2, 외부 담당");
  });

  it("서버에서 지운 미선택 이름은 열린 창에서도 사라지고 새 명단만 선택해 저장한다", async () => {
    await render("담당자 1");
    await openConsultant();
    fields = fields.map(f => f.key === "담당컨설턴트" ? { ...f, options: ["담당자 1", "담당자 3", "담당자 6"] } : f);
    await refreshFields();
    expect(rows().map(b => b.textContent?.trim())).toEqual(["담당자 1", "담당자 3", "담당자 6"]);
    await click(row("담당자 6"));
    await click(button("완료 (2)"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 1, 담당자 6");
  });

  it("이 창에서 추가한 이름과 열 때 배정된 이름은 서버 조회에 없어도 재선택할 수 있다", async () => {
    await render("담당자 1, 외부 담당", { isAdmin: true });
    await openConsultant();
    await type(search(), "담당자 4");
    await key(search(), "Enter");
    expect(puts).toHaveLength(1);
    await click(row("담당자 4"));
    await click(row("외부 담당"));
    // 새 이름은 아직 조회에 나타나지 않고, 원래 미선택이던 2번은 서버에서 삭제됐다.
    fields = fields.map(f => f.key === "담당컨설턴트" ? { ...f, options: ["담당자 1", "담당자 3"] } : f);
    await refreshFields();
    expect(rows().map(b => b.textContent?.trim())).toEqual(["담당자 1", "담당자 3", "담당자 4", "외부 담당"]);
    expect(pressed("담당자 4")).toBe("false");
    expect(pressed("외부 담당")).toBe("false");
    await click(row("외부 담당"));
    await click(row("담당자 4"));
    await click(button("완료 (3)"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 1, 외부 담당, 담당자 4");
  });

  it("열 때 배정된 이름은 서버 명단에서 지워져도 해제·재선택할 수 있다", async () => {
    await render("담당자 2, 담당자 1");
    await openConsultant();
    fields = fields.map(f => f.key === "담당컨설턴트" ? { ...f, options: ["담당자 1", "담당자 3"] } : f);
    await refreshFields();
    await click(row("담당자 2"));
    expect(pressed("담당자 2")).toBe("false");
    await click(row("담당자 2"));
    await click(button("완료 (2)"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 1, 담당자 2");
  });

  it.each(["보기 추가", "기존 보기 수정", "텍스트에서 선택으로 변경", "새 opt-in 칸"])("관리자 타입 편집의 %s 경로도 쉼표 이름을 저장하지 않는다", async (path) => {
    if (path === "텍스트에서 선택으로 변경") fields[0] = { key: "담당컨설턴트", label: "담당 컨설턴트", type: "text" };
    await render("담당자 1", { isAdmin: true, showEditor: true, multiKeys: ["담당컨설턴트", "새담당"] });
    if (path === "새 opt-in 칸") {
      await click(button("편집"));
      await click(button("+ 컬럼 추가"));
      await type(document.querySelector('input[placeholder="예: 비고"]'), "새담당");
      await chooseSelectType();
    } else {
      await openTypeEditor("담당 컨설턴트");
      if (path === "텍스트에서 선택으로 변경") await chooseSelectType();
    }
    if (path !== "기존 보기 수정") await click(button("+ 보기 추가"));
    const inputs = document.querySelectorAll<HTMLInputElement>('input[placeholder="예: 진행"]');
    await type(inputs[path === "기존 보기 수정" ? 0 : inputs.length - 1], "홍길동, 담당");
    await click(button("확인"));
    expect(puts).toEqual([]);
    expect(saves).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("쉼표");
    // 같은 창에서 이름만 고치면 정상 저장된다. 거부가 편집기를 망가뜨리지 않아야 한다.
    await type(inputs[path === "기존 보기 수정" ? 0 : inputs.length - 1], "홍길동");
    await click(button("확인"));
    expect(puts).toHaveLength(1);
    const key = path === "새 opt-in 칸" ? "새담당" : "담당컨설턴트";
    expect(puts[0].body.fields.find(f => f.key === key)?.options).toContain("홍길동");
    expect(puts[0].body.fields.find(f => f.key === key)?.options).not.toContain("홍길동, 담당");
  });

  it.each(["opt-in 없는 같은 칸", "다른 선택 칸"])("%s의 관리자 보기 편집에는 쉼표 제한을 적용하지 않는다", async (path) => {
    await render("담당자 1", { isAdmin: true, showEditor: true, single: path === "opt-in 없는 같은 칸" });
    await openTypeEditor(path === "다른 선택 칸" ? "컨설팅 담당" : "담당 컨설턴트");
    await click(button("+ 보기 추가"));
    const inputs = document.querySelectorAll<HTMLInputElement>('input[placeholder="예: 진행"]');
    await type(inputs[inputs.length - 1], "이름, 설명");
    await click(button("확인"));
    expect(puts).toHaveLength(1);
    const key = path === "다른 선택 칸" ? "컨설팅담당" : "담당컨설턴트";
    expect(puts[0].body.fields.find(f => f.key === key)?.options).toContain("이름, 설명");
  });

  it("관리자는 새 이름을 추가하면 칸 정의에 저장되고 바로 체크된 채 창이 열려 있다", async () => {
    await render("담당자 1", { isAdmin: true });
    await openConsultant();
    expect(button("새 옵션 추가")).toBeTruthy();
    await type(search(), "담당자 4");
    await click(button("“담당자 4” 추가"));
    expect(puts).toHaveLength(1);
    expect(puts[0].body.fields.find(f => f.key === "담당컨설턴트")?.options).toEqual(["담당자 1", "담당자 2", "담당자 3", "담당자 4"]);
    expect(pressed("담당자 4")).toBe("true");
    expect(search()?.value).toBe("");
    expect(saves).toEqual([]);

    await type(search(), "담당자 5");
    await key(search(), "Enter", { isComposing: true });
    expect(row("담당자 5")).toBeUndefined();
    await key(search(), "Enter");
    expect(pressed("담당자 5")).toBe("true");
    expect(puts).toHaveLength(2);

    // 쉼표는 이름 사이 구분이라, 쉼표가 든 이름은 넣지 않는다(저장 뒤 두 사람으로 쪼개진다).
    await type(search(), "가, 나");
    expect(button("“가, 나” 추가")).toBeUndefined();
    await key(search(), "Enter");
    expect(row("가, 나")).toBeUndefined();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("쉼표");
    await click(button("새 옵션 추가"));
    expect(row("가, 나")).toBeUndefined();
    expect(puts).toHaveLength(2);
    await type(search(), "");
    expect(document.querySelector('[role="alert"]')).toBeNull();

    await click(button("완료 (3)"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 1, 담당자 4, 담당자 5");
  });

  it("관리자 색상 변경은 목록 이름에만 뜨고, 색을 골라도 창이 닫히거나 저장되지 않는다", async () => {
    await render("담당자 1, 외부 담당", { isAdmin: true, colorFamilies: FAMILIES });
    await openConsultant();
    const colorButtons = [...document.querySelectorAll<HTMLButtonElement>('button[title="색상 변경"]')];
    expect(colorButtons).toHaveLength(3);
    await click(colorButtons[1]);
    const swatch = document.querySelector('button[title="파랑 · 연"]');
    await mousedown(swatch);
    await click(swatch);
    expect(puts).toHaveLength(1);
    expect(puts[0].body.fields.find(f => f.key === "담당컨설턴트")?.optionColors?.["담당자 2"]).toEqual({ bg: "var(--wedly-bg-blue)", text: "var(--wedly-accent-ink)" });
    expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
    expect(search()).not.toBeNull();
    expect(saves).toEqual([]);
    const rowChip = row("담당자 2")?.querySelector("span.rounded-md");
    expect(rowChip?.getAttribute("style")).toContain("var(--wedly-bg-blue)");

    // 판이 열린 채 목록 안 다른 곳을 누르면 판만 닫힌다(누른 동작은 그대로 된다).
    await click(document.querySelectorAll<HTMLButtonElement>('button[title="색상 변경"]')[0]);
    expect(document.querySelector('button[title="파랑 · 연"]')).not.toBeNull();
    await click(row("담당자 3"));
    expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
    expect(pressed("담당자 3")).toBe("true");
    expect(search()).not.toBeNull();
  });

  it("관리자가 아니면 새 이름 추가·색상 변경이 없다", async () => {
    await render("담당자 1", { colorFamilies: FAMILIES });
    await openConsultant();
    expect(button("새 옵션 추가")).toBeUndefined();
    expect(document.querySelector('button[title="색상 변경"]')).toBeNull();
    await type(search(), "담당자 9");
    await key(search(), "Enter");
    expect(row("담당자 9")).toBeUndefined();
    expect(puts).toEqual([]);
  });

  it("색상 판의 Esc도 고르기 창만 취소하고 뒤의 바깥 클릭에서 저장하지 않는다", async () => {
    await render("담당자 1", { isAdmin: true, colorFamilies: FAMILIES });
    await openConsultant();
    await click(row("담당자 2"));
    await click(document.querySelector('button[title="색상 변경"]'));
    const swatch = document.querySelector<HTMLButtonElement>('button[title="파랑 · 연"]')!;
    swatch.focus();
    const modalEscape = vi.fn();
    document.addEventListener("keydown", modalEscape);
    try {
      await key(swatch, "Escape", { isComposing: true });
      expect(search()).not.toBeNull();
      await key(swatch, "Escape");
      await mousedown(document.body);
      expect(search()).toBeNull();
      expect(document.querySelector('button[title="파랑 · 연"]')).toBeNull();
      expect(saves).toEqual([]);
      expect(puts).toEqual([]);
      expect(modalEscape.mock.calls.filter(([e]) => !(e as KeyboardEvent).isComposing)).toEqual([]);
    } finally { document.removeEventListener("keydown", modalEscape); }
  });

  it("창이 열린 사이 저장 기준이 바뀌면 고른 값을 저장하지 않고 다시 고르라고 알린다", async () => {
    await render("담당자 1", { savedBasisVersion: "v1" });
    await openConsultant();
    await click(row("담당자 2"));
    await render("담당자 1", { savedBasisVersion: "v2" });
    await click(button("완료 (2)"));
    expect(saves).toEqual([]);
    expect(search()).toBeNull();
    expect(fieldBox("담당 컨설턴트").textContent).toContain("저장된 값이 바뀌어 이번 입력을 취소했습니다");
  });

  it("읽기 전용이면 열리지 않는다", async () => {
    await render("담당자 1, 담당자 2", { readOnly: true });
    expect(fieldBox("담당 컨설턴트").querySelector(".cursor-pointer")).toBeNull();
    const chips = [...fieldBox("담당 컨설턴트").querySelectorAll("span.rounded-md")];
    expect(chips.map(c => c.textContent)).toEqual(["담당자 1", "담당자 2"]);
    expect(fieldBox("담당 컨설턴트").querySelector('[role="button"], [aria-haspopup], [aria-expanded], [aria-controls]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("열린 비모달 대화상자를 필드명과 고유 id로 연결하고 닫으면 연결을 지운다", async () => {
    await render("담당자 1", { multiKeys: ["담당컨설턴트", "컨설팅담당"] });
    const first = fieldBox("담당 컨설턴트").querySelector<HTMLElement>('[role="button"]')!;
    const second = fieldBox("컨설팅 담당").querySelector<HTMLElement>('[role="button"]')!;
    expect(first.hasAttribute("aria-controls")).toBe(false);
    await key(first, "Enter");
    const firstId = first.getAttribute("aria-controls");
    expect(firstId).toBeTruthy();
    const popup = document.getElementById(firstId!);
    expect(popup?.getAttribute("role")).toBe("dialog");
    expect(popup?.getAttribute("aria-label")).toBe("담당 컨설턴트");
    expect(popup?.getAttribute("aria-modal")).not.toBe("true");
    expect(document.activeElement).toBe(search());
    expect(pressed("담당자 1")).toBe("true");
    await click(button("취소"));
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(first.hasAttribute("aria-controls")).toBe(false);
    expect(document.getElementById(firstId!)).toBeNull();
    expect(document.activeElement).toBe(first);
    await key(second, " ");
    const secondId = second.getAttribute("aria-controls");
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    expect(document.getElementById(secondId!)?.getAttribute("aria-label")).toBe("컨설팅 담당");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click(button("취소"));
    expect(saves).toHaveLength(0);
    expect(document.activeElement).toBe(second);
  });

  it("다른 선택 칸은 지금처럼 하나만 고르고 바로 저장한다", async () => {
    await render("담당자 1");
    await click(fieldBox("컨설팅 담당").querySelector(".cursor-pointer"));
    expect(search()).toBeNull();
    expect(document.querySelector("button[aria-pressed]")).toBeNull();
    await click(button("위들리"));
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].raw)[0].컨설팅담당).toBe("위들리");
    expect(button("위들리")).toBeUndefined();
  });

  it("여러 명 고르기를 켜지 않은 곳(다른 분야 카드·하이브·일루아)은 같은 칸도 지금처럼 한 개 고르기다", async () => {
    await render("담당자 1, 담당자 2", { single: true });
    expect(fieldBox("담당 컨설턴트").querySelector('[aria-haspopup="dialog"]')).toBeNull();
    await openConsultant();
    expect(search()).toBeNull();
    expect(document.querySelector("button[aria-pressed]")).toBeNull();
    expect(button("완료 (2)")).toBeUndefined();
    await click(button("담당자 2"));
    expect(saves).toHaveLength(1);
    expect(savedValue()).toBe("담당자 2");
  });
});
