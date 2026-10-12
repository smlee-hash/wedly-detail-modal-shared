// @vitest-environment jsdom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeePublicTargetV1, FieldDef, ScoreCardDef, TierData } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

type View = { mode: "legacy" } | { mode: "blocked"; message: string } | { mode: "standard"; target: FeePublicTargetV1 };
const marker = { version: 1, scope: "gov-contract", policyVersion: "test-policy", definitionSetVersion: "test-defs" };
const fields = [
 { key: "base", label: "검사 원금", type: "number" },
 { key: "fee", label: "검사 수수료", type: "formula", formula: [{ op: "+", unit: "number", value: 999_999 }], feeStandard: marker },
 { key: "double", label: "검사 연결 결과", type: "formula", formula: [{ op: "+", unit: "column", columnKey: "fee", value: 0 }, { op: "*", unit: "number", value: 2 }] },
] as FieldDef[];
const cards: ScoreCardDef[] = [
 { id: "fee-total", label: "서버 수수료 합계", color: "blue", formula: { plus: ["fee"], minus: [] } },
 { id: "net-total", label: "수수료 차감 합계", color: "blue", formula: { plus: ["base"], minus: ["fee"] } },
 { id: "custom-total", label: "연결 합계", color: "blue", formula: { plus: [], minus: [], custom: [{ op: "+", unit: "column", columnKey: "double", value: 0 }] } },
 { id: "base-total", label: "독립 원금 합계", color: "blue", formula: { plus: ["base"], minus: [] } },
];
function view(id: string, value: number | string | null, source: "automatic" | "manual" | "finalized" | "unverified-historical" = "automatic", blocked = false): View {
 return { mode: "standard", target: { scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: id }, status: blocked ? "blocked" : "calculated", fields: { fee: { value, source, automaticValue: source === "manual" ? 123 : null } }, edits: {} } };
}
const blocked: View = { mode: "blocked", message: "기준 금액을 확인해 주세요." };

