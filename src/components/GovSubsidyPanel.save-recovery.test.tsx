// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SectionPanelProps, FeePublicViewV1 } from "@wedly/ui-shared";
import { createGovSubsidyPanel } from "./GovSubsidyPanel";
import { bindGovFeeEdit } from "./gov-fee-edit-binding";

const fields = [{ key: "계약금", label: "계약금", type: "number" }];
const requestId = "40000000-0000-4000-8000-000000000001";
function owner() {
  return { domain: "government-subsidy", entryId: "first", domainLabel: "정부지원금", row: { 계약정보_차수: JSON.stringify([{ id: "one", 계약금: 100, 담당컨설턴트: "기존" }]) },
    feeView: { version: 1, mode: "standard", owner: { sourceTable: "PolicyFundEntry", entryId: "first" }, targets: [{ scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: "one" }, status: "blocked", fields: {}, edits: { 계약금: { status: "ready", eventVersion: null } } }] } as FeePublicViewV1 };
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : {} }) })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("failed actual input can be edited again from saved raw value after an identical refetch", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockRejectedValueOnce(new Error("실제 저장 실패")).mockResolvedValue(undefined);
  const onSaved = vi.fn();
  const Panel = createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua", commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract", settlementFieldsPath: "/recovery-fields-settlement", refundFieldsPath: "/recovery-fields-refund", configPath: "/recovery-config", savePolicyField: save, filterPolicyRows: rows => rows });
  const adapter = { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"];
  const props = { rows: [owner()] as unknown as SectionPanelProps["rows"], primaryRow: {}, isAdmin: true, adapter, onSaved };
  await act(async () => { root.render(<Panel {...props} />); await new Promise(r => setTimeout(r, 20)); });
  const tab = [...host.querySelectorAll("button")].find(b => b.textContent === "계약정보"); expect(tab).toBeTruthy();
  await act(async () => { tab!.click(); await new Promise(r => setTimeout(r, 20)); });
  async function change(amount: string) {
    const row = host.querySelector('[title="계약금"]')!.parentElement!;
    const clicker = row.querySelector<HTMLElement>('.cursor-pointer'); expect(clicker).toBeTruthy();
    await act(async () => clicker!.click());
    const input = row.querySelector<HTMLInputElement>('input[type="number"]'); expect(input).toBeTruthy();
    input!.value = amount;
    await act(async () => { input!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); await new Promise(r => setTimeout(r, 20)); });
  }
  await change("200"); expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { root.render(<Panel {...props} rows={[owner()] as unknown as SectionPanelProps["rows"]} />); });
  await change("300");
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][3]).toMatchObject({ feeEdit: { previous: { present: true, value: 100 } } });
  expect(onSaved).toHaveBeenCalled();
});

it("a blocked fee view does not block an ordinary field on the already identified owner", () => {
  const source = owner(); source.feeView = { version: 1, mode: "blocked", reason: "fee-context-invalid", message: "단위 확인 필요", owner: { sourceTable: "PolicyFundEntry", entryId: "first" }, targets: [] } as FeePublicViewV1;
  expect(bindGovFeeEdit([source], "계약정보_차수", [{ id: "gm0~one", 계약금: 100, 담당컨설턴트: "새 담당" }], {
    version: 1, requestId, kind: "field", tierId: "gm0~one", fieldKey: "담당컨설턴트", previous: { present: true, value: "기존" },
  })).toEqual({ entryId: "first" });
});

for (const fieldKey of ["계약금", "_ovr_[컨설턴트]_수수료"]) {
  it(`keeps sensitive ${fieldKey} blocked without a ready fee observation`, () => {
    const source = owner(); source.feeView = { version: 1, mode: "blocked", reason: "fee-context-invalid", message: "단위 확인 필요", owner: { sourceTable: "PolicyFundEntry", entryId: "first" }, targets: [] } as FeePublicViewV1;
    expect(() => bindGovFeeEdit([source], "계약정보_차수", [{ id: "gm0~one", 계약금: 200, [fieldKey]: 200 }], {
      version: 1, requestId, kind: fieldKey.startsWith("_ovr_") ? "override" : "field", tierId: "gm0~one", fieldKey,
      previous: fieldKey === "계약금" ? { present: true, value: 100 } : { present: false },
    })).toThrow();
  });
}

it("prevents overlapping actual money edits while the first save is pending", async () => {
  let rejectFirst!: (e: Error) => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; })).mockResolvedValue(undefined);
  const Panel = createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua", commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract", settlementFieldsPath: "/recovery-fields-settlement", refundFieldsPath: "/recovery-fields-refund", configPath: "/recovery-config", savePolicyField: save, filterPolicyRows: rows => rows });
  const adapter = { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"];
  const props = { rows: [owner()] as unknown as SectionPanelProps["rows"], primaryRow: {}, isAdmin: true, adapter };
  await act(async () => { root.render(<Panel {...props} />); await new Promise(r => setTimeout(r, 20)); });
  const tab = [...host.querySelectorAll("button")].find(b => b.textContent === "계약정보");
  await act(async () => { tab!.click(); await new Promise(r => setTimeout(r, 20)); });
  const fieldRow = host.querySelector('[title="계약금"]')!.parentElement!;
  await act(async () => fieldRow.querySelector<HTMLElement>('.cursor-pointer')!.click());
  const input = fieldRow.querySelector<HTMLInputElement>('input[type="number"]')!; input.value = "200";
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("저장 중");
  const nextClick = host.querySelector('[title="계약금"]')!.parentElement!.querySelector<HTMLElement>('.cursor-pointer');
  if (nextClick) await act(async () => nextClick.click());
  expect(host.querySelector('[title="계약금"]')!.parentElement!.querySelector('input[type="number"]')).toBeNull();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => rejectFirst(new Error("첫 저장 실패")));
  const restored = host.querySelector('[title="계약금"]')!.parentElement!;
  await act(async () => restored.querySelector<HTMLElement>('.cursor-pointer')!.click());
  const retry = restored.querySelector<HTMLInputElement>('input[type="number"]')!; expect(retry.value).toBe("100"); retry.value = "300";
  await act(async () => { retry.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][3]).toMatchObject({ feeEdit: { previous: { present: true, value: 100 } } });
});


