// @vitest-environment jsdom
// NO.177 — 상세 카드 날짜 칸은 연·월·일을 넣는 동안·달력을 옮기는 동안 저장하지 않고, Enter·칸 밖 이동 때 한 번만 저장한다.
//   실제 차수 카드(SettlementInfoTab)의 실제 날짜 칸과 실제 저장 콜백(onSave)만 쓴다. 편집 도우미는 바꾸지 않는다.
//   jsdom 은 날짜 칸의 「덜 넣은 상태」를 만들지 못하므로, 브라우저가 칸에 보여 주는 값·validity.badInput 만 그대로 흉내 낸다.
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

type Intent = { kind: string; tierId: string; fieldKey: string };
const DATE_LABELS = ["계약일", "착수일", "환불일", "정부지원금 수령일", "성공보수 수금일", "계약서 작성일"];
const fields: FieldDef[] = [
  { key: "계약금", label: "계약금", type: "number" },
  ...DATE_LABELS.map((label) => ({ key: label, label, type: "date" as const })),
];
const props = { storagePrefix: "contract", ensureFirstTier: true, addButtonSuffixOverride: "계약", fieldsApiPath: "/date-fields", configApiPath: "/date-config", ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "계약금", ratioFeeLabel: "수수료", defaultScoreCards: [], hideSummaryCards: true };
const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