describe("actual tier display consumes current server fee values", () => {
 let root: Root, host: HTMLDivElement, saves: ReturnType<typeof vi.fn>;
 let nonce = 0;
 beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); saves = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : { contractCards: cards } }) })));
 });
 afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
 async function render(views: Record<string, View>, rows: TierData[] = [{ id: "one", label: "1차", base: 1_000_000, fee: 777_777 }], withResolver = true) {
  const original = JSON.stringify(rows);
  const extra = withResolver ? { feeTargetForTier: (tier: TierData) => views[tier.id] ?? blocked } : {};
  const props = { rawValue: original, onSave: saves, storagePrefix: "contract", fieldsApiPath: `/public-fee-fields-${++nonce}`, configApiPath: `/public-fee-config-${nonce}`, ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "원금", ratioFeeLabel: "수수료", defaultScoreCards: cards, readOnly: true, ...extra } as ComponentProps<typeof SettlementInfoTab>;
  await act(async () => { root.render(<SettlementInfoTab {...props} />); await new Promise(resolve => setTimeout(resolve, 15)); });
  expect(JSON.stringify(rows)).toBe(original); expect(saves).not.toHaveBeenCalled();
 }
 function total(label: string) {
  const node = [...host.querySelectorAll("p")].find(n => n.textContent === label);
  expect(node).toBeTruthy(); return node!.nextElementSibling!.textContent!.replace(/\s/g, "");
 }
 function cell(label: string) {
  const node = host.querySelector(`[title="${label}"]`); expect(node).toBeTruthy(); return node!.parentElement!.textContent!.replace(/\s/g, "");
 }
 it("uses server value in cell, plus/minus totals and a dependent formula", async () => {
  await render({ one: view("one", 200_000) });
  expect(cell("검사 수수료")).toContain("200,000"); expect(cell("검사 수수료")).not.toContain("999,999");
  expect(total(cards[0].label)).toBe("200,000원"); expect(total(cards[1].label)).toBe("800,000원"); expect(total(cards[2].label)).toBe("400,000원");
 });
 it.each(["manual", "finalized", "unverified-historical"] as const)("preserves selected %s zero despite blocked automatic calculation", async source => {
  await render({ one: view("one", 0, source, true) }); expect(total(cards[0].label)).toBe("0원"); expect(cell("검사 수수료")).toContain("0");
 });
 it.each([null, ""])("preserves explicit blank %j instead of recalculating", async value => {
  await render({ one: view("one", value, "finalized", true) }); expect(total(cards[0].label)).toBe("-"); expect(cell("검사 수수료")).not.toContain("999,999");
 });
 it("does not present a partial total with an unresolved other tier", async () => {
  await render({ one: view("one", 200_000), two: blocked }, [{ id: "one", label: "1차", base: 1_000_000 }, { id: "two", label: "2차", base: 1_000_000 }]);
  for (const card of cards.slice(0,3)) expect(total(card.label)).toBe("-");
  expect(total(cards[3].label)).toBe("2,000,000원"); expect(host.textContent).toContain("확인");
 });
 it("a marked field without a server resolver never falls back to the old formula", async () => {
  await render({}, undefined, false); expect(total(cards[0].label)).toBe("-"); expect(cell("검사 수수료")).not.toContain("999,999");
 });
 it("uses the server automatic value in a selected manual value tooltip", async () => {
  await render({ one: view("one", 25, "manual") }); expect(total(cards[0].label)).toBe("25원");
  const tooltip = [...host.querySelectorAll('[title]')].find(e => e.getAttribute('title')?.includes('수식 계산값'));
  expect(tooltip?.getAttribute('title')).toContain('123');
 });
 it("a legacy resolver cannot make a marked standard field use the old formula", async () => {
  await render({ one: { mode: "legacy" } });
  expect(total(cards[0].label)).toBe("-"); expect(cell("검사 수수료")).not.toContain("999,999");
 });
 it("invalid standard metadata is not treated as a valid marked field", async () => {
  const marked = fields[1] as FieldDef & { feeStandard: unknown }; const old = marked.feeStandard;
  try {
   marked.feeStandard = { version: 0 };
   await render({ one: view("one", 200_000) });
   expect(total(cards[0].label)).toBe("-"); expect(cell("검사 수수료")).not.toContain("200,000");
  } finally { marked.feeStandard = old; }
 });

 it("opening and refetching an editable standard tier never persists the old ratio calculation", async () => {
  const autoFields = [
   { key: "base", label: "성공 보수", type: "number" },
   { key: "fee", label: "컨설턴트 수수료", type: "number", feeStandard: marker },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? autoFields : { contractCards: cards } }) })));
  const raw = JSON.stringify([{ id: "one", label: "1차", base: 1000000, fee: null }]);
  const props = { rawValue: raw, onSave: saves, storagePrefix: "contract", fieldsApiPath: `/public-fee-fields-${++nonce}`, configApiPath: `/public-fee-config-${nonce}`, row: { base: 1000000, fee: 100000 }, ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "성공 보수", ratioFeeLabel: "컨설턴트 수수료", defaultScoreCards: cards, readOnly: false, feeTargetForTier: () => view("one", 200000) } as ComponentProps<typeof SettlementInfoTab>;
  await act(async () => { root.render(<React.StrictMode><SettlementInfoTab {...props} /></React.StrictMode>); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(cell("컨설턴트 수수료")).toContain("200,000"); expect(saves).not.toHaveBeenCalled();
  await act(async () => { root.render(<React.StrictMode><SettlementInfoTab {...props} rawValue={JSON.stringify(JSON.parse(raw))} feeTargetForTier={() => view("one", 300000)} /></React.StrictMode>); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(cell("컨설턴트 수수료")).toContain("300,000"); expect(saves).not.toHaveBeenCalled();
 });

 it.each(["number", "formula"] as const)("untouched %s edit remains untouched when server selection changes while focused", async type => {
  const editFields = [{ key: "base", label: "원금", type: "number" }, { ...fields[1], type }];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? editFields : { contractCards: cards } }) })));
  const props = { rawValue: JSON.stringify([{ id: "one", label: "1차", base: 1000000, fee: 777777 }]), onSave: saves,
   storagePrefix: "contract", fieldsApiPath: `/public-fee-fields-${++nonce}`, configApiPath: `/public-fee-config-${nonce}`,
   ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "원금", ratioFeeLabel: "수수료",
   defaultScoreCards: cards, readOnly: false, isAdmin: true, allowFormulaOverride: true, feeTargetForTier: () => view("one", 200000),
  } as ComponentProps<typeof SettlementInfoTab>;
  await act(async () => { root.render(<SettlementInfoTab {...props} />); await new Promise(resolve => setTimeout(resolve, 20)); });
  const fieldHost = host.querySelector('[title="검사 수수료"]')!.parentElement!;
  const clicker = fieldHost.querySelector<HTMLElement>('.cursor-pointer');
  expect(clicker).toBeTruthy();
  await act(async () => clicker!.click());
  const input = fieldHost.querySelector<HTMLInputElement>('input[type="number"]');
  expect(input).toBeTruthy(); expect(input!.value).toBe("200000");
  await act(async () => { input!.focus(); root.render(<SettlementInfoTab {...props} feeTargetForTier={() => view("one", 300000)} />); });
  expect(input!.value).toBe("200000");
  await act(async () => input!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(saves).not.toHaveBeenCalled();
 });

 it.each([200000, 0, null, "blocked"] as const)("success badge follows the selected %j value", async value => {
  const successFields = [{ key: "성공보수총액", label: "성공보수총액", type: "number", feeStandard: marker }];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? successFields : {} }) })));
  const selected: View = value === "blocked" ? blocked : { mode: "standard", target: { scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: "one" }, status: "calculated", fields: { 성공보수총액: { value, source: "automatic", automaticValue: null } }, edits: {} } };
  const props = { rawValue: JSON.stringify([{ id: "one", label: "1차", 성공보수총액: 1000000 }]), onSave: saves,
   storagePrefix: "contract", fieldsApiPath: `/public-fee-fields-${++nonce}`, configApiPath: `/public-fee-config-${nonce}`,
   ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "원금", ratioFeeLabel: "수수료", defaultScoreCards: [],
   readOnly: true, feeTargetForTier: () => selected,
  } as ComponentProps<typeof SettlementInfoTab>;
  await act(async () => { root.render(<SettlementInfoTab {...props} />); await new Promise(resolve => setTimeout(resolve, 20)); });
  const badges = [...host.querySelectorAll("span")].map(n => n.textContent ?? "").filter(t => t.startsWith("성공보수 "));
  expect(badges).not.toContain("성공보수 1,000,000원");
  if (value === 200000) expect(badges).toContain("성공보수 200,000원");
  expect(saves).not.toHaveBeenCalled();
 });
});
