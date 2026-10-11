// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

type Intent = { version: 1; requestId: string; kind: "field" | "override" | "restore"; tierId: string; fieldKey: string; previous: { present: false } | { present: true; value: unknown } };
const fields: FieldDef[] = [{ key: "계약금", label: "계약금", type: "number" }, { key: "fee", label: "검사 수수료", type: "formula", formula: [{ op: "+", unit: "number", value: 100 }] }];
const props = { storagePrefix: "contract", ensureFirstTier: true, addButtonSuffixOverride: "계약", fieldsApiPath: "/intent-fields", configApiPath: "/intent-config", ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "계약금", ratioFeeLabel: "수수료", defaultScoreCards: [], hideSummaryCards: true };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("real tier edit intent", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saves: { raw: string; intent: Intent | undefined }[];
  let error: ReturnType<typeof vi.spyOn>;
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5));
  async function render(rows: Record<string, unknown>[], readOnly = false, isAdmin = false) {
    await act(async () => { root.render(<StrictMode><SettlementInfoTab {...props} rawValue={JSON.stringify(rows)} readOnly={readOnly} isAdmin={isAdmin} allowFormulaOverride onSave={(raw, intent?: Intent) => saves.push({ raw, intent })} /></StrictMode>); await settle(); });
  }
  async function renderMissing(rawValue: unknown, ensureFirstTier = false) {
    await act(async () => { root.render(<StrictMode><SettlementInfoTab {...props} rawValue={rawValue} ensureFirstTier={ensureFirstTier} onSave={(raw, intent?: Intent) => saves.push({ raw, intent })} /></StrictMode>); await settle(); });
  }
  function cards() { return [...document.querySelectorAll<HTMLDivElement>("div.rounded-2xl.shadow-sm")].filter(card => card.querySelector("h4")); }
  async function click(target: Element | null | undefined) {
    if (!target) throw new Error("Missing actual UI target");
    await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); await settle(); });
  }
  async function edit(index: number, value: string) {
    const card = cards()[index];
    await click(card?.querySelector('[title="계약금"]')?.parentElement?.querySelector(".cursor-pointer"));
    const input = card.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error("Missing actual money editor");
    await act(async () => { input.value = value; input.blur(); await settle(); });
  }
  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); saves = [];
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => ({ ok: true, json: async () => ({ success: true, data: String(input).includes("fields") ? fields : {} }) })));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); error.mockRestore(); vi.unstubAllGlobals(); });
  it("emits one exact intent even when the entered amount is the same", async () => {
    await render([{ id: "one", label: "1차 계약", 계약금: 1100000 }]); expect(saves).toEqual([]);
    await edit(0, "1100000"); expect(saves).toHaveLength(1);
    expect(saves[0].intent).toMatchObject({ version: 1, kind: "field", tierId: "one", fieldKey: "계약금", previous: { present: true, value: 1100000 } });
    expect(saves[0].intent?.requestId).toMatch(uuid);
    expect(Object.keys(saves[0].intent ?? {}).sort()).toEqual(["version", "requestId", "kind", "tierId", "fieldKey", "previous"].sort());
  });
  it.each([{ present: false }, { present: true, value: null }, { present: true, value: "" }, { present: true, value: 0 }])("retains previous own presence and raw value %j", async previous => {
    await render([{ id: "one", label: "1차 계약", ...(previous.present ? { 계약금: previous.value } : {}) }]);
    await edit(0, "123"); expect(saves).toHaveLength(1); expect(saves[0].intent?.previous).toEqual(previous);
  });
  it("uses original tier identity under reversed display order and refresh", async () => {
    await render([{ id: "old", 계약금: 100 }]);
    await render([{ id: "first", label: "1차 계약", 계약금: 300 }, { id: "second", label: "2차 계약", 계약금: 400 }]);
    expect(saves).toEqual([]); await edit(0, "500");
    expect(saves[0].intent).toMatchObject({ tierId: "second", previous: { present: true, value: 400 } });
    expect(JSON.parse(saves[0].raw).map((tier: Record<string, unknown>) => tier.계약금)).toEqual([300, 500]);
  });
  it("allocates another request id only for a separate actual edit", async () => {
    await render([{ id: "one", 계약금: 100 }]); await edit(0, "200");
    const first = saves[0].intent; await edit(0, "300");
    expect(saves).toHaveLength(2); expect(first?.requestId).toMatch(uuid); expect(saves[1].intent?.requestId).toMatch(uuid);
    expect(saves[1].intent?.requestId).not.toBe(first?.requestId);
    expect(first?.previous).toEqual({ present: true, value: 100 });
    expect(saves[1].intent?.previous).toEqual({ present: true, value: 200 });
  });
  it("does not attach a field intent to structural add or initial/read-only render", async () => {
    await render([{ id: "one", label: "1차 계약", 계약금: 100 }]);
    const button = [...document.querySelectorAll("button")].find(item => item.textContent?.replace(/\s/g, "").endsWith("2차계약추가"));
    await click(button); expect(saves).toHaveLength(1); expect(saves[0].intent).toBeUndefined();
    saves = []; await render([{ id: "readonly", 계약금: 100 }], true); expect(saves).toEqual([]);
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  async function formulaInput() {
    const card = cards()[0];
    await click(card.querySelector('[title="검사 수수료"]')?.parentElement?.querySelector(".cursor-pointer"));
    const input = card.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error("Missing actual formula override editor");
    return input;
  }
  it("manual formula edit captures its actual override slot and own raw previous value", async () => {
    await render([{ id: "one", 계약금: 1000, _ovr_fee: 25 }], false, true);
    const input = await formulaInput();
    await act(async () => { input.value = "50"; input.blur(); await settle(); });
    expect(saves).toHaveLength(1);
    expect(saves[0].intent).toMatchObject({ kind: "override", tierId: "one", fieldKey: "_ovr_fee", previous: { present: true, value: 25 } });
    expect(JSON.parse(saves[0].raw)[0]._ovr_fee).toBe(50);
  });
  it("restore has a distinct intent and removes only the override", async () => {
    await render([{ id: "one", 계약금: 1000, _ovr_fee: 25 }], false, true);
    await formulaInput();
    const button = [...document.querySelectorAll("button")].find(item => item.textContent === "수식값으로 복원");
    if (!button) throw new Error("Missing restore button");
    await act(async () => { button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); await settle(); });
    expect(saves).toHaveLength(1);
    expect(saves[0].intent).toMatchObject({ kind: "restore", fieldKey: "_ovr_fee", previous: { present: true, value: 25 } });
    expect(JSON.parse(saves[0].raw)[0]).not.toHaveProperty("_ovr_fee");
  });
  it("looking at a formula and leaving it unchanged does not make it a manual amount", async () => {
    await render([{ id: "one", 계약금: 1000 }], false, true);
    const input = await formulaInput();
    await act(async () => { input.blur(); await settle(); });
    expect(saves).toEqual([]);
  });

  it.each([null, undefined, ""])('first edit of a missing source %j has no stored previous amount', async raw => {
    await renderMissing(raw); expect(saves).toEqual([]);
    await edit(0, "123"); expect(saves).toHaveLength(1);
    expect(saves[0].intent?.previous).toEqual({ present: false });
    expect(saves[0].intent?.tierId).toBe(JSON.parse(saves[0].raw)[0].id);
  });
  it("first edit after deleting the last tier records the new draft before the parent refreshes", async () => {
    await render([{ id: "one", 계약금: 100 }]);
    await click(cards()[0].querySelector('button[title*="삭제"]'));
    await click(document.querySelector('[role="dialog"] button.bg-wedly-red'));
    expect(saves).toHaveLength(1); expect(JSON.parse(saves[0].raw)).toEqual([]); expect(saves[0].intent).toBeUndefined();
    await edit(0, "123"); expect(saves).toHaveLength(2);
    expect(saves[1].intent?.previous).toEqual({ present: false });
    expect(saves[1].intent?.tierId).toBe(JSON.parse(saves[1].raw)[0].id);
    expect(saves[1].intent?.tierId).not.toBe("one");
  });

  it("first unsaved draft reports no previous stored amount even when its display has null defaults", async () => {
    await render([]); expect(saves).toEqual([]);
    await edit(0, "1100000"); expect(saves).toHaveLength(1);
    expect(saves[0].intent?.previous).toEqual({ present: false });
    expect(saves[0].intent?.tierId).toBe(JSON.parse(saves[0].raw)[0].id);
  });
});