describe("NO.177 상세 카드 날짜 칸 — 입력 마무리 때 한 번 저장", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saves: { raw: string; intent: Intent | undefined }[];
  let error: ReturnType<typeof vi.spyOn>;
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  async function render(tier: Record<string, unknown>, savedBasisVersion?: string) {
    await act(async () => {
      root.render(<StrictMode><SettlementInfoTab {...props} rawValue={JSON.stringify([tier])} savedBasisVersion={savedBasisVersion} onSave={(raw, intent?: Intent) => saves.push({ raw, intent })} /></StrictMode>);
      await settle();
    });
  }
  const card = () => [...document.querySelectorAll<HTMLDivElement>("div.rounded-2xl.shadow-sm")].find((c) => c.querySelector("h4"))!;
  const fieldBox = (label: string) => card().querySelector(`[title="${label}"]`)?.parentElement as HTMLDivElement;
  const dateInput = (label: string) => fieldBox(label)?.querySelector<HTMLInputElement>('input[type="date"]') ?? null;
  const shown = (label: string) => fieldBox(label).querySelector(".cursor-pointer")?.textContent;
  async function open(label: string) {
    const target = fieldBox(label)?.querySelector(".cursor-pointer");
    if (!target) throw new Error(`Missing actual date field ${label}`);
    await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); await settle(); });
    const input = dateInput(label);
    if (!input) throw new Error(`Missing actual date editor ${label}`);
    expect(document.activeElement).toBe(input);
    return input;
  }
  // 브라우저가 칸에 보이는 상태 — 덜 넣은 동안은 값이 빈 글자이고 badInput 이 켜진다.
  function browserState(input: HTMLInputElement, value: string, badInput: boolean) {
    Object.defineProperty(input, "validity", { configurable: true, get: () => ({ badInput, valid: !badInput }) });
    valueSetter.call(input, value);
  }
  async function type(input: HTMLInputElement, value: string, badInput = false) {
    await act(async () => {
      browserState(input, value, badInput);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "1", bubbles: true }));
      await settle();
    });
  }
  async function keyOnly(input: HTMLInputElement, value: string, badInput: boolean) {
    // 연·월·일을 차례로 지우는 동안 값이 빈 글자 그대로면 브라우저는 input 을 보내지 않는다 — 키를 뗀 것만 온다.
    await act(async () => {
      browserState(input, value, badInput);
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Backspace", bubbles: true }));
      await settle();
    });
  }
  // 뒤따르는 blur 는 칸이 아직 붙어 초점을 가진 채 와야 실제로 시험된다 — 떨어진 칸의 blur 는 아무 일도 하지 않는다.
  function expectFocused(input: HTMLInputElement) {
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
  }
  async function key(input: HTMLInputElement, name: string, thenBlur = false) {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
      if (thenBlur) { expectFocused(input); input.blur(); }
      await settle();
    });
  }
  async function leave(input: HTMLInputElement) {
    expectFocused(input);
    await act(async () => { input.blur(); await settle(); });
  }
  // 페이지 안에서 다른 곳을 누를 때(팝업이 닫힌 뒤 포함) — 크롬의 blur 는 페이지 초점을 가진 채 온다.
  // jsdom 은 blur 를 보내기 전에 초점을 지워 hasFocus() 가 거짓으로 오므로, 크롬처럼 초점을 가진 채 보낸다.
  async function leaveWithPageFocus(input: HTMLInputElement) {
    const pageFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    try { await leave(input); } finally { pageFocus.mockRestore(); }
  }
  // 다른 앱·탭으로 넘어가는 동안 — 크롬은 페이지 초점부터 끄고, 칸은 활성 요소로 남긴 채 채움·blur 를 보낸다.
  async function whilePageUnfocused(run: () => Promise<void>) {
    const pageFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try { await run(); } finally { pageFocus.mockRestore(); }
  }

  // 달력 팝업이 떠 있는 동안 — 메인 문서는 초점을 잃은 채 칸이 활성 요소로 남고, 고른 값의 input 만 온다(키를 떼는 일은 없다).
  // 팝업이 닫히면 페이지 초점이 돌아오므로, 이 도우미가 끝난 뒤의 blur·Enter 는 초점을 가진 채 온다.
  async function pickInPopup(input: HTMLInputElement, value: string) {
    await whilePageUnfocused(async () => {
      await act(async () => {
        browserState(input, value, false);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
      });
    });
  }

  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); saves = [];
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : {} }) })));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); error.mockRestore(); vi.unstubAllGlobals(); });

  it("연·월·일을 넣는 동안은 저장·닫기 없이, Enter 한 번에 한 번만 저장하고 뒤따르는 blur·새로 그리기에도 다시 저장하지 않는다", async () => {
    await render({ id: "one", label: "1차 계약", 계약일: "2026-12-25" });
    const input = await open("계약일");
    await type(input, "2026-01-25"); // 월에 1 을 넣은 순간(예전: 곧바로 2026-01-25 저장)
    await type(input, "2026-10-25");
    await type(input, "2026-10-15");
    expect(saves).toEqual([]);
    expect(dateInput("계약일")).toBe(input);
    await key(input, "Enter", true);
    expect(saves).toHaveLength(1);
    expect(saves[0].intent).toMatchObject({ kind: "field", tierId: "one", fieldKey: "계약일" });
    expect(JSON.parse(saves[0].raw)[0].계약일).toBe("2026-10-15");
    expect(dateInput("계약일")).toBeNull();
    await render({ id: "one", label: "1차 계약", 계약일: "2026-10-15" });
    expect(saves).toHaveLength(1);
    expect(shown("계약일")).toBe("2026-10-15");
    expect((await open("계약일")).value).toBe("2026-10-15");
  });

  it("달력을 연 채 화살표로 날짜를 옮기는 동안은 저장·닫기 없이, 칸 밖으로 나갈 때 마지막 날짜를 한 번 저장한다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "2026-10-16");
    await type(input, "2026-10-17");
    expect(saves).toEqual([]);
    expect(dateInput("계약일")).toBe(input);
    await leave(input);
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].raw)[0].계약일).toBe("2026-10-17");
  });

  it("일부만 넣고 나가면 저장하지 않고 원래 값을 그대로 둔다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "", true); // 연도 칸을 지워 날짜가 덜 찬 상태
    await leave(input);
    expect(saves).toEqual([]);
    expect(shown("계약일")).toBe("2026-10-15");
  });

  it("일에 0 만 넣고 칸 밖을 누르면(브라우저가 떠나며 01 로 채워도) 저장하지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "", true); // 일에 0 — 예전: 계약일이 빈 값으로 저장
    // 크롬 순서: 활성 요소를 먼저 비우고 → 덜 넣은 일 0 을 01 로 채워 input 을 보낸 뒤 → blur 를 보낸다.
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => document.body });
    try {
      await act(async () => {
        browserState(input, "2026-10-01", false);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
      });
    } finally {
      Reflect.deleteProperty(document, "activeElement");
    }
    await leave(input);
    expect(saves).toEqual([]);
    expect(shown("계약일")).toBe("2026-10-15");
  });

  it("일에 0 만 넣은 채 다른 앱·탭으로 넘어가면(칸이 활성 요소로 남은 채 01 로 채워져도) 저장하지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "", true); // 일에 0
    await whilePageUnfocused(async () => {
      await act(async () => {
        browserState(input, "2026-10-01", false); // 예전: 이 채움을 다 넣은 날짜로 보고 2026-10-01 저장
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
      });
      await leave(input);
    });
    expect(saves).toEqual([]);
    expect(shown("계약일")).toBe("2026-10-15");
  });

  it("날짜를 다 넣은 뒤 다른 앱·탭으로 넘어가면 그 날짜를 한 번 저장한다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "", true); // 연도를 지웠다가
    await type(input, "2026-11-20"); // 다시 다 넣음
    await whilePageUnfocused(() => leave(input));
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].raw)[0].계약일).toBe("2026-11-20");
  });

  // 일부만 넣은 뒤(키를 뗄 때 덜 넣음으로 보임) 달력 팝업에서 고르는 값은 페이지 초점이 꺼진 채 온다 — 팝업이 닫힌 뒤의 이동·Enter 에서 저장해야 한다.
  it.each([
    ["날짜 고르기", "2026-10-15"],
    ["오늘 단추", "2026-10-23"],
    ["지우기 단추", ""],
  ])("일부만 넣은 뒤 달력 팝업의 %s 로 바꾸면(페이지 초점이 꺼진 채 input 이 와도) 팝업이 닫힌 뒤 칸 밖 이동 때 한 번 저장한다", async (_name, picked) => {
    await render({ id: "one", 계약일: "2026-10-01" });
    const input = await open("계약일");
    await type(input, "", true); // 일 자리에 1 만 쳐서 덜 넣은 상태
    await pickInPopup(input, picked);
    expect(saves).toEqual([]);
    expect(dateInput("계약일")).toBe(input);
    await leaveWithPageFocus(input);
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].raw)[0].계약일).toBe(picked);
  });

  it("일부만 넣은 뒤 달력 팝업에서 날짜를 고르고 Enter 를 눌러도 한 번 저장하고 뒤따르는 blur 에는 다시 저장하지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-01" });
    const input = await open("계약일");
    await type(input, "", true);
    await pickInPopup(input, "2026-10-15");
    await key(input, "Enter", true);
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].raw)[0].계약일).toBe("2026-10-15");
  });

  it("팝업에서 고른 뒤 다시 일부만 넣고 칸 밖을 누르면(브라우저가 01 로 채워도) 저장하지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-20" });
    const input = await open("계약일");
    await type(input, "", true);
    await pickInPopup(input, "2026-10-15");
    await type(input, "", true); // 팝업이 닫힌 뒤 일을 다시 지우고 0 만 침 — 키를 뗄 때 덜 넣음으로 다시 보인다
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => document.body });
    try {
      await act(async () => {
        browserState(input, "2026-10-01", false);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
      });
    } finally {
      Reflect.deleteProperty(document, "activeElement");
    }
    await leaveWithPageFocus(input);
    expect(saves).toEqual([]);
    expect(shown("계약일")).toBe("2026-10-20");
  });

  it("연·월·일을 모두 지우고 나가면 빈 값을 한 번 저장한다 — 하나만 지운 동안은 저장하지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "", true); // 연도만 지움
    await keyOnly(input, "", true); // 월도 지움 — 값은 그대로 빈 글자
    expect(saves).toEqual([]);
    await keyOnly(input, "", false); // 일까지 모두 지움 — 덜 넣은 상태가 풀린다
    await leave(input);
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0].raw)[0].계약일).toBe("");
  });

  it("Esc 는 취소이고, 이어지는 blur 에도 저장하지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-15" });
    const input = await open("계약일");
    await type(input, "2026-11-20");
    await key(input, "Escape", true);
    expect(saves).toEqual([]);
    expect(dateInput("계약일")).toBeNull();
    expect(shown("계약일")).toBe("2026-10-15");
    const again = await open("계약일");
    await key(again, "Escape", true);
    expect(saves).toEqual([]);
  });

  it("달력은 칸을 열 때만 띄우고, 넣는 동안 화면을 다시 그려도(1분 설정 갱신·창 초점 등) 다시 띄우지 않는다", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "showPicker");
    let pickers = 0;
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", { configurable: true, writable: true, value() { pickers += 1; } });
    try {
      await render({ id: "one", 계약일: "2026-10-15" });
      const input = await open("계약일");
      const opened = pickers;
      expect(opened).toBeGreaterThan(0);
      await type(input, "2026-10-20");
      await render({ id: "one", 계약일: "2026-10-15" });
      expect(dateInput("계약일")).toBe(input);
      expect(pickers).toBe(opened);
    } finally {
      if (original) Object.defineProperty(HTMLInputElement.prototype, "showPicker", original);
      else Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
    }
  });

  it("바꾸지 않고 나가면 저장하지 않는다 — 날짜 칸이 읽지 못하는 옛 형식 값도 지우지 않는다", async () => {
    await render({ id: "one", 계약일: "2026-10-15", 착수일: "2026.10.15" });
    await leave(await open("계약일"));
    await leave(await open("착수일"));
    expect(saves).toEqual([]);
    expect(shown("착수일")).toBe("2026.10.15");
  });

  it("편집하는 사이 저장 기준이 바뀌면 이번 날짜 입력을 적용하지 않는다(같은 부품의 기존 편집 세션 원칙)", async () => {
    await render({ id: "one", 계약일: "2026-10-15" }, "basis-1");
    const input = await open("계약일");
    await type(input, "2026-10-20");
    await render({ id: "one", 계약일: "2026-10-15" }, "basis-2");
    await key(input, "Enter", true);
    expect(saves).toEqual([]);
    expect(container.textContent).toContain("저장된 값이 바뀌어 이번 입력을 취소했습니다");
  });

  it.each(DATE_LABELS)("%s 칸도 같은 부품 — 넣는 동안 저장 없이 Enter 한 번에 한 번 저장", async (label) => {
    await render({ id: "one", [label]: "2026-10-15" });
    const input = await open(label);
    await type(input, "2026-03-15");
    await type(input, "2026-03-31");
    expect(saves).toEqual([]);
    await key(input, "Enter", true);
    expect(saves).toHaveLength(1);
    expect(saves[0].intent).toMatchObject({ kind: "field", fieldKey: label });
    expect(JSON.parse(saves[0].raw)[0][label]).toBe("2026-03-31");
  });
});
