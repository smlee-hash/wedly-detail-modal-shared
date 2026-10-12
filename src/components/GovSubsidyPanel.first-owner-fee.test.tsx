// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SectionPanelProps, FeePublicViewV1 } from "@wedly/ui-shared";
import { DetailLoadStateProvider } from "@wedly/ui-shared";
import { createGovSubsidyPanel } from "./GovSubsidyPanel";

const fields = [{ key: "계약금", label: "계약금", type: "number" }];
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
function recoveryProps() {
  return { rows: [owner()] as unknown as SectionPanelProps["rows"], primaryRow: { _id: "customer-one" },
    isAdmin: true, hideSubTabBar: true, subTab: "contract", onSubTabChange: vi.fn(), onSaved: vi.fn(),
    adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"] };
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

function newlyCreatedOwner(mode: "standard" | "blocked" | "missing" = "standard") {
  const fresh = owner();
  fresh.entryId = "created-first";
  fresh.row = {} as typeof fresh.row;
  fresh.feeView = mode === "missing" ? undefined as unknown as FeePublicViewV1 : {
    version: 1, mode, owner: { sourceTable: "PolicyFundEntry", entryId: fresh.entryId }, targets: [],
    ...(mode === "blocked" ? { reason: "fee-context-invalid", message: "계산 기준을 확인해 주세요." } : {}),
  } as FeePublicViewV1;
  return fresh;
}
function firstOwnerPanel(save: (...args: unknown[]) => Promise<void>, create: () => Promise<string>) {
  return createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua",
    commentsPath: id => `/comments/${id}`, contractFieldsPath: "/recovery-fields-contract",
    settlementFieldsPath: "/recovery-fields-settlement", refundFieldsPath: "/recovery-fields-refund",
    configPath: "/recovery-config", savePolicyField: save, createContract: create, filterPolicyRows: rows => rows });
}
it("first owner amount waits for the real created owner and sends an explicit fee edit", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const create = vi.fn(async () => "created-first");
  const Panel = firstOwnerPanel(save, create);
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  expect(create).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  expect(props.onSaved).toHaveBeenCalled();
  await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
  expect(save).toHaveBeenCalledTimes(1);
  const [id, key, raw, options] = save.mock.calls[0];
  const tier = JSON.parse(String(raw))[0];
  expect(id).toBe("created-first"); expect(key).toBe("계약정보_차수"); expect(tier.계약금).toBe(200);
  expect(options).toMatchObject({ feeEdit: { version: 1, requestId: expect.any(String),
    selection: { sourceTable: "PolicyFundEntry", entryId: "created-first", containerKey: "계약정보_차수", tierId: tier.id, fieldKey: "계약금" },
    previous: { present: false }, expectedEventVersion: null,
  } });
  await expectRecoveryFieldLocked("계약금");
});
for (const mode of ["blocked", "missing"] as const) {
  it(`first owner amount never falls back to an ordinary write when observation is ${mode}`, async () => {
    const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const Panel = firstOwnerPanel(save, async () => "created-first");
    const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
    await act(async () => root.render(<Panel {...props} />));
    await editRecoveryField("계약금", "200");
    await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner(mode)] as unknown as SectionPanelProps["rows"]} />));
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("저장하지 않았습니다");
  });
}
it("first owner amount cannot use another owner returned by the refresh", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, async () => "created-first");
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(<Panel {...props} rows={[owner()] as unknown as SectionPanelProps["rows"]} />));
  expect(save).not.toHaveBeenCalled();
  await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toBe("created-first");
});
it("first owner amount preserves a concurrently populated created contract", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, async () => "created-first");
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  const fresh = newlyCreatedOwner(); fresh.row.계약정보_차수 = JSON.stringify([{ id: "another-writer", 계약금: 700, 메모: "보존" }]);
  await act(async () => root.render(<Panel {...props} rows={[fresh] as unknown as SectionPanelProps["rows"]} />));
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("저장하지 않았습니다");
});

it("first owner amount resumes after remount without refreshing a different customer", async () => {
  let resolveCreate!: (id: string) => void;
  const create = vi.fn(() => new Promise<string>(resolve => { resolveCreate = resolve; }));
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, create);
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(null));
  const otherSaved = vi.fn();
  await act(async () => root.render(<Panel {...props} primaryRow={{ _id: "another-customer" }} onSaved={otherSaved} />));
  await act(async () => resolveCreate("created-first"));
  expect(save).not.toHaveBeenCalled(); expect(otherSaved).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  await act(async () => root.render(<Panel {...props} />));
  expect(props.onSaved).toHaveBeenCalled();
  await expectRecoveryFieldLocked("계약금");
  await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
  expect(save).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][3]).toMatchObject({ feeEdit: { selection: { entryId: "created-first" } } });
});

it("first owner amount uses rows that arrive before the creation response", async () => {
  let resolveCreate!: (id: string) => void;
  const create = vi.fn(() => new Promise<string>(resolve => { resolveCreate = resolve; }));
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, create);
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
  expect(save).not.toHaveBeenCalled();
  await act(async () => resolveCreate("created-first"));
  expect(save).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][3]).toMatchObject({ feeEdit: { selection: { entryId: "created-first" } } });
});

