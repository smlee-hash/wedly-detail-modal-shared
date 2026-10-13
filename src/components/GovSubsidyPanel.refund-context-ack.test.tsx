// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel } from "./GovSubsidyPanel";

type Row = Record<string, unknown>;
type Save = ReturnType<typeof saveMock>;

const fields = [{ key: "환불금액", label: "환불금액", type: "number" }];
const serverRead = { 계약일: "2026-10-12", 컨설팅담당: "담당", _refundContractState: "resolved" };
const persisted = { id: "refund-one", label: "1차 정산", 환불금액: 100, _contractTierId: "contract-one", ...serverRead };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : {} }) })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function saveMock() { return vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined); }
function refundOwner({ entryId = "first", flag = true, contractId = "contract-one", refund }: { entryId?: string; flag?: boolean; contractId?: string; refund?: Row[] } = {}) {
  const row: Row = { 계약정보_차수: JSON.stringify([{ id: contractId }]), _governmentRefundContextEnabled: flag };
  if (refund) row.환불정보_차수 = JSON.stringify(refund);
  return { domain: "government-subsidy", entryId, domainLabel: "정부지원금", row };
}
const asRows = (owners: unknown[]) => owners as unknown as SectionPanelProps["rows"];
const sleep = () => new Promise((resolve) => setTimeout(resolve, 20));
const addButton = () => [...host.querySelectorAll("button")].find((b) => /^\+ .*정산 추가$/.test(b.textContent ?? ""));
const saving = () => (host.textContent ?? "").includes("저장 중");
const sentTiers = (save: Save) => JSON.parse(save.mock.calls[0][2] as string) as Row[];

async function mountRefund(owners: unknown[], save: Save) {
  const Panel = createGovSubsidyPanel({ editable: true, allowStructureEdit: false, ownSource: "illua",
    commentsPath: (id) => `/comments/${id}`, contractFieldsPath: "/refund-fields-contract", settlementFieldsPath: "/refund-fields-settlement",
    refundFieldsPath: "/refund-fields", configPath: "/refund-config", savePolicyField: save, filterPolicyRows: (rows) => rows });
  const props = { primaryRow: { _id: "customer-one" }, isAdmin: true, hideSubTabBar: true, subTab: "refund", onSubTabChange: vi.fn(), onSaved: vi.fn(),
    adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"] };
  const show = async (next: unknown[]) => { await act(async () => { root.render(<Panel {...props} rows={asRows(next)} />); await sleep(); }); };
  await show(owners);
  return show;
}
async function addTier() {
  const button = addButton(); expect(button).toBeTruthy();
  await act(async () => { button!.click(); await sleep(); });
}

for (const start of ["an absent key", "an empty list"]) {
  it(`active refund context acknowledges the first new tier from ${start} despite server read keys`, async () => {
    const save = saveMock();
    const show = await mountRefund([refundOwner({ refund: start === "an empty list" ? [] : undefined })], save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 2)).toEqual(["first", "환불정보_차수"]);
    const [added] = sentTiers(save);
    expect(sentTiers(save)).toHaveLength(1);
    expect(saving()).toBe(true); expect(addButton()).toBeUndefined();
    await show([refundOwner({ refund: [{ ...added, ...serverRead, _contractTierId: "contract-one" }] })]);
    expect(saving()).toBe(false); expect(addButton()).toBeTruthy();
  });
}

it("active refund context acknowledges a second new tier while the first keeps its projected read keys", async () => {
  const save = saveMock();
  const show = await mountRefund([refundOwner({ refund: [persisted] })], save);
  await addTier();
  expect(save).toHaveBeenCalledTimes(1);
  const [first, added] = sentTiers(save);
  expect(sentTiers(save)).toHaveLength(2);
  expect(first).toMatchObject({ id: "refund-one", 환불금액: 100 });
  expect(saving()).toBe(true);
  await show([refundOwner({ refund: [
    { ...first, ...serverRead, 컨설팅담당: "바뀐 담당", _contractTierId: "contract-one" },
    { ...added, ...serverRead, _contractTierId: "contract-one" },
  ] })]);
  expect(saving()).toBe(false); expect(addButton()).toBeTruthy();
});

const strictCases: Array<[string, boolean, (added: Row) => Row]> = [
  ["a disabled refund context", false, (added) => ({ ...added, ...serverRead, _contractTierId: "contract-one" })],
  ["a changed amount", true, (added) => ({ ...added, ...serverRead, 환불금액: 999, _contractTierId: "contract-one" })],
  ["a different contract than the owner's only contract", true, (added) => ({ ...added, ...serverRead, _contractTierId: "contract-two" })],
  ["an unexpected extra field", true, (added) => ({ ...added, ...serverRead, 메모: "서버가 붙이지 않는 칸", _contractTierId: "contract-one" })],
];
for (const [name, flag, observe] of strictCases) {
  it(`keeps the save locked for ${name}`, async () => {
    const save = saveMock();
    const show = await mountRefund([refundOwner({ flag })], save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    const [added] = sentTiers(save);
    await show([refundOwner({ flag, refund: [observe(added)] })]);
    expect(saving()).toBe(true); expect(addButton()).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });
}

for (const [contractId, unlocked] of [["contract-one", true], ["contract-two", false]] as const) {
  it(`binds the implicit contract from the edited owner only (${contractId} ${unlocked ? "unlocks" : "stays locked"})`, async () => {
    const save = saveMock();
    const owners = (refund?: Row[]) => [refundOwner({ refund }), refundOwner({ entryId: "second", contractId: "contract-two" })];
    const show = await mountRefund(owners(), save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("first");
    const [added] = sentTiers(save);
    await show(owners([{ ...added, ...serverRead, _contractTierId: contractId }]));
    expect(saving()).toBe(!unlocked);
    expect(addButton() !== undefined).toBe(unlocked);
  });
}
