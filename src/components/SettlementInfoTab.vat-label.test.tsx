// @vitest-environment jsdom
// NO.771 요청 3 §3 — 차수 카드 칸 이름 끝의 「(VAT 제외)」는 떼고 이름 옆에 작은 회색 「VAT 제외」로 보인다.
// 저장된 칸 이름·값은 그대로다. 「(VAT 포함)」은 이름에 그대로 남는다.
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";
import { splitVatLabel } from "./vat-label";

const props = { storagePrefix: "contract", ensureFirstTier: true, addButtonSuffixOverride: "계약", fieldsApiPath: "/vat-fields", configApiPath: "/vat-config", ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "계약금", ratioFeeLabel: "수수료", defaultScoreCards: [], hideSummaryCards: true };

describe("splitVatLabel — 이름 끝 「(VAT 제외)」만 뗀다", () => {
  it("끝의 (VAT 제외)를 떼고 표시 여부를 돌려준다", () => {
    expect(splitVatLabel("수수료(VAT 제외)")).toEqual({ name: "수수료", vatExcluded: true });
    expect(splitVatLabel("예상 수수료 (VAT 제외)")).toEqual({ name: "예상 수수료", vatExcluded: true });
    expect(splitVatLabel("매출(VAT제외)")).toEqual({ name: "매출", vatExcluded: true });
  });
  it("(VAT 포함)·표시 없는 이름·가운데 글자는 그대로 둔다", () => {
    expect(splitVatLabel("총 수수료(VAT 포함)")).toEqual({ name: "총 수수료(VAT 포함)", vatExcluded: false });
    expect(splitVatLabel("부가세")).toEqual({ name: "부가세", vatExcluded: false });
    expect(splitVatLabel("(VAT 제외) 메모")).toEqual({ name: "(VAT 제외) 메모", vatExcluded: false });
    expect(splitVatLabel("(VAT 제외)")).toEqual({ name: "(VAT 제외)", vatExcluded: false }); // 떼면 이름이 비므로 그대로
  });
});

describe("차수 카드 — 칸 이름의 VAT 표기", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fields: FieldDef[];
  let error: ReturnType<typeof vi.spyOn>;
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

  async function render() {
    const row = { id: "one", label: "1차 계약", 예상수수료: 2000000, 수수료_반올림: 1000000, 총수수료_부가세포함: 1100000, 부가세: 100000 };
    await act(async () => {
      root.render(<StrictMode><SettlementInfoTab {...props} rawValue={JSON.stringify([row])} onSave={() => undefined} /></StrictMode>);
      await settle();
    });
  }
  // 칸 이름 줄 — 마우스를 올리면 뜨는 글(title)은 저장된 이름 전체 그대로다.
  function labelLine(stored: string) {
    const el = container.querySelector<HTMLElement>(`[title="${stored}"]`);
    if (!el) throw new Error(`Missing field ${stored}`);
    return el;
  }
  const vatTag = (line: HTMLElement) => [...line.querySelectorAll("span")].filter((s) => s.textContent === "VAT 제외");

  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    fields = [
      { key: "예상수수료", label: "예상 수수료(VAT 제외)", type: "number" },
      { key: "수수료_반올림", label: "수수료(VAT 제외)", type: "number" },
      { key: "총수수료_부가세포함", label: "총 수수료(VAT 포함)", type: "number" },
      { key: "부가세", label: "부가세", type: "number" },
      { key: "합계", label: "합계(VAT 제외)", type: "formula", formula: [{ op: "+", unit: "column", columnKey: "부가세" }] },
    ];
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => ({
      ok: true, json: async () => ({ success: true, data: String(input).includes("fields") ? fields : {} }),
    })));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    error.mockRestore(); vi.unstubAllGlobals();
  });

  it("「(VAT 제외)」 칸은 이름에서 떼고 옆에 작은 회색 「VAT 제외」를 붙인다", async () => {
    await render();
    for (const [stored, name] of [["예상 수수료(VAT 제외)", "예상 수수료"], ["수수료(VAT 제외)", "수수료"]] as const) {
      const line = labelLine(stored);
      expect(line.textContent).toBe(`${name}VAT 제외`);
      const tags = vatTag(line);
      expect(tags).toHaveLength(1);
      expect(tags[0].className).toContain("text-wedly-muted");
      expect(tags[0].className).toContain("text-[10px]");
    }
    expect(labelLine("합계(VAT 제외)").textContent).toBe("합계VAT 제외(수식)"); // 「VAT 제외」는 (수식) 앞
  });

  it("「(VAT 포함)」 칸과 표시 없는 칸은 이름을 그대로 두고 「VAT 제외」를 붙이지 않는다", async () => {
    await render();
    expect(labelLine("총 수수료(VAT 포함)").textContent).toBe("총 수수료(VAT 포함)");
    expect(vatTag(labelLine("총 수수료(VAT 포함)"))).toHaveLength(0);
    expect(labelLine("부가세").textContent).toBe("부가세");
    expect(vatTag(labelLine("부가세"))).toHaveLength(0);
  });

  it("이름 표시만 바꾸고 값은 그대로 보인다", async () => {
    await render();
    expect(labelLine("수수료(VAT 제외)").parentElement?.textContent).toContain("1,000,000");
    expect(labelLine("예상 수수료(VAT 제외)").parentElement?.textContent).toContain("2,000,000");
  });
});
