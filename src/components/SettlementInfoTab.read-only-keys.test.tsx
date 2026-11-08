// @vitest-environment jsdom
// 차수 카드 readOnlyFieldKeys(노션 요청 2 — 하이브는 수수료 3칸을 읽기만 한다) — 실제 카드를 그려 눌러 본다.
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";

const FEE_KEYS = ["수수료_반올림", "부가세", "총수수료_부가세포함"] as const;
const props = { storagePrefix: "contract", ensureFirstTier: true, addButtonSuffixOverride: "계약", fieldsApiPath: "/ro-fields", configApiPath: "/ro-config", ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "계약금", ratioFeeLabel: "수수료", defaultScoreCards: [], hideSummaryCards: true };

describe("차수 카드 — 읽기 전용으로 지정한 칸만 잠긴다", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fields: FieldDef[];
  let error: ReturnType<typeof vi.spyOn>;
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

  async function render(readOnlyFieldKeys?: readonly string[]) {
    const row = { id: "one", label: "1차 계약", 수수료_반올림: 1000000, 부가세: 100000, 총수수료_부가세포함: 1100000, 메모: "첫 메모" };
    await act(async () => {
      root.render(<StrictMode><SettlementInfoTab {...props} rawValue={JSON.stringify([row])} readOnlyFieldKeys={readOnlyFieldKeys} onSave={() => undefined} /></StrictMode>);
      await settle();
    });
  }
  function fieldBox(label: string) {
    const labelEl = document.querySelector<HTMLElement>(`[title="${label}"]`);
    if (!labelEl?.parentElement) throw new Error(`Missing field ${label}`);
    return labelEl.parentElement;
  }
  const editable = (label: string) => fieldBox(label).querySelector(".cursor-pointer") !== null;

  beforeEach(() => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    fields = [
      { key: "수수료_반올림", label: "수수료(VAT 제외)", type: "number" },
      { key: "부가세", label: "부가세", type: "number" },
      { key: "총수수료_부가세포함", label: "총 수수료(VAT 포함)", type: "number" },
      { key: "메모", label: "메모", type: "text" },
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

  it("지정하지 않으면 네 칸 모두 눌러서 고칠 수 있다", async () => {
    await render();
    expect(editable("수수료(VAT 제외)")).toBe(true);
    expect(editable("부가세")).toBe(true);
    expect(editable("총 수수료(VAT 포함)")).toBe(true);
    expect(editable("메모")).toBe(true);
  });

  it("수수료 3칸을 지정하면 그 3칸만 잠기고 다른 칸은 그대로 고칠 수 있다", async () => {
    await render(FEE_KEYS);
    expect(editable("수수료(VAT 제외)")).toBe(false);
    expect(editable("부가세")).toBe(false);
    expect(editable("총 수수료(VAT 포함)")).toBe(false);
    expect(editable("메모")).toBe(true);
    // 잠가도 값은 그대로 보인다.
    expect(fieldBox("수수료(VAT 제외)").textContent).toContain("1,000,000");
    expect(fieldBox("총 수수료(VAT 포함)").textContent).toContain("1,100,000");
  });

  it("빈 목록을 넘기면 지정하지 않은 것과 같다", async () => {
    await render([]);
    expect(editable("수수료(VAT 제외)")).toBe(true);
  });
});