it("first owner observation deadline rejects the write and a retry reuses the created owner", async () => {
  const create = vi.fn(async () => "created-first");
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, create);
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  vi.useFakeTimers();
  try {
    await editRecoveryField("계약금", "200");
    await act(async () => vi.advanceTimersByTimeAsync(20_001));
    expect(save).not.toHaveBeenCalled(); expect(host.textContent).toContain("20초");
    await editRecoveryField("계약금", "300");
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(save.mock.calls[0][2]))[0].계약금).toBe(300);
  } finally { vi.useRealTimers(); }
});

it("closed first-owner panel pauses its observation deadline and resumes the original amount", async () => {
  let resolveCreate!: (id: string) => void;
  const create = vi.fn(() => new Promise<string>(resolve => { resolveCreate = resolve; }));
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, create);
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  vi.useFakeTimers();
  try {
    await editRecoveryField("계약금", "200");
    await act(async () => root.render(null));
    await act(async () => resolveCreate("created-first"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(save).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
    await act(async () => root.render(<Panel {...props} />));
    expect(props.onSaved).toHaveBeenCalledTimes(1);
    await expectRecoveryFieldLocked("계약금");
    await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
    expect(create).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(save.mock.calls[0][2]))[0].계약금).toBe(200);
    expect(save.mock.calls[0][3]).toMatchObject({ feeEdit: { previous: { present: false }, expectedEventVersion: null } });
  } finally { vi.useRealTimers(); }
});
it("first-owner observation retains its remaining active deadline across a closed interval", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const create = vi.fn(async () => "created-first");
  const Panel = firstOwnerPanel(save, create);
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  vi.useFakeTimers();
  try {
    await editRecoveryField("계약금", "200");
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await act(async () => root.render(<Panel {...props} />));
    await expectRecoveryFieldLocked("계약금");
    await act(async () => vi.advanceTimersByTimeAsync(8_001));
    expect(save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("20초");
    await editRecoveryField("계약금", "300");
    expect(create).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it("first owner save rejection stays visible after the real owner appears", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockRejectedValue(new Error("서버 거부"));
  const Panel = firstOwnerPanel(save, async () => "created-first");
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
  expect(save).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("서버 거부");
});

it("closed first-owner rejection remains visible only for that customer and clears on its retry", async () => {
  let rejectSave!: (e: Error) => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, async () => "created-first");
  const props = { ...recoveryProps(), rows: [] as SectionPanelProps["rows"] };
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  const rows = [newlyCreatedOwner()] as unknown as SectionPanelProps["rows"];
  await act(async () => root.render(<Panel {...props} rows={rows} />));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => rejectSave(new Error("닫힌 동안 서버 거부")));
  await act(async () => root.render(<Panel {...props} primaryRow={{ _id: "other-customer" }} rows={rows} />));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.render(null));
  await act(async () => root.render(<Panel {...props} rows={rows} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("닫힌 동안 서버 거부");
  await editRecoveryField("계약금", "300");
  expect(save).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("닫힌 동안 서버 거부");
});

it("closed existing-owner rejection remains visible after reopening the exact owner", async () => {
  let rejectSave!: (e: Error) => void;
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
  const Panel = firstOwnerPanel(save, async () => "must-not-create");
  const props = recoveryProps();
  await act(async () => root.render(<Panel {...props} />));
  await editRecoveryField("계약금", "200");
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => rejectSave(new Error("기존 줄 서버 거부")));
  await act(async () => root.render(<Panel {...props} rows={[newlyCreatedOwner()] as unknown as SectionPanelProps["rows"]} />));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.render(<Panel {...props} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("기존 줄 서버 거부");
});

it("host context exposes reload failure after a successful write and retains the observation lock", async () => {
  const save = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
  const Panel = firstOwnerPanel(save, async () => "must-not-create");
  let markFailed!: (failed: boolean) => void;
  const onSaved = vi.fn(() => { markFailed(true); }); // real host callback returns void
  const props = { ...recoveryProps(), onSaved };
  function Host() {
    const [failed, setFailed] = React.useState(false); markFailed = setFailed;
    return <DetailLoadStateProvider rowsLoadFailed={failed}><Panel {...props} /></DetailLoadStateProvider>;
  }
  await act(async () => root.render(<Host />));
  const tab = [...host.querySelectorAll("button")].find(b => b.textContent === "계약정보");
  if (tab) await act(async () => tab.click());
  await editRecoveryField("계약금", "200");
  expect(save).toHaveBeenCalledTimes(1); expect(onSaved).toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("저장된 값을 다시 불러오지 못했습니다");
  await expectRecoveryFieldLocked("계약금");
  await act(async () => markFailed(false));
  expect(host.textContent).not.toContain("저장된 값을 다시 불러오지 못했습니다");
  await expectRecoveryFieldLocked("계약금"); // a cleared error alone is not proof of saved values
});
