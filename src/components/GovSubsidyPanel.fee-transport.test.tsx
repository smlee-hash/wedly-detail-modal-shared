// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionPanelProps, FeePublicViewV1, FeePublicEditObservationV1 } from "@wedly/ui-shared";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";
import type { TierFieldEditIntentV1 } from "./tier-field-edit-intent";

const child = vi.hoisted(() => ({ props: null as null | { rawValue: string; onSave: (json: string, intent?: TierFieldEditIntentV1) => void } }));
vi.mock("./SettlementInfoTab", () => ({ default: (props: typeof child.props) => { child.props = props; return <div data-testid="tier-editor" />; } }));
const requestId = "30000000-0000-4000-8000-000000000001";
const currentVersion = "40000000-0000-4000-8000-000000000001";
type Row = SectionPanelProps["rows"][number] & { feeView?: FeePublicViewV1 };
function source(entryId: string, tier: Record<string, unknown>, observation: FeePublicEditObservationV1 = { status: "ready", eventVersion: currentVersion }): Row {
  return { domain: "government-subsidy", entryId, domainLabel: "정부지원금", row: { 계약정보_차수: JSON.stringify([tier]) },
    feeView: { version: 1, mode: "standard", owner: { sourceTable: "PolicyFundEntry", entryId }, targets: [{ scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: String(tier.id || "tier-1-0") }, status: "blocked", fields: {}, edits: { 계약금: observation, "[위들리]_수수료": observation }, reason: "fee-base-vat-basis-unconfirmed" }] } } as Row;
}
function intent(tierId: string, fieldKey = "계약금", previous: TierFieldEditIntentV1["previous"] = { present: true, value: 100 }, kind: TierFieldEditIntentV1["kind"] = "field"): TierFieldEditIntentV1 {
  return { version: 1, requestId, kind, tierId, fieldKey, previous };
}

