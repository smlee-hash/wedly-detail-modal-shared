// @vitest-environment jsdom
// 정부지원금 정산정보 탭 — 비어 있는 회사도 계약정보 탭처럼 「1차 정산」 첫 입력란을 처음부터 보여 준다.
// 그 첫 칸은 저장하지 않은 초안이다(열기만 해서는 저장 0번). 노션 3df7b6a9-b239-801e-a8b8-e80abaa6df02.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeePublicViewV1, SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel } from "./GovSubsidyPanel";

const FIELDS = [
  { key: "정산금액", label: "정산금액", type: "number" },
  { key: "메모", label: "메모", type: "text" },
];
const DRAFT_NOTE = "이 회사의 마지막 차수입니다. 지워도 회사 자료는 남고 빈 첫 입력칸이 다시 나타납니다.";

type Save = (...args: unknown[]) => Promise<void>;
type Row = { domain: string; entryId: string; domainLabel: string; row: Record<string, unknown>; feeView?: FeePublicViewV1 };

let root: Root;
let host: HTMLDivElement;
let fieldDefs: unknown[];

beforeEach(() => {
  fieldDefs = FIELDS;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => ({ success: true, data: String(url).includes("fields") ? fieldDefs : {} }),
  })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function ownerRow(entryId: string, row: Record<string, unknown> = {}, feeView?: FeePublicViewV1): Row {
  return { domain: "government-subsidy", entryId, domainLabel: "정부지원금", row, ...(feeView ? { feeView } : {}) };
}
function settlementTier(id: string, 정산금액: number) {
  return { id, label: "1차 정산", 정산금액 };
}
function panelFor(save: Save, create: () => Promise<string>, extra: Record<string, unknown> = {}) {
  return createGovSubsidyPanel({
    editable: true, allowStructureEdit: false, ownSource: "illua",
    commentsPath: (id: string) => `/comments/${id}`,
    contractFieldsPath: "/first-fields-contract", settlementFieldsPath: "/first-fields-settlement",
    refundFieldsPath: "/first-fields-refund", configPath: "/first-config",
    savePolicyField: save, createContract: create, filterPolicyRows: (rows: unknown[]) => rows,
    ...extra,
  } as Parameters<typeof createGovSubsidyPanel>[0]);
}
function panelProps(rows: Row[], subTab = "settlement") {
  return {
    rows: rows as unknown as SectionPanelProps["rows"], primaryRow: { _id: "customer-one" },
    isAdmin: true, hideSubTabBar: true, subTab, onSubTabChange: vi.fn(), onSaved: vi.fn(),
    adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"],
  };
}
const newSave = () => vi.fn<Save>().mockResolvedValue(undefined);
const newCreate = () => vi.fn(async () => "created-first");

function cards() {
  return Array.from(host.querySelectorAll<HTMLDivElement>("div.rounded-2xl.shadow-sm")).filter((card) => card.querySelector("h4"));
}
function cardLabel(index: number) {
  return (cards()[index].querySelector("h4")?.textContent ?? "").replace(/\s/g, "");
}
function buttonEndingWith(text: string) {
  const normalized = text.replace(/\s/g, "");
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.replace(/\s/g, "").endsWith(normalized));
}
async function click(target: Element | null | undefined) {
  if (!target) throw new Error("Missing click target");
  await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}
async function settle() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)); });
}
async function editAmount(cardIndex: number, value: string) {
  const field = cards()[cardIndex].querySelector(`[title="정산금액"]`)!.parentElement!;
  await act(async () => field.querySelector<HTMLElement>(".cursor-pointer")!.click());
  const input = field.querySelector<HTMLInputElement>("input")!;
  expect(input).toBeTruthy();
  input.value = value;
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}
const deleteButton = (cardIndex: number) => cards()[cardIndex].querySelector<HTMLButtonElement>('button[title*="삭제"]');

async function mount(Panel: ReturnType<typeof panelFor>, props: ReturnType<typeof panelProps>) {
  await act(async () => root.render(<Panel {...props} />));
  await settle();
}

