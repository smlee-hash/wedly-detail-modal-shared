// @vitest-environment jsdom
// settle3 D — 계약금 수수료 합계 카드를 쪼갠 뒤(계약금 총액 + 컨설턴트·위들리·하이브 세 카드)
// ERP 계약정보 탭 상단 합계 카드가 각자 자기 몫 칸만 더하는지 확인한다.
// 계약금 1,000,000 → 컨설턴트 300,000 · 위들리 280,000 · 하이브 420,000 (올카데미 0). 이름·금액은 시험용 가짜 값이다.
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef, ScoreCardDef, TierData } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

const OLCADEMY = "[올카데미]_계약금_수수료";
const fields = [
  { key: "계약금", label: "계약금", type: "number" },
  { key: "[컨설턴트]_수수료", label: "[컨설턴트] 계약금 수수료", type: "number" },
  { key: "[위들리]_수수료", label: "[위들리] 계약금 수수료", type: "number" },
  { key: OLCADEMY, label: "[올카데미] 계약금 수수료", type: "number" },
  { key: "[하이브]_계약금_수수료", label: "[하이브] 계약금 수수료", type: "number" },
] as FieldDef[];
// 운영 설정에 이관 스크립트(scripts/settle3-d-contract-cards.ts)가 쓰는 것과 같은 네 장.
const cards: ScoreCardDef[] = [
  { id: "contract-amount", label: "계약금 총액", color: "gray", formula: { plus: ["계약금"], minus: [] } },
  { id: "contract-fee-consultant", label: "[컨설턴트] 계약금 수수료", color: "yellow", formula: { plus: ["[컨설턴트]_수수료"], minus: [] } },
  { id: "contract-fee-wedly", label: "[위들리] 계약금 수수료", color: "blue", formula: { plus: ["[위들리]_수수료"], minus: [] } },
  { id: "contract-fee-hive", label: "[하이브] 계약금 수수료", color: "green", formula: { plus: ["[하이브]_계약금_수수료"], minus: [] } },
];
const tiers: TierData[] = [
  { id: "a", label: "1차", 계약금: 1_000_000, "[컨설턴트]_수수료": 300_000, "[위들리]_수수료": 280_000, [OLCADEMY]: 0, "[하이브]_계약금_수수료": 420_000 },
];

describe("계약금 수수료 합계 카드 네 장", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  async function render(rows: TierData[], summary: ScoreCardDef[]) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : { contractCards: summary } }) })));
    const props = { rawValue: JSON.stringify(rows), onSave: vi.fn(), storagePrefix: "contract", fieldsApiPath: "/sfc-fields", configApiPath: "/sfc-config", defaultScoreCards: summary, readOnly: true } as ComponentProps<typeof SettlementInfoTab>;
    await act(async () => { root.render(<SettlementInfoTab {...props} />); await new Promise((resolve) => setTimeout(resolve, 15)); });
  }
  const totalOf = (label: string) => {
    const name = [...host.querySelectorAll("p")].find((n) => n.textContent === label);
    expect(name, `${label} 합계 카드`).toBeTruthy();
    return name?.nextElementSibling?.textContent?.replace(/\s/g, "");
  };

  it("계약금 총액 1,000,000 · 컨설턴트 300,000 · 위들리 280,000 · 하이브 420,000 이 각각 보인다", async () => {
    await render(tiers, cards);
    expect(totalOf("계약금 총액")).toBe("1,000,000원");
    expect(totalOf("[컨설턴트] 계약금 수수료")).toBe("300,000원");
    expect(totalOf("[위들리] 계약금 수수료")).toBe("280,000원");
    expect(totalOf("[하이브] 계약금 수수료")).toBe("420,000원");
  });

  it("옛 「계약금 수수료 총액」 카드나 올카데미 카드는 없다", async () => {
    await render(tiers, cards);
    const labels = [...host.querySelectorAll("p")].map((n) => n.textContent ?? "");
    expect(labels).not.toContain("계약금 수수료 총액");
    expect(labels.filter((text) => text.includes("올카데미") && text.includes("합계")).length).toBe(0);
  });

  it("차수가 둘이면 카드는 차수 값을 모두 더한다", async () => {
    await render([...tiers, { ...tiers[0], id: "b", label: "2차", 계약금: 2_000_000, "[컨설턴트]_수수료": 600_000, "[위들리]_수수료": 560_000, "[하이브]_계약금_수수료": 840_000 }], cards);
    expect(totalOf("계약금 총액")).toBe("3,000,000원");
    expect(totalOf("[컨설턴트] 계약금 수수료")).toBe("900,000원");
    expect(totalOf("[위들리] 계약금 수수료")).toBe("840,000원");
    expect(totalOf("[하이브] 계약금 수수료")).toBe("1,260,000원");
  });
});