describe("actual government panel forwards a fee edit to its original owner", () => {
  let root: Root, host: HTMLDivElement;
  let save: ReturnType<typeof vi.fn>, saved: ReturnType<typeof vi.fn>;
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5));
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    save = vi.fn(async () => undefined); saved = vi.fn(); child.props = null;
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  async function render(rows: Row[], editable = true, subTab = "contract") {
    const config: GovSubsidyPanelConfig = { editable, allowStructureEdit: false, ownSource: "erp", commentsPath: id => `/comments/${id}`, contractFieldsPath: "/contract", settlementFieldsPath: "/settlement", refundFieldsPath: "/refund", configPath: "/config", savePolicyField: save, filterPolicyRows: r => r };
    const Panel = createGovSubsidyPanel(config);
    const adapter = { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"];
    await act(async () => { root.render(<Panel rows={rows} primaryRow={{}} isAdmin adapter={adapter} onSaved={saved} hideSubTabBar subTab={subTab} onSubTabChange={() => {}} />); await settle(); });
    expect(child.props).not.toBeNull();
    return async (freshRows: Row[]) => {
      await act(async () => { root.render(<Panel rows={freshRows} primaryRow={{}} isAdmin adapter={adapter} onSaved={saved} hideSubTabBar subTab={subTab} onSubTabChange={() => {}} />); await settle(); });
    };
  }
  async function send(edit?: TierFieldEditIntentV1, change?: (tiers: Record<string, unknown>[]) => void) {
    const tiers = JSON.parse(child.props!.rawValue) as Record<string, unknown>[]; change?.(tiers);
    await act(async () => { child.props!.onSave(JSON.stringify(tiers), edit); await settle(); });
  }
  it.each([currentVersion, "opaque-event-generation-v1"])("same amount commit forwards the server edit observation %s unchanged", async observedVersion => {
    await render([source("gov-a", { id: "same", 계약금: 100 }), source("gov-b", { id: "same", 계약금: 100 }, { status: "ready", eventVersion: observedVersion })]);
    await send(intent("gm1~same"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("gov-b", "계약정보_차수", JSON.stringify([{ id: "same", 계약금: 100 }]), { feeEdit: { version: 1, requestId, selection: { sourceTable: "PolicyFundEntry", entryId: "gov-b", containerKey: "계약정보_차수", tierId: "same", fieldKey: "계약금" }, previous: { present: true, value: 100 }, expectedEventVersion: observedVersion } });
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it("id-less source keeps its actual owner and server projected identity", async () => {
    await render([source("gov-a", { id: "a", 계약금: 100 }), source("gov-b", { 계약금: 100 })]);
    await send(intent("gm1~noid0"), tiers => { tiers[1].계약금 = 200; });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("gov-b");
    expect(save.mock.calls[0][3]).toMatchObject({ feeEdit: { selection: { entryId: "gov-b", tierId: "tier-1-0" }, requestId, expectedEventVersion: currentVersion } });
  });
  it.each(["absent", "legacy"])("first contract draft on %s legacy entry still saves to its explicit default owner", async mode => {
    const selected = source("gov-a", { id: "placeholder" }); selected.row.계약정보_차수 = "[]";
    if (mode === "absent") delete selected.feeView;
    else selected.feeView = { version: 1, mode: "legacy", owner: { sourceTable: "PolicyFundEntry", entryId: "gov-a" }, targets: [] };
    await render([selected]);
    await send(intent("tier-draft-new", "계약금", { present: false }), tiers => { tiers.push({ id: "tier-draft-new", 계약금: 100 }); });
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toBe("gov-a");
    expect(JSON.parse(save.mock.calls[0][2])).toEqual([{ id: "tier-draft-new", 계약금: 100 }]);
    expect(save.mock.calls[0][3]?.feeEdit).toBeUndefined();
  });
  it("refund field edit never rewrites another owner's reserved raw ID", async () => {
    const selected = source("gov-a", { id: "contract-a" }); const other = source("gov-b", { id: "contract-b" });
    selected.row.환불정보_차수 = JSON.stringify([{ id: "one", 환불일: "2026-08-24" }]);
    other.row.환불정보_차수 = JSON.stringify([{ id: "noid0", 환불일: "2026-08-23" }]);
    await render([selected, other], true, "refund");
    await send(intent("gm0~one", "환불일", { present: true, value: "2026-08-24" }), tiers => { tiers.find(tier => tier.id === "gm0~one")!.환불일 = "2026-08-25"; });
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toBe("gov-a"); expect(save.mock.calls[0][3]?.feeEdit).toBeUndefined();
  });
  it("legacy first draft waits for its saved rows before accepting the next field", async () => {
    const selected = source("gov-a", { id: "placeholder" }); selected.row.계약정보_차수 = "[]"; delete selected.feeView;
    const refresh = await render([selected]);
    const first = [{ id: "tier-draft-new", 계약금: 100, 계약일: "" }];
    await act(async () => { child.props!.onSave(JSON.stringify(first), intent("tier-draft-new", "계약금", { present: false })); await settle(); });
    await act(async () => { child.props!.onSave(JSON.stringify([{ ...first[0], 계약일: "2026-08-25" }]), intent("tier-draft-new", "계약일", { present: true, value: "" })); await settle(); });
    expect(save).toHaveBeenCalledTimes(1);
    await refresh([{ ...selected, row: { ...selected.row, 계약정보_차수: JSON.stringify(first) } }]);
    const next = JSON.parse(child.props!.rawValue) as Record<string, unknown>[];
    next[0].계약일 = "2026-08-25";
    await act(async () => { child.props!.onSave(JSON.stringify(next), intent(String(next[0].id), "계약일", { present: true, value: "" })); await settle(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe("gov-a");
    expect(JSON.parse(save.mock.calls[1][2])[0]).toMatchObject({ 계약금: 100, 계약일: "2026-08-25" });
    expect(save.mock.calls[1][3]?.feeEdit).toBeUndefined();
  });
  it.each([0, 1000000, null])("standard first contract draft submits an explicit absent amount precondition for %s", async value => {
    const selected = source("gov-a", { id: "placeholder" }); selected.row.계약정보_차수 = "[]";
    selected.feeView = { version: 1, mode: "standard", owner: { sourceTable: "PolicyFundEntry", entryId: "gov-a" }, targets: [] };
    await render([selected]);
    await send(intent("tier-draft-new", "계약금", { present: false }), tiers => { tiers.push({ id: "tier-draft-new", 계약금: value }); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("gov-a");
    expect(save.mock.calls[0][3]).toEqual({ feeEdit: { version: 1, requestId, selection: { sourceTable: "PolicyFundEntry", entryId: "gov-a", containerKey: "계약정보_차수", tierId: "tier-draft-new", fieldKey: "계약금" }, previous: { present: false }, expectedEventVersion: null } });
  });
  it("standard first draft date entry saves without creating a monetary event", async () => {
    const selected = source("gov-a", { id: "placeholder" }); selected.row.계약정보_차수 = "[]";
    selected.feeView = { version: 1, mode: "standard", owner: { sourceTable: "PolicyFundEntry", entryId: "gov-a" }, targets: [] };
    await render([selected]);
    await send(intent("tier-draft-new", "계약일", { present: false }), tiers => { tiers.push({ id: "tier-draft-new", 계약일: "2026-08-25" }); });
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][3]?.feeEdit).toBeUndefined();
  });
  it("a blocked owner's new draft never obtains an absent monetary precondition", async () => {
    const selected = source("gov-a", { id: "placeholder" }); selected.row.계약정보_차수 = "[]";
    selected.feeView = { version: 1, mode: "blocked", owner: { sourceTable: "PolicyFundEntry", entryId: "gov-a" }, targets: [], reason: "fee-definition-set-invalid", message: "설정 확인" };
    await render([selected]);
    await send(intent("tier-draft-new", "계약금", { present: false }), tiers => { tiers.push({ id: "tier-draft-new", 계약금: 1000000 }); });
    expect(save).not.toHaveBeenCalled();
  });
  it("an invalid observed fee version prevents any owner write", async () => {
    await render([source("gov-a", { id: "one", 계약금: 100 }, { status: "invalid" })]);
    await send(intent("gm0~one"), tiers => { tiers[0].계약금 = 200; });
    expect(save).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/확인|새로|저장/);
  });
  it.each([0, null, ""])("manual restore preserves its own previous value %s in the logical fee request", async value => {
    await render([source("gov-a", { id: "one", 계약금: 100, "_ovr_[위들리]_수수료": value })]);
    await send(intent("gm0~one", "_ovr_[위들리]_수수료", { present: true, value }, "restore"), tiers => { delete tiers[0]["_ovr_[위들리]_수수료"]; });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][3]).toMatchObject({ feeEdit: { selection: { fieldKey: "[위들리]_수수료", tierId: "one" }, previous: { present: true, value }, requestId } });
  });
  it("a date edit and a structural save never become amount events", async () => {
    await render([source("gov-a", { id: "one", 계약금: 100, 계약일: "2026-08-24" })]);
    await send(intent("gm0~one", "계약일", { present: true, value: "2026-08-24" }), tiers => { tiers[0].계약일 = "2026-08-25"; });
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][3]?.feeEdit).toBeUndefined();
  });
  it("unmodified duplicate tiers of another owner do not prevent an ordinary date edit", async () => {
    const other = source("gov-b", { id: "dup", 계약금: 100 });
    other.row.계약정보_차수 = JSON.stringify([{ id: "dup", 계약금: 100 }, { id: "dup", 계약금: 100 }]);
    await render([source("gov-a", { id: "one", 계약금: 100, 계약일: "2026-08-24" }), other]);
    await send(intent("gm0~one", "계약일", { present: true, value: "2026-08-24" }), tiers => { tiers.find(tier => tier.id === "gm0~one")!.계약일 = "2026-08-25"; });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("gov-a");
    expect(save.mock.calls[0][3]?.feeEdit).toBeUndefined();
    expect(JSON.parse(save.mock.calls[0][2])).toEqual([{ id: "one", 계약금: 100, 계약일: "2026-08-25" }]);
  });
  it.each(["standard", "legacy"])("editing one owner in %s never rewrites an untouched other owner whose raw ID is reserved", async mode => {
    const other = source("gov-b", { id: "noid0", 계약금: 100 });
    const selected = source("gov-a", { id: "one", 계약금: 100, 계약일: "2026-08-24" });
    if (mode === "legacy") { delete selected.feeView; delete other.feeView; }
    await render([selected, other]);
    await send(intent("gm0~one", "계약일", { present: true, value: "2026-08-24" }), tiers => { tiers.find(tier => tier.id === "gm0~one")!.계약일 = "2026-08-25"; });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("gov-a");
    expect(save.mock.calls[0][3]?.feeEdit).toBeUndefined();
  });
  it("read-only panel never sends a fee intent", async () => {
    await render([source("gov-a", { id: "one", 계약금: 100 })], false);
    await send(intent("gm0~one"), tiers => { tiers[0].계약금 = 200; });
    expect(save).not.toHaveBeenCalled();
  });
  it("duplicate source tier identities do not fall back to the first owner", async () => {
    const row = source("gov-a", { id: "one", 계약금: 100 }); row.row.계약정보_차수 = JSON.stringify([{ id: "one", 계약금: 100 }, { id: "one", 계약금: 100 }]);
    await render([row]); await send(intent("gm0~one"), tiers => { tiers[1].계약금 = 200; });
    expect(save).not.toHaveBeenCalled();
  });
});
