// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SectionPanelProps, FeePublicViewV1 } from "@wedly/ui-shared";
import { createGovSubsidyPanel } from "./GovSubsidyPanel";

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
async function renderRecovery(panel: React.ReactNode) {
  await act(async () => root.render(panel));
  const tab = [...host.querySelectorAll("button")].find(b => b.textContent === "계약정보");
  if (tab) await act(async () => tab.click());
}
function recoveryPanel(save: (...args: unknown[]) => Promise<void>) {
  return createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua",
    commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract",
    settlementFieldsPath: "/recovery-fields-settlement", refundFieldsPath: "/recovery-fields-refund",
    configPath: "/recovery-config", savePolicyField: save, filterPolicyRows: rows => rows });
}
function recoveryProps() {
  return { rows: [owner()] as unknown as SectionPanelProps["rows"], primaryRow: { _id: "customer-one" },
    isAdmin: true, hideSubTabBar: true, subTab: "contract", onSubTabChange: vi.fn(), onSaved: vi.fn(),
    adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"] };
}
function ordinaryFields() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true,
    data: String(url).includes("fields") ? [...fields, { key: "담당컨설턴트", label: "담당자", type: "text" }] : {} }) })));
}
async function editRecoveryField(label: string, value: string) {
  const field = host.querySelector(`[title="${label}"]`)!.parentElement!;
  await act(async () => field.querySelector<HTMLElement>(".cursor-pointer")!.click());
  const input = field.querySelector<HTMLInputElement>("input")!;
  expect(input).toBeTruthy(); input.value = value;
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}
async function expectRecoveryFieldLocked(label: string) {
  const field = host.querySelector(`[title="${label}"]`)!.parentElement!;
  const clicker = field.querySelector<HTMLElement>(".cursor-pointer");
  if (clicker) await act(async () => clicker.click());
  expect(field.querySelector("input")).toBeNull();
}

it("ordinary input waits for its exact saved field despite unrelated fee and raw refreshes", async () => {
  ordinaryFields();
  let resolveSave!: () => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise<void>(resolve => { resolveSave = resolve; })).mockResolvedValue(undefined);
  const Panel = recoveryPanel(save), props = recoveryProps();
  await renderRecovery(<Panel {...props} />);
  await editRecoveryField("담당자", "새 담당"); expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][3]).toBeUndefined();
  const unrelated = owner();
  unrelated.row.계약정보_차수 = JSON.stringify([{ id: "one", 계약금: 150, 담당컨설턴트: "기존" }]);
  unrelated.feeView = { ...unrelated.feeView, targets: [{ ...unrelated.feeView.targets[0], edits: { 계약금: { status: "ready", eventVersion: requestId } } }] } as FeePublicViewV1;
  await renderRecovery(<Panel {...props} rows={[unrelated] as unknown as SectionPanelProps["rows"]} />);
  await act(async () => resolveSave());
  expect(props.onSaved).toHaveBeenCalledTimes(1);
  await expectRecoveryFieldLocked("담당자"); expect(save).toHaveBeenCalledTimes(1);
  const acknowledged = owner();
  // An untouched amount may change concurrently; only the requested changes must match.
  acknowledged.row.계약정보_차수 = JSON.stringify([{ ...JSON.parse(save.mock.calls[0][2] as string)[0], 계약금: 150 }]);
  await renderRecovery(<Panel {...props} rows={[acknowledged] as unknown as SectionPanelProps["rows"]} />);
  await editRecoveryField("담당자", "다음 담당"); expect(save).toHaveBeenCalledTimes(2);
  expect(JSON.parse(save.mock.calls[1][2] as string)[0]).toMatchObject({ id: "one", 계약금: 150, 담당컨설턴트: "다음 담당" });
});

