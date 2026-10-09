// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evalFormulaForTierDetailed, type FieldDef, type ScoreCardDef, type TierData } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

const literal = (value: number) => [{ op: "+" as const, unit: "number" as const, value }];
const fields: FieldDef[] = [
  { key: "kind", label: "조건", type: "text" },
  { key: "revenue", label: "매출 기준", type: "number" },
  { key: "fee", label: "수수료", type: "formula", conditional: { match: "all", rules: [
    { leftKey: "kind", op: "eq", right: { kind: "text", value: "conflict" }, formula: literal(100_000) },
    { leftKey: "kind", op: "eq", right: { kind: "text", value: "conflict" }, formula: literal(200_000) },
    { leftKey: "kind", op: "eq", right: { kind: "text", value: "normal" }, formula: literal(200_000) },
    { leftKey: "kind", op: "eq", right: { kind: "text", value: "zero" }, formula: literal(0) },
  ] } },
];
const cards: ScoreCardDef[] = [
  { id: "fee-total", label: "검사 수수료 총액", color: "blue", formula: { plus: ["fee"], minus: [] } },
  { id: "revenue-total", label: "검사 순매출", color: "blue", formula: { plus: ["revenue"], minus: ["fee"] } },
  { id: "custom-total", label: "검사 컬럼 직접식", color: "blue", formula: { plus: [], minus: [], custom: [{ op: "+", unit: "column", columnKey: "fee", value: 0 }] } },
  { id: "unrelated-total", label: "검사 원매출", color: "blue", formula: { plus: ["revenue"], minus: [] } },
];
const tier = (id: string, kind: string, extra = {}): TierData => ({ id, label: id, kind, revenue: 1_000_000, ...extra });

describe("실제 상세 합계의 계산 차단 전파", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saves: ReturnType<typeof vi.fn>;
  let n = 0;
  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    saves = vi.fn(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => ({ ok: true, json: async () => ({
      success: true, data: String(input).includes("fields") ? fields : { settlementCards: cards },
    }) })));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  async function render(tiers: TierData[]) {
    const original = JSON.stringify(tiers);
    await act(async () => {
      root.render(<SettlementInfoTab storagePrefix="settlement" rawValue={original} onSave={saves}
        fieldsApiPath={`/blocked-summary-fields-${++n}`} configApiPath={`/blocked-summary-config-${n}`}
        ratioBaseKey="revenue" ratioFeeKey="fee" ratioBaseLabel="매출" ratioFeeLabel="수수료"
        defaultScoreCards={cards} readOnly />);
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(JSON.stringify(tiers)).toBe(original); expect(saves).not.toHaveBeenCalled();
  }
  function cardValue(label: string) {
    const title = Array.from(container.querySelectorAll("p")).find(node => node.textContent === label);
    expect(title, label).toBeTruthy();
    return title!.nextElementSibling!.textContent!.replace(/\s/g, "");
  }
  it.each(cards.slice(0, 3).map(card => card.label))("충돌 차수+정상20만원에서 %s를 부분금액으로 표시하지 않는다", async label => {
    const rows = [tier("blocked", "conflict"), tier("normal", "normal")];
    expect(evalFormulaForTierDetailed(fields[2], rows[0], fields).blocked?.kind).toBe("conflict");
    expect(evalFormulaForTierDetailed(fields[2], rows[1], fields).value).toBe(200_000);
    await render(rows);
    expect(cardValue(label)).toBe("-");
  });
  it("정상 0을 빈값이나 차단으로 바꾸지 않는다", async () => {
    await render([tier("zero", "zero")]); expect(cardValue(cards[0].label)).toBe("0원");
  });
  it("명시 수동0과 정상20만원은 실제 금액을 합산한다", async () => {
    await render([tier("manual", "conflict", { _ovr_fee: 0 }), tier("normal", "normal")]);
    expect(cardValue(cards[0].label)).toBe("200,000원");
  });
  it("일반 미해당 null은 실제 blocked와 구분하여 기존 정상금액을 유지한다", async () => {
    const rows = [tier("empty", "unmatched"), tier("normal", "normal")];
    expect(evalFormulaForTierDetailed(fields[2], rows[0], fields)).toMatchObject({ value: null });
    expect(evalFormulaForTierDetailed(fields[2], rows[0], fields).blocked).toBeUndefined();
    await render(rows); expect(cardValue(cards[0].label)).toBe("200,000원");
  });
  it("참조하지 않는 수수료의 차단 때문에 독립적인 원매출을 숨기지 않는다", async () => {
    await render([tier("blocked", "conflict"), tier("normal", "normal")]);
    expect(cardValue(cards[3].label)).toBe("2,000,000원");
  });
  it("모든 차수가 차단이면 기존 빈 표시를 유지한다", async () => {
    await render([tier("blocked", "conflict")]); expect(cardValue(cards[0].label)).toBe("-");
  });
  it("보호된 직접입력 25만원은 자동 충돌 대신 실제 금액으로 유지한다", async () => {
    await render([tier("manual", "conflict", { _ovr_fee: 250_000 }), tier("normal", "normal")]);
    expect(cardValue(cards[0].label)).toBe("450,000원");
  });
});