it("does not submit an editor opened before the saved raw amount and event were refreshed", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua", commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract", settlementFieldsPath: "/recovery-fields-settlement", refundFieldsPath: "/recovery-fields-refund", configPath: "/recovery-config", savePolicyField: save, filterPolicyRows: rows => rows });
  const adapter = { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"];
  const props = { rows: [owner()] as unknown as SectionPanelProps["rows"], primaryRow: {}, isAdmin: true, adapter };
  await act(async () => { root.render(<Panel {...props} />); await new Promise(r => setTimeout(r, 20)); });
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "계약정보")!.click(); await new Promise(r => setTimeout(r, 20)); });
  await act(async () => host.querySelector('[title="계약금"]')!.parentElement!.querySelector<HTMLElement>('.cursor-pointer')!.click());
  const editingInput = host.querySelector<HTMLInputElement>('input[type="number"]')!; editingInput.value = "200";
  const newer = owner(); newer.row.계약정보_차수 = JSON.stringify([{ id: "one", 계약금: 150, 담당컨설턴트: "기존" }]);
  newer.feeView = { ...newer.feeView, targets: [{ ...newer.feeView.targets[0], edits: { 계약금: { status: "ready", eventVersion: "40000000-0000-4000-8000-000000000002" } } }] } as FeePublicViewV1;
  await act(async () => root.render(<Panel {...props} rows={[newer] as unknown as SectionPanelProps["rows"]} />));
  await act(async () => { editingInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(save).not.toHaveBeenCalled();
});

it("keeps the next money input closed after save success until the fresh saved basis arrives", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const onSaved = vi.fn();
  const Panel = createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua", commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract", settlementFieldsPath: "/recovery-fields-settlement", refundFieldsPath: "/recovery-fields-refund", configPath: "/recovery-config", savePolicyField: save, filterPolicyRows: rows => rows });
  const adapter = { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"];
  const props = { rows: [owner()] as unknown as SectionPanelProps["rows"], primaryRow: {}, isAdmin: true, adapter, onSaved };
  await act(async () => { root.render(<Panel {...props} />); await new Promise(r => setTimeout(r, 20)); });
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "계약정보")!.click(); await new Promise(r => setTimeout(r, 20)); });
  await act(async () => host.querySelector('[title="계약금"]')!.parentElement!.querySelector<HTMLElement>('.cursor-pointer')!.click());
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!; input.value = "200";
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(save).toHaveBeenCalledTimes(1); expect(onSaved).toHaveBeenCalledTimes(1);
  const premature = host.querySelector('[title="계약금"]')!.parentElement!.querySelector<HTMLElement>('.cursor-pointer');
  if (premature) await act(async () => premature.click());
  expect(host.querySelector('[title="계약금"]')!.parentElement!.querySelector('input[type="number"]')).toBeNull();
  const unrelatedRefresh = owner(); unrelatedRefresh.row.계약정보_차수 = JSON.stringify([{ id: "one", 계약금: 100, 담당컨설턴트: "새 담당" }]);
  await act(async () => root.render(<Panel {...props} rows={[unrelatedRefresh] as unknown as SectionPanelProps["rows"]} />));
  const unrelatedClick = host.querySelector('[title="계약금"]')!.parentElement!.querySelector<HTMLElement>('.cursor-pointer');
  if (unrelatedClick) await act(async () => unrelatedClick.click());
  expect(host.querySelector('[title="계약금"]')!.parentElement!.querySelector('input[type="number"]')).toBeNull();
  const newer = owner(); newer.row.계약정보_차수 = JSON.stringify([{ id: "one", 계약금: 200, 담당컨설턴트: "기존" }]);
  newer.feeView = { ...newer.feeView, targets: [{ ...newer.feeView.targets[0], edits: { 계약금: { status: "ready", eventVersion: "40000000-0000-4000-8000-000000000002" } } }] } as FeePublicViewV1;
  await act(async () => root.render(<Panel {...props} rows={[newer] as unknown as SectionPanelProps["rows"]} />));
  await act(async () => host.querySelector('[title="계약금"]')!.parentElement!.querySelector<HTMLElement>('.cursor-pointer')!.click());
  const next = host.querySelector<HTMLInputElement>('input[type="number"]')!; expect(next.value).toBe("200"); next.value = "300";
  await act(async () => next.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][3]).toMatchObject({ feeEdit: { previous: { present: true, value: 200 }, expectedEventVersion: "40000000-0000-4000-8000-000000000002" } });
});