for (const phase of ["pending", "success-wait"] as const) {
  it(`preserves ${phase} writes when the same logical panel unmounts and remounts`, async () => {
    let resolveSave!: () => void;
    const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise<void>(resolve => { resolveSave = resolve; })).mockResolvedValue(undefined);
    const Panel = recoveryPanel(save), props = recoveryProps();
    await renderRecovery(<Panel {...props} />);
    await editRecoveryField("계약금", "200");
    if (phase === "success-wait") await act(async () => resolveSave());
    await act(async () => root.render(null));
    await renderRecovery(<Panel {...props} />);
    expect(host.textContent).toContain("저장 중");
    await expectRecoveryFieldLocked("계약금"); expect(save).toHaveBeenCalledTimes(1);
    const acknowledged = owner();
    acknowledged.row.계약정보_차수 = JSON.stringify([{ id: "one", label: "1차", 계약금: 200, 담당컨설턴트: "기존" }]);
    acknowledged.feeView = { ...acknowledged.feeView, targets: [{ ...acknowledged.feeView.targets[0], edits: { 계약금: { status: "ready", eventVersion: requestId } } }] } as FeePublicViewV1;
    await renderRecovery(<Panel {...props} rows={[acknowledged] as unknown as SectionPanelProps["rows"]} />);
    if (phase === "pending") {
      await expectRecoveryFieldLocked("계약금");
      // Completion of the old instance must notify the newly mounted instance.
      await act(async () => resolveSave());
    }
    await editRecoveryField("계약금", "300"); expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][3]).toMatchObject({ feeEdit: { previous: { present: true, value: 200 }, expectedEventVersion: requestId } });
  });
}

it("an old instance failure unlocks the remounted panel and permits a retry", async () => {
  let rejectSave!: (error: Error) => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
  const Panel = recoveryPanel(save), props = recoveryProps();
  await renderRecovery(<Panel {...props} />);
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(null));
  await renderRecovery(<Panel {...props} />);
  await act(async () => rejectSave(new Error("늦은 저장 실패")));
  expect(host.textContent).toContain("늦은 저장 실패");
  await editRecoveryField("계약금", "300"); expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][3]).toMatchObject({ feeEdit: { previous: { present: true, value: 100 } } });
});

it("a late failure for another customer does not reset or display errors in the current panel", async () => {
  let rejectSave!: (error: Error) => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
  const Panel = recoveryPanel(save), props = recoveryProps();
  await renderRecovery(<Panel {...props} />);
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(null));
  // The business anchor and owner can coincide; the logical customer's ID is still distinct.
  await renderRecovery(<Panel {...props} primaryRow={{ _id: "customer-two", "15사업자번호": "shared-anchor" }} />);
  await editRecoveryField("계약금", "300"); expect(save).toHaveBeenCalledTimes(2);
  await act(async () => rejectSave(new Error("이전 회사 실패")));
  expect(host.textContent).not.toContain("이전 회사 실패");
});

it("remount requests missed refresh after unmounted success and keeps the gate until real acknowledgment", async () => {
  let resolveSave!: () => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise<void>(resolve => { resolveSave = resolve; }));
  const Panel = recoveryPanel(save), props = recoveryProps();
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(null));
  await act(async () => resolveSave());
  await act(async () => root.render(<Panel {...props} />));
  expect(props.onSaved).toHaveBeenCalled();
  await expectRecoveryFieldLocked("계약금");
  const latest = owner(); latest.row.계약정보_차수 = JSON.stringify([{ id: "one", 계약금: 200, 담당컨설턴트: "기존" }]);
  latest.feeView = { ...latest.feeView, targets: [{ ...latest.feeView.targets[0], edits: { 계약금: { status: "ready", eventVersion: requestId } } }] } as FeePublicViewV1;
  await act(async () => root.render(<Panel {...props} rows={[latest] as unknown as SectionPanelProps["rows"]} />));
  expect(host.querySelector('[title="계약금"]')!.parentElement!.querySelector('.cursor-pointer')).toBeTruthy();
});
it("empty ERP refund stays empty while a first contract owner is being created", async () => {
  ordinaryFields();
  let resolveCreate!: (id: string) => void;
  const create = vi.fn(() => new Promise<string>(resolve => { resolveCreate = resolve; }));
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua",
    commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract", settlementFieldsPath: "/recovery-fields-settlement",
    refundFieldsPath: "/recovery-fields-refund", configPath: "/recovery-config", createContract: create, savePolicyField: save, filterPolicyRows: rows => rows });
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("담당자", "계약 담당");
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => root.render(<Panel {...props} subTab="refund" />));
  // ERP merges absent owner containers into an explicit empty list. Unlike the partner forks,
  // an empty refund has no implicit first card, so changing tabs must not create or save one.
  expect(host.querySelector('[title="담당자"]')).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  await act(async () => resolveCreate("created-one"));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0].slice(0, 2)).toEqual(["created-one", "계약정보_차수"]);
});
