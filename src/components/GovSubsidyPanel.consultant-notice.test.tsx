// @vitest-environment jsdom
// 정산 차수 담당 컨설턴트 경고 — 앱이 켠 경우에만, 정산정보 탭에만 tierNotice 가 내려가고
// 같은 회사의 계약 차수가 정확히 1개일 때만 담당이 다르다고 알린다. 계약·환불 탭과 켜지 않은 앱은 지금과 똑같다.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

type Notice = ((tier: Record<string, unknown>) => string | null) | undefined;
const seen = vi.hoisted(() => ({ tabs: [] as { storagePrefix?: string; tierNotice?: unknown }[] }));
vi.mock("./SettlementInfoTab", () => ({ default: (p: { storagePrefix?: string; tierNotice?: unknown }) => {
  seen.tabs.push({ storagePrefix: p.storagePrefix, tierNotice: p.tierNotice });
  return <div>차수 카드</div>;
} }));

afterEach(() => { vi.unstubAllGlobals(); seen.tabs.length = 0; });

const baseConfig: GovSubsidyPanelConfig = {
  editable: true, allowStructureEdit: false, ownSource: "erp", commentsPath: id => `/comments/${id}`,
  contractFieldsPath: "/fields-contract", settlementFieldsPath: "/fields-settlement", refundFieldsPath: "/fields-refund",
  configPath: "/config", filterPolicyRows: rows => rows.filter(row => row.domain === "government-subsidy"),
};
const feeView = { version: 1, mode: "legacy", owner: { sourceTable: "PolicyFundEntry", entryId: "policy-1" }, targets: [] };
// 시험용 가짜 이름만 쓴다.
const policyWith = (contractTiers: unknown[]) => ({ domain: "government-subsidy", domainLabel: "정부지원금", entryId: "policy-1",
  row: { 계약정보_차수: JSON.stringify(contractTiers) }, feeView });
const panelProps = (rows: unknown[]) => ({ rows: rows as SectionPanelProps["rows"], primaryRow: { _id: "customer-anchor" }, isAdmin: true,
  adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab: () => null } } as unknown as SectionPanelProps["adapter"] });

async function noticeByTab(config: GovSubsidyPanelConfig, contractTiers: unknown[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: [], comments: [] }) })));
  const Panel = createGovSubsidyPanel(config);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const out: Record<string, Notice> = {};
  try {
    for (const subTab of ["contract", "settlement", "refund"] as const) {
      seen.tabs.length = 0;
      await act(async () => root.render(<Panel {...panelProps([policyWith(contractTiers)])} hideSubTabBar subTab={subTab} onSubTabChange={() => {}} />));
      const last = seen.tabs[seen.tabs.length - 1];
      expect(last, `${subTab} 탭이 그려지지 않았다`).toBeDefined();
      out[last!.storagePrefix ?? "?"] = last!.tierNotice as Notice;
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
  return out;
}

const contractTier = (name: string) => ({ id: "c1", label: "1차", 계약금: 1000000, 담당컨설턴트: name });

it("앱이 켜면 정산정보 탭에만 안내 판정이 내려가고 계약·환불 탭에는 안 내려간다", async () => {
  const out = await noticeByTab({ ...baseConfig, settlementConsultantNotice: true }, [contractTier("시험이")]);
  expect(typeof out.settlement).toBe("function");
  expect(out.contract).toBeUndefined();
  expect(out.refund).toBeUndefined();
});

it("계약 차수 1개와 담당이 다르면 한 줄 안내를, 같으면 아무것도 돌려주지 않는다", async () => {
  const out = await noticeByTab({ ...baseConfig, settlementConsultantNotice: true }, [contractTier("시험이")]);
  expect(out.settlement!({ id: "s1", 담당컨설턴트: "시험김" })).toBe("계약 차수 담당 컨설턴트(시험이)와 다릅니다");
  expect(out.settlement!({ id: "s1", 담당컨설턴트: "시험이" })).toBeNull();
});

it("계약 차수가 2개이면 다르다고 알리지 않는다", async () => {
  const out = await noticeByTab({ ...baseConfig, settlementConsultantNotice: true }, [contractTier("시험이"), { ...contractTier("시험박"), id: "c2", label: "2차" }]);
  expect(out.settlement!({ id: "s1", 담당컨설턴트: "시험김" })).toBeNull();
});

it("켜지 않은 앱(하이브·일루아)은 세 탭 모두 안내 판정을 받지 않는다", async () => {
  const out = await noticeByTab(baseConfig, [contractTier("시험이")]);
  expect(out).toEqual({ contract: undefined, settlement: undefined, refund: undefined });
});
