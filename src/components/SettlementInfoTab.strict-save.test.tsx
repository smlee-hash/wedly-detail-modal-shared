// @vitest-environment jsdom

import React, { StrictMode, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettlementInfoTab from "./SettlementInfoTab";

type SavedTier = Record<string, unknown>;

const FIELDS = [{ key: "계약금", label: "계약금", type: "number" as const }];
const BASE_PROPS = {
  storagePrefix: "contract",
  ensureFirstTier: true,
  addButtonSuffixOverride: "계약",
  fieldsApiPath: "/contract-fields",
  configApiPath: "/test-config",
  ratioBaseKey: "base",
  ratioFeeKey: "fee",
  ratioBaseLabel: "계약금",
  ratioFeeLabel: "수수료",
  defaultScoreCards: [],
  hideSummaryCards: true,
};

describe("SettlementInfoTab save boundaries", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saves: SavedTier[][];
  let consoleError: ReturnType<typeof vi.spyOn>;

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

  function Parent({ raw, readOnly = false }: { raw: unknown; readOnly?: boolean }) {
    const [, setSaveCount] = useState(0);
    return (
      <SettlementInfoTab
        {...BASE_PROPS}
        rawValue={raw}
        readOnly={readOnly}
        onSave={(jsonValue) => {
          saves.push(JSON.parse(jsonValue) as SavedTier[]);
          setSaveCount((count) => count + 1);
        }}
      />
    );
  }

  async function render(raw: unknown, readOnly = false) {
    await act(async () => {
      root.render(
        <StrictMode>
          <Parent raw={raw} readOnly={readOnly} />
        </StrictMode>,
      );
      await settle();
    });
  }

  function cards() {
    return Array.from(document.querySelectorAll<HTMLDivElement>("div.rounded-2xl.shadow-sm"))
      .filter((card) => card.querySelector("h4"));
  }

  function buttonEndingWith(text: string) {
    const normalized = text.replace(/\s/g, "");
    return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.replace(/\s/g, "").endsWith(normalized));
  }

  async function click(target: Element | null | undefined) {
    if (!target) throw new Error("Missing click target");
    await act(async () => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settle();
    });
  }

  async function editDisplayedAmount(displayIndex: number, value: number) {
    const card = cards()[displayIndex];
    const label = card?.querySelector('[title="계약금"]');
    await click(label?.parentElement?.querySelector(".cursor-pointer"));

    const input = card.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error("Missing amount input");
    await act(async () => {
      input.value = String(value);
      input.blur();
      await settle();
    });
  }

  function renderPhaseErrors() {
    return consoleError.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((message) => message.includes("Cannot update a component"));
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    saves = [];
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        success: true,
        data: String(input).includes("fields") ? FIELDS : {},
      }),
    })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not save while opening, cancelling deletion, or viewing read-only data", async () => {
    await render(JSON.stringify([{ id: "one", label: "1차 계약", 계약금: 1_100_000 }]));
    expect(saves).toEqual([]);

    await click(cards()[0].querySelector('button[title*="삭제"]'));
    expect(saves).toEqual([]);
    await click(buttonEndingWith("취소"));
    expect(saves).toEqual([]);

    await render("[]", true);
    expect(saves).toEqual([]);
    expect(buttonEndingWith("2차 계약 추가")).toBeUndefined();
    expect(document.querySelectorAll('[title="계약금"] ~ div .cursor-pointer')).toHaveLength(0);
    expect(renderPhaseErrors()).toEqual([]);
  });

  it("saves each edit, addition, and confirmed deletion once while retaining earlier amounts", async () => {
    await render("[]");
    expect(saves).toEqual([]);
    expect(cards()).toHaveLength(1);

    await editDisplayedAmount(0, 1_100_000);
    expect(saves).toHaveLength(1);
    expect(saves[saves.length - 1]?.[0]?.계약금).toBe(1_100_000);

    await click(buttonEndingWith("2차 계약 추가"));
    expect(saves).toHaveLength(2);
    expect(saves[saves.length - 1]?.[0]?.계약금).toBe(1_100_000);

    await editDisplayedAmount(0, 2_200_000);
    expect(saves).toHaveLength(3);
    expect(saves[saves.length - 1]?.map((tier) => tier.계약금)).toEqual([1_100_000, 2_200_000]);

    await click(buttonEndingWith("3차 계약 추가"));
    expect(saves).toHaveLength(4);
    expect(saves[saves.length - 1]?.slice(0, 2).map((tier) => tier.계약금)).toEqual([1_100_000, 2_200_000]);

    await render(JSON.stringify([{ id: "last", label: "1차 계약", 계약금: 1_100_000 }]));
    saves = [];
    await click(cards()[0].querySelector('button[title*="삭제"]'));
    expect(saves).toEqual([]);
    await click(document.querySelector('[role="dialog"] button.bg-wedly-red'));
    expect(saves).toEqual([[]]);
    expect(cards()).toHaveLength(1);
    expect(renderPhaseErrors()).toEqual([]);
  });

  it("keeps every tier when additions are dispatched in one React action", async () => {
    await render(JSON.stringify([{ id: "one", label: "1차 계약", 계약금: 1_100_000 }]));
    const addButton = buttonEndingWith("2차 계약 추가");
    if (!addButton) throw new Error("Missing add button");

    await act(async () => {
      addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settle();
    });

    expect(saves).toHaveLength(2);
    expect(saves[0]).toHaveLength(2);
    expect(saves[1]).toHaveLength(3);
    expect(saves[1][0]?.계약금).toBe(1_100_000);
    expect(cards()).toHaveLength(3);
    expect(renderPhaseErrors()).toEqual([]);
  });

  it("uses reloaded raw data as the basis for the next edit without saving the reload", async () => {
    await render(JSON.stringify([{ id: "old", label: "1차 계약", 계약금: 100_000 }]));
    expect(saves).toEqual([]);

    await render(JSON.stringify([
      { id: "first", label: "1차 계약", 계약금: 3_300_000 },
      { id: "second", label: "2차 계약", 계약금: 4_400_000 },
    ]));
    expect(saves).toEqual([]);

    await editDisplayedAmount(0, 5_500_000);
    expect(saves).toHaveLength(1);
    expect(saves[0].map((tier) => tier.계약금)).toEqual([3_300_000, 5_500_000]);
    expect(renderPhaseErrors()).toEqual([]);
  });
});
