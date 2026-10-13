// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

const observedHistory = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@wedly/ui-shared", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, HistoryPanel: ({ pageId, adapter }: { pageId: string; adapter: { fetch: () => Promise<unknown> } }) => {
    observedHistory.ids.push(pageId);
    React.useEffect(() => { void adapter.fetch(); }, [adapter]);
    return <div>기존 상담 기록</div>;
  } };
});
vi.mock("./SettlementInfoTab", () => ({ default: ({ onSave }: { onSave: (raw: string, intent: unknown) => void }) =>
  <button onClick={() => onSave(JSON.stringify([{ id: "new-contract-tier", 계약금: 200 }]), {
    version: 1, requestId: "30000000-0000-4000-8000-000000000001", tierId: "new-contract-tier",
    fieldKey: "계약금", kind: "field", previous: { present: false },
  })}>계약금 저장</button> }));

afterEach(() => { vi.unstubAllGlobals(); observedHistory.ids.length = 0; });

it("무상 상담 기록은 유지하고 첫 계약금은 새 정책 계약 소유자에게만 저장한다", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: [], comments: [] }) }));
  vi.stubGlobal("fetch", fetcher);
  const create = vi.fn(async () => "created-policy");
  const save = vi.fn<NonNullable<GovSubsidyPanelConfig["savePolicyField"]>>(async () => {});
  const onSaved = vi.fn();
  const Panel = createGovSubsidyPanel({
    editable: true, allowStructureEdit: false, ownSource: "erp", commentsPath: id => `/comments/${id}`,
    contractFieldsPath: "/fields-contract", settlementFieldsPath: "/fields-settlement", refundFieldsPath: "/fields-refund",
    configPath: "/config", createContract: create, savePolicyField: save,
    filterPolicyRows: rows => rows.filter(row => row.domain === "government-subsidy"),
    filterHistoryRows: rows => rows.filter(row => row.domain === "government-subsidy" || row.domain === "free-subsidy"),
  });
  const free = { domain: "free-subsidy", domainLabel: "무상지원금", entryId: "free-history", row: {},
    feeView: { version: 1, mode: "legacy", owner: { sourceTable: "FreeSubsidyEntry", entryId: "free-history" }, targets: [] } };
  const fresh = { domain: "government-subsidy", domainLabel: "정부지원금", entryId: "created-policy", row: {},
    feeView: { version: 1, mode: "legacy", owner: { sourceTable: "PolicyFundEntry", entryId: "created-policy" }, targets: [] } };
  const props = { rows: [free] as SectionPanelProps["rows"], primaryRow: { _id: "customer-anchor" }, isAdmin: true,
    onSaved, adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"] };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Panel {...props} historyOnly />));
    expect(observedHistory.ids).toContain("free-history");
    expect(fetcher).toHaveBeenCalledWith("/comments/free-history", { cache: "no-store" });
    await act(async () => root.render(<Panel {...props} hideSubTabBar subTab="contract" onSubTabChange={() => {}} />));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(create).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    await act(async () => root.render(<Panel {...props} rows={[fresh, free] as SectionPanelProps["rows"]} hideSubTabBar subTab="contract" onSubTabChange={() => {}} />));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toBe("created-policy");
    expect(JSON.parse(String(save.mock.calls[0]?.[2]))[0].계약금).toBe(200);
    await act(async () => root.render(<Panel {...props} rows={[fresh, free] as SectionPanelProps["rows"]} historyOnly />));
    expect(fetcher).toHaveBeenCalledWith("/comments/free-history", { cache: "no-store" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});