describe("정산정보 탭 — 비어 있는 회사의 첫 입력란", () => {
  it("계약 줄이 아직 없는 회사도 1차 정산 초안 한 장을 보여 주고 열기만 해서는 아무것도 저장하지 않는다", async () => {
    const save = newSave(); const create = newCreate();
    await mount(panelFor(save, create), panelProps([]));
    expect(cards()).toHaveLength(1);
    expect(cardLabel(0)).toBe("1차정산");
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  for (const [name, row] of [
    ["정산정보 칸이 아예 없음", {}],
    ["정산정보가 빈 배열 글자", { 정산정보: "[]" }],
    ["정산정보가 빈 글자", { 정산정보: "" }],
    ["정산정보가 null", { 정산정보: null }],
  ] as const) {
    it(`계약 줄은 있으나 정산 차수가 없는 회사(${name})도 초안 한 장이고 열기만 해서는 저장 0번이다`, async () => {
      const save = newSave(); const create = newCreate();
      await mount(panelFor(save, create), panelProps([ownerRow("first", { ...row })]));
      expect(cards()).toHaveLength(1);
      expect(cardLabel(0)).toBe("1차정산");
      expect(save).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  }

  it("추가 버튼은 2차부터 「+ 2차 정산 추가」이고 「1차 정산 추가」는 나오지 않는다", async () => {
    await mount(panelFor(newSave(), newCreate()), panelProps([ownerRow("first", { 정산정보: "[]" })]));
    expect(buttonEndingWith("2차 정산 추가")).toBeTruthy();
    expect(buttonEndingWith("1차 정산 추가")).toBeUndefined();
  });

  it("초안 카드에는 휴지통이 없다", async () => {
    await mount(panelFor(newSave(), newCreate()), panelProps([ownerRow("first", { 정산정보: "[]" })]));
    expect(cards()).toHaveLength(1);
    expect(deleteButton(0)).toBeNull();
  });

  it("초안의 금액을 고치면 그 계약 줄의 정산정보에 차수 하나로 한 번 저장한다", async () => {
    const save = newSave(); const create = newCreate();
    await mount(panelFor(save, create), panelProps([ownerRow("first", { 정산정보: "[]" })]));
    await editAmount(0, "300");
    expect(create).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    const [entryId, key, raw, options] = save.mock.calls[0];
    expect(entryId).toBe("first");
    expect(key).toBe("정산정보");
    const tiers = JSON.parse(String(raw));
    expect(tiers).toHaveLength(1);
    expect(tiers[0].정산금액).toBe(300);
    expect(options).toBeUndefined();
  });

  it("계약 줄이 없을 때 초안의 금액을 고치면 그때서야 계약 줄을 한 번 만들어 거기에 저장한다", async () => {
    const save = newSave(); const create = newCreate();
    await mount(panelFor(save, create), panelProps([]));
    expect(create).not.toHaveBeenCalled();
    await editAmount(0, "300");
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("created-first");
    expect(save.mock.calls[0][1]).toBe("정산정보");
    expect(JSON.parse(String(save.mock.calls[0][2]))).toHaveLength(1);
  });

  it("초안이 보이는 동안 「+ 2차 정산 추가」를 누르면 초안과 2차 두 장을 한 번 저장한다", async () => {
    const save = newSave();
    await mount(panelFor(save, newCreate()), panelProps([ownerRow("first", { 정산정보: "[]" })]));
    await click(buttonEndingWith("2차 정산 추가"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe("정산정보");
    expect(JSON.parse(String(save.mock.calls[0][2]))).toHaveLength(2);
  });

  it("보기만 가능한 화면(editable 아님)에서도 초안은 보이지만 저장·계약 줄 만들기·추가 버튼은 없다", async () => {
    const save = newSave(); const create = newCreate();
    await mount(panelFor(save, create, { editable: false }), panelProps([ownerRow("first", { 정산정보: "[]" })]));
    expect(cards()).toHaveLength(1);
    expect(buttonEndingWith("2차 정산 추가")).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("정산정보 탭 — 마지막 차수를 지운 뒤", () => {
  it("저장된 차수가 하나뿐일 때 지우면 빈 배열 한 번만 저장하고 안내문에 빈 첫 입력칸이 다시 나타난다고 적고 새 초안을 보여 준다", async () => {
    const save = newSave();
    const rows = [ownerRow("first", { 정산정보: JSON.stringify([settlementTier("one", 100)]) })];
    await mount(panelFor(save, newCreate()), panelProps(rows));
    expect(cards()).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    await click(deleteButton(0));
    expect(save).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(DRAFT_NOTE);
    await click(document.querySelector('[role="dialog"] button.bg-wedly-red'));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 3)).toEqual(["first", "정산정보", "[]"]);
    // 저장이 끝났다고 부모가 비어 있는 새 자료를 다시 내려 주면(실제 흐름) 같은 초안 한 장이 남는다.
    const Panel = panelFor(save, newCreate());
    await act(async () => root.render(<Panel {...panelProps([ownerRow("first", { 정산정보: "[]" })])} />));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(cards()).toHaveLength(1);
    expect(cardLabel(0)).toBe("1차정산");
    expect(deleteButton(0)).toBeNull();
    expect(buttonEndingWith("2차 정산 추가")).toBeTruthy();
  });
});

describe("정산정보 탭 — 여러 계약 줄을 합쳐 보는 회사", () => {
  it("모든 줄이 비어 있으면 초안 한 장만 보이고, 고치면 대표(첫) 줄에만 저장한다", async () => {
    const save = newSave(); const create = newCreate();
    const rows = [ownerRow("first", { 정산정보: "[]" }), ownerRow("second", {})];
    await mount(panelFor(save, create), panelProps(rows));
    expect(cards()).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    await editAmount(0, "300");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("first");
    expect(save.mock.calls[0][1]).toBe("정산정보");
    expect(JSON.parse(String(save.mock.calls[0][2]))).toHaveLength(1);
    expect(save.mock.calls.some((call) => call[0] === "second")).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("다른 줄에 저장된 정산 차수가 있으면 초안을 더 만들지 않고 그 차수 한 장만 보이며 열기만 해서는 저장하지 않는다", async () => {
    const save = newSave();
    const rows = [ownerRow("first", { 정산정보: "[]" }), ownerRow("second", { 정산정보: JSON.stringify([settlementTier("two-a", 700)]) })];
    await mount(panelFor(save, newCreate()), panelProps(rows));
    expect(cards()).toHaveLength(1);
    expect(deleteButton(0)).not.toBeNull();
    expect(buttonEndingWith("2차 정산 추가")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("다른 줄의 마지막 차수를 지우면 그 줄에만 빈 배열을 저장하고 대표 줄은 건드리지 않는다", async () => {
    const save = newSave();
    const rows = [ownerRow("first", { 정산정보: "[]" }), ownerRow("second", { 정산정보: JSON.stringify([settlementTier("two-a", 700)]) })];
    await mount(panelFor(save, newCreate()), panelProps(rows));
    await click(deleteButton(0));
    await click(document.querySelector('[role="dialog"] button.bg-wedly-red'));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 3)).toEqual(["second", "정산정보", "[]"]);
    expect(cards()).toHaveLength(1);
    expect(deleteButton(0)).toBeNull();
  });

  it("정산 완료 표시(renderTierBadge)는 저장된 차수에만 붙고 원래 줄·원래 차수 id 로 불린다 — 초안에는 붙지 않는다", async () => {
    const badge = vi.fn(() => null);
    const rows = [ownerRow("first", { 정산정보: "[]" }), ownerRow("second", { 정산정보: JSON.stringify([settlementTier("two-a", 700)]) })];
    await mount(panelFor(newSave(), newCreate(), { renderTierBadge: badge }), panelProps(rows));
    const settlementCalls = badge.mock.calls.map((call) => (call as unknown as [Record<string, unknown>])[0]).filter((arg) => arg.kind === "settlement");
    expect(settlementCalls.length).toBeGreaterThan(0);
    for (const arg of settlementCalls) {
      expect(arg.entryId).toBe("second");
      expect(arg.tierId).toBe("two-a");
    }

    badge.mockClear();
    await mount(panelFor(newSave(), newCreate(), { renderTierBadge: badge }), panelProps([ownerRow("first", { 정산정보: "[]" })]));
    expect(cards()).toHaveLength(1);
    expect(badge.mock.calls.map((call) => (call as unknown as [Record<string, unknown>])[0]).filter((arg) => arg.kind === "settlement")).toEqual([]);
  });
});

describe("정산정보 탭 — 서버 수수료 표시가 있는 회사", () => {
  function feeView(entryId: string): FeePublicViewV1 {
    return {
      version: 1, mode: "standard", owner: { sourceTable: "PolicyFundEntry", entryId }, targets: [],
    } as unknown as FeePublicViewV1;
  }

  it("수수료 표시가 있는 계약 줄이어도 초안은 열기만 해서는 저장하지 않고, 일반 칸을 고치면 그 줄에 저장한다", async () => {
    const save = newSave();
    await mount(panelFor(save, newCreate()), panelProps([ownerRow("first", { 정산정보: "[]" }, feeView("first"))]));
    expect(cards()).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    await editAmount(0, "300");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 2)).toEqual(["first", "정산정보"]);
  });

  it("서버가 정하는 칸은 아직 저장되지 않은 초안에서 값 대신 이유를 보여 주고 열기만 해서는 저장하지 않는다", async () => {
    fieldDefs = [{ key: "정산금액", label: "정산금액", type: "number", feeServerManaged: true }, FIELDS[1]];
    const save = newSave(); const create = newCreate();
    await mount(panelFor(save, create), panelProps([ownerRow("first", { 정산정보: "[]" }, feeView("first"))]));
    expect(cards()).toHaveLength(1);
    expect(host.textContent).toContain("새로 만든 차수라 수수료 기준을 아직 찾을 수 없어요");
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
