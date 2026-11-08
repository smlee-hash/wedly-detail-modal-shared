// @vitest-environment jsdom
// 차수 카드 표시 전용 두 가지 — (1) 올카데미 계약금 수수료 칸은 그 차수 값이 0이 아닐 때만 보인다,
// (2) tierNotice 가 돌려준 한 줄 안내는 그 차수 카드에만 뜬다. 둘 다 저장·합계·칸 정의를 건드리지 않는다.
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeePublicTargetV1, FieldDef, ScoreCardDef, TierData } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

const OLCADEMY = "[올카데미]_계약금_수수료";
const marker = { version: 1, scope: "gov-contract", policyVersion: "test-policy", definitionSetVersion: "test-defs" };
const storedFields = [
  { key: "계약금", label: "계약금", type: "number" },
  { key: "[컨설턴트]_수수료", label: "[컨설턴트] 계약금 수수료", type: "number" },
  { key: OLCADEMY, label: "[올카데미] 계약금 수수료", type: "number" },
  { key: "[위들리]_수수료", label: "[위들리] 계약금 수수료", type: "number" },
] as FieldDef[];
const serverFields = storedFields.map((f) => (f.key === "계약금" ? f : { ...f, type: "formula", formula: [{ op: "+", unit: "number", value: 999_999 }], feeStandard: marker })) as FieldDef[];
const cards: ScoreCardDef[] = [
  { id: "olcademy-total", label: "올카데미 합계", color: "blue", formula: { plus: [OLCADEMY], minus: [] } },
];

function serverView(tierId: string, olcademy: number | null) {
  const value = (v: number | null) => ({ value: v, source: "automatic" as const, automaticValue: v });
  return {
    mode: "standard" as const,
    target: {
      scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId }, status: "calculated",
      fields: { "[컨설턴트]_수수료": value(300_000), [OLCADEMY]: value(olcademy), "[위들리]_수수료": value(280_000) },
      edits: {},
    } as FeePublicTargetV1,
  };
}

describe("차수 카드 — 올카데미 칸 숨김과 한 줄 안내", () => {
  let root: Root, host: HTMLDivElement;
  let nonce = 0;
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  async function render(rows: TierData[], extra: Partial<ComponentProps<typeof SettlementInfoTab>> = {}, fields: FieldDef[] = storedFields) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : { contractCards: cards } }) })));
    const props = { rawValue: JSON.stringify(rows), onSave: vi.fn(), storagePrefix: "contract", fieldsApiPath: `/zh-fields-${++nonce}`, configApiPath: `/zh-config-${nonce}`, defaultScoreCards: cards, readOnly: true, ...extra } as ComponentProps<typeof SettlementInfoTab>;
    await act(async () => { root.render(<SettlementInfoTab {...props} />); await new Promise((resolve) => setTimeout(resolve, 15)); });
  }
  /** 차수 카드(둥근 테두리 상자) 중 이 글자가 든 것 */
  function cardWith(text: string) {
    const found = [...host.querySelectorAll<HTMLElement>("div.rounded-2xl")].filter((c) => (c.textContent ?? "").includes(text));
    expect(found.length, `${text} 가 든 차수 카드`).toBeGreaterThan(0);
    return found[found.length - 1];
  }
  const hasLabel = (card: HTMLElement, label: string) => card.querySelector(`[title="${label}"]`) !== null;

  it("올카데미가 0원인 차수는 그 칸이 없고, 5만원인 차수에는 있다(저장값 방식)", async () => {
    await render([
      { id: "a", label: "1차", 계약금: 1_111_111, "[컨설턴트]_수수료": 300_000, [OLCADEMY]: 0, "[위들리]_수수료": 280_000 },
      { id: "b", label: "2차", 계약금: 2_222_222, "[컨설턴트]_수수료": 300_000, [OLCADEMY]: 50_000, "[위들리]_수수료": 280_000 },
    ]);
    const zero = cardWith("1,111,111");
    const some = cardWith("2,222,222");
    expect(hasLabel(zero, "[올카데미] 계약금 수수료")).toBe(false);
    expect(hasLabel(some, "[올카데미] 계약금 수수료")).toBe(true);
    // 다른 칸은 두 차수 모두 그대로 보인다.
    for (const card of [zero, some]) {
      expect(hasLabel(card, "[컨설턴트] 계약금 수수료")).toBe(true);
      expect(hasLabel(card, "[위들리] 계약금 수수료")).toBe(true);
    }
  });

  it("올카데미 값이 비어 있는 차수도 칸이 없다", async () => {
    await render([{ id: "a", label: "1차", 계약금: 1_111_111 }]);
    expect(hasLabel(cardWith("1,111,111"), "[올카데미] 계약금 수수료")).toBe(false);
  });

  it("서버가 정한 값이 0이면 칸이 없고, 5만원이면 있다(서버 값 방식)", async () => {
    const views: Record<string, ReturnType<typeof serverView>> = { a: serverView("a", 0), b: serverView("b", 50_000) };
    await render(
      [{ id: "a", label: "1차", 계약금: 1_111_111 }, { id: "b", label: "2차", 계약금: 2_222_222 }],
      { feeTargetForTier: ((tier: TierData) => views[tier.id]) as ComponentProps<typeof SettlementInfoTab>["feeTargetForTier"] },
      serverFields,
    );
    expect(hasLabel(cardWith("1,111,111"), "[올카데미] 계약금 수수료")).toBe(false);
    expect(hasLabel(cardWith("2,222,222"), "[올카데미] 계약금 수수료")).toBe(true);
    expect(hasLabel(cardWith("1,111,111"), "[컨설턴트] 계약금 수수료")).toBe(true);
  });

  it("칸을 감춰도 합계 카드는 저장된 올카데미 값을 그대로 더한다", async () => {
    await render([
      { id: "a", label: "1차", 계약금: 1_111_111, [OLCADEMY]: 0 },
      { id: "b", label: "2차", 계약금: 2_222_222, [OLCADEMY]: 50_000 },
    ]);
    const label = [...host.querySelectorAll("p")].find((n) => n.textContent === "올카데미 합계");
    expect(label?.nextElementSibling?.textContent?.replace(/\s/g, "")).toBe("50,000원");
  });

  it("tierNotice 가 돌려준 한 줄은 그 차수 카드에만 뜨고, 주입하지 않으면 안 뜬다", async () => {
    const rows = [
      { id: "a", label: "1차", 계약금: 1_111_111, [OLCADEMY]: 0 },
      { id: "b", label: "2차", 계약금: 2_222_222, [OLCADEMY]: 0 },
    ];
    await render(rows, { tierNotice: (tier: TierData) => (tier.id === "b" ? "계약 차수 담당 컨설턴트(시험이)와 다릅니다" : null) });
    expect(cardWith("1,111,111").querySelector("[role=note]")).toBeNull();
    expect(cardWith("2,222,222").querySelector("[role=note]")?.textContent).toBe("계약 차수 담당 컨설턴트(시험이)와 다릅니다");
    expect(host.querySelectorAll("[role=note]").length).toBe(1);
  });

  it("tierNotice 를 주입하지 않으면 안내 줄이 하나도 없다", async () => {
    await render([{ id: "a", label: "1차", 계약금: 1_111_111 }]);
    expect(host.querySelectorAll("[role=note]").length).toBe(0);
  });
});
