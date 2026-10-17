// @vitest-environment jsdom
// NO.197 — 여러 명 고르기는 앱이 켠 「계약정보」 차수 카드에만 간다. 정산·환불 탭과 키를 안 넣은 앱(하이브·일루아)은 한 개 고르기 그대로.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

const seen = vi.hoisted(() => ({ tabs: [] as { storagePrefix?: string; multiPersonSelectKeys?: readonly string[] }[] }));
vi.mock("./SettlementInfoTab", () => ({ default: (p: { storagePrefix?: string; multiPersonSelectKeys?: readonly string[] }) => {
  seen.tabs.push({ storagePrefix: p.storagePrefix, multiPersonSelectKeys: p.multiPersonSelectKeys });
  return <div>차수 카드</div>;
} }));

afterEach(() => { vi.unstubAllGlobals(); seen.tabs.length = 0; });

const baseConfig: GovSubsidyPanelConfig = {
  editable: true, allowStructureEdit: false, ownSource: "erp", commentsPath: id => `/comments/${id}`,
  contractFieldsPath: "/fields-contract", settlementFieldsPath: "/fields-settlement", refundFieldsPath: "/fields-refund",
  configPath: "/config", filterPolicyRows: rows => rows.filter(row => row.domain === "government-subsidy"),
};
const policy = { domain: "government-subsidy", domainLabel: "정부지원금", entryId: "policy-1", row: {},
  feeView: { version: 1, mode: "legacy", owner: { sourceTable: "PolicyFundEntry", entryId: "policy-1" }, targets: [] } };
const props = { rows: [policy] as SectionPanelProps["rows"], primaryRow: { _id: "customer-anchor" }, isAdmin: true,
  adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"] };

async function keysByTab(config: GovSubsidyPanelConfig) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: [], comments: [] }) })));
  const Panel = createGovSubsidyPanel(config);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const out: Record<string, readonly string[] | undefined> = {};
  try {
    for (const subTab of ["contract", "settlement", "refund"] as const) {
      seen.tabs.length = 0;
      await act(async () => root.render(<Panel {...props} hideSubTabBar subTab={subTab} onSubTabChange={() => {}} />));
      const last = seen.tabs[seen.tabs.length - 1];
      expect(last, `${subTab} 탭이 그려지지 않았다`).toBeDefined();
      out[last!.storagePrefix ?? "?"] = last!.multiPersonSelectKeys;
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
  return out;
}

it("앱이 켠 키는 계약정보 차수 카드에만 넘기고 정산·환불 탭에는 넘기지 않는다", async () => {
  const out = await keysByTab({ ...baseConfig, contractMultiPersonSelectKeys: ["담당컨설턴트"] });
  expect(out).toEqual({ contract: ["담당컨설턴트"], settlement: undefined, refund: undefined });
});

it("키를 넣지 않은 앱(하이브·일루아)은 계약정보도 지금처럼 한 개 고르기다", async () => {
  const out = await keysByTab(baseConfig);
  expect(out).toEqual({ contract: undefined, settlement: undefined, refund: undefined });
});
