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
const addButton = () => [...host.querySelectorAll("button")].find((b) => /^\+ .* 추가$/.test(b.textContent ?? ""));
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
  const refundTab = [...host.querySelectorAll("button")].find((button) => button.textContent === "환불정보");
  if (refundTab) await act(async () => { refundTab.click(); await sleep(); });
  return show;
}
async function addTier() {
  const button = addButton(); expect(button, host.textContent ?? "").toBeTruthy();
  await act(async () => { button!.click(); await sleep(); });
}

for (const start of ["an absent key", "an empty list"]) {
  it(`active refund context acknowledges the first new tier from ${start} despite server read keys`, async () => {
    const save = saveMock();
    const show = await mountRefund([refundOwner({ refund: start === "an empty list" ? [] : undefined })], save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 2)).toEqual(["first", "환불정보_차수"]);
    const submitted = sentTiers(save);
    // 이 앱은 비어 있던 컨테이너에 보이는 기본 1차도 함께 저장한다.
    expect(submitted).toHaveLength(2);
    expect(saving()).toBe(true); expect(addButton()).toBeUndefined();
    await show([refundOwner({ refund: submitted.map((tier) => ({ ...tier, ...serverRead, _contractTierId: "contract-one" })) })]);
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
    const show = await mountRefund([refundOwner({ flag, refund: [persisted] })], save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    const [first, added] = sentTiers(save);
    expect(sentTiers(save)).toHaveLength(2);
    await show([refundOwner({ flag, refund: [first, observe(added)] })]);
    expect(saving()).toBe(true); expect(addButton()).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });
}

for (const [contractId, unlocked] of [["contract-one", true], ["contract-two", false]] as const) {
  it(`binds the implicit contract from the edited owner only (${contractId} ${unlocked ? "unlocks" : "stays locked"})`, async () => {
    const save = saveMock();
    const owners = (refund: Row[] = [persisted]) => [refundOwner({ refund }), refundOwner({ entryId: "second", contractId: "contract-two" })];
    const show = await mountRefund(owners(), save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("first");
    const [first, added] = sentTiers(save);
    expect(sentTiers(save)).toHaveLength(2);
    await show(owners([first, { ...added, ...serverRead, _contractTierId: contractId }]));
    expect(saving()).toBe(!unlocked);
    expect(addButton() !== undefined).toBe(unlocked);
  });
}

for (const [beforeFlag, afterFlag] of [[true, false], [false, true]] as const) {
  it(`uses the current owner refund context after refetch (${beforeFlag} to ${afterFlag})`, async () => {
    const save = saveMock();
    const show = await mountRefund([refundOwner({ flag: beforeFlag, refund: [persisted] })], save);
    await addTier();
    expect(save).toHaveBeenCalledTimes(1);
    const [first, added] = sentTiers(save);
    expect(sentTiers(save)).toHaveLength(2);
    await show([refundOwner({ flag: afterFlag, refund: [first, { ...added, ...serverRead, _contractTierId: "contract-one" }] })]);
    expect(saving()).toBe(!afterFlag);
    expect(addButton() !== undefined).toBe(afterFlag);
  });
}

it("context-only refetch retries acknowledgement for the same owner and refund bytes", async () => {
  const save = saveMock();
  const show = await mountRefund([refundOwner({ flag: true, refund: [persisted] })], save);
  await addTier();
  const [first, added] = sentTiers(save);
  const refund = [first, { ...added, ...serverRead, _contractTierId: "contract-one" }];
  await show([refundOwner({ flag: false, refund })]);
  expect(saving()).toBe(true);
  await show([refundOwner({ flag: true, refund })]);
  expect(saving()).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
});

it("only the original unique owner's exact projection releases an unobserved save after returning", async () => {
  const save = saveMock();
  const show = await mountRefund([refundOwner({ refund: [persisted] })], save);
  await addTier();
  const [first, added] = sentTiers(save);
  const exact = [first, { ...added, ...serverRead, _contractTierId: "contract-one" }];
  await show([refundOwner({ entryId: "second", refund: exact })]);
  expect(saving()).toBe(false);
  await show([refundOwner({ refund: [persisted] })]);
  expect(saving()).toBe(true);
  await show([refundOwner({ refund: exact }), refundOwner({ refund: exact })]);
  expect(saving()).toBe(true);
  await show([refundOwner({ refund: [first, { ...exact[1], 환불금액: 999 }] })]);
  expect(saving()).toBe(true);
  await show([refundOwner({ flag: false, refund: exact })]);
  expect(saving()).toBe(true);
  await show([refundOwner({ flag: true, refund: exact })]);
  expect(saving()).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
});

it("acknowledges an exact new refund array after replacing malformed prior JSON", async () => {
  const save = saveMock();
  const initial = refundOwner();
  initial.row.환불정보_차수 = "{broken-json";
  const show = await mountRefund([initial], save);
  await addTier();
  const submitted = sentTiers(save);
  const exact = submitted.map(tier => ({ ...tier, ...serverRead, _contractTierId: "contract-one" }));
  const changed = (key: string, value: unknown) => exact.map((tier, index) => index === 1 ? { ...tier, [key]: value } : tier);
  for (const bad of [changed("환불금액", 999), changed("id", "wrong-id"), changed("_contractTierId", "wrong-contract"), [...exact].reverse(), exact.slice(1)]) {
    await show([refundOwner({ refund: bad })]);
    expect(saving()).toBe(true);
  }
  const corruptRead = refundOwner();
  corruptRead.row.환불정보_차수 = "{still-broken";
  await show([corruptRead]);
  expect(saving()).toBe(true);
  await show([refundOwner({ refund: exact })]);
  expect(saving()).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
});
