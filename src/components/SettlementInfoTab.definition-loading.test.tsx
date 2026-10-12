// @vitest-environment jsdom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettlementInfoTab from "./SettlementInfoTab";

const definitions = [
  { key: "계약금", label: "계약금", type: "number" },
  { key: "계약일", label: "계약일", type: "date" },
  { key: "담당자", label: "담당자", type: "text" },
];
const savedTier = { id: "one", label: "1차", 계약금: 123, 계약일: "2026-10-12", 담당자: "기존 담당" };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function props(onSave: (...args: unknown[]) => void) {
  return { rawValue: JSON.stringify([savedTier]), onSave, fieldsApiPath: "/definition-fields-a", configApiPath: "/definition-config",
    storagePrefix: "contract", isAdmin: true, readOnly: false, allowStructureEdit: false,
    ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "원금", ratioFeeLabel: "수수료", defaultScoreCards: [],
  } as ComponentProps<typeof SettlementInfoTab>;
}
function successFields() { return { ok: true, json: async () => ({ success: true, data: definitions }) }; }
function configResponse() { return { ok: true, json: async () => ({ success: true, data: {} }) }; }
async function clickAdd() {
  const add = [...host.querySelectorAll("button")].find(b => /^\+ .*계약 추가$/.test(b.textContent ?? ""));
  expect(add).toBeTruthy(); await act(async () => add!.click());
}
function expectKnownValuesSaved(save: ReturnType<typeof vi.fn>) {
  expect(save).toHaveBeenCalledTimes(1);
  const tiers = JSON.parse(save.mock.calls[0][0] as string);
  expect(tiers).toHaveLength(2); expect(tiers[0]).toMatchObject(savedTier);
}

it("an actual add before delayed definitions makes zero saves, then preserves all known values after load", async () => {
  let resolveFields!: (value: ReturnType<typeof successFields>) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) => String(url).includes("fields")
    ? new Promise(resolve => { resolveFields = resolve; }) : Promise.resolve(configResponse())));
  const save = vi.fn(), initial = props(save);
  await act(async () => root.render(<SettlementInfoTab {...initial} />));
  await clickAdd(); expect(save).not.toHaveBeenCalled();
  expect(host.querySelectorAll('[title="이 차수 삭제"]')).toHaveLength(0);
  await act(async () => resolveFields(successFields()));
  await clickAdd(); expectKnownValuesSaved(save);
});

for (const failure of ["rejected", "unsuccessful", "http-error"] as const) {
  it(`does not treat ${failure} definitions as ready and permits a safe add after later success`, async () => {
    let loaded = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!String(url).includes("fields")) return configResponse();
      if (loaded) return successFields();
      if (failure === "rejected") throw new Error("칸 조회 실패");
      if (failure === "http-error") return { ...successFields(), ok: false };
      return { ok: true, json: async () => ({ success: false, data: definitions }) };
    }));
    const save = vi.fn(), initial = props(save);
    await act(async () => root.render(<SettlementInfoTab {...initial} />));
    await clickAdd(); expect(save).not.toHaveBeenCalled();
    loaded = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await clickAdd(); expectKnownValuesSaved(save);
  });
}

it("a changed definitions path cannot persist with the old path's successful definitions", async () => {
  let resolveFields!: (value: ReturnType<typeof successFields>) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) => String(url).endsWith("fields-b")
    ? new Promise(resolve => { resolveFields = resolve; })
    : Promise.resolve(String(url).includes("fields") ? successFields() : configResponse())));
  const save = vi.fn(), initial = props(save);
  await act(async () => root.render(<SettlementInfoTab {...initial} />));
  await act(async () => root.render(<SettlementInfoTab {...initial} fieldsApiPath="/definition-fields-b" />));
  await clickAdd(); expect(save).not.toHaveBeenCalled();
  await act(async () => resolveFields(successFields()));
  await clickAdd(); expectKnownValuesSaved(save);
});

it("retains previously loaded definitions during a failed refresh of the same path", async () => {
  let failRefresh = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).includes("fields")) return configResponse();
    if (failRefresh) throw new Error("일시 조회 실패");
    return successFields();
  }));
  const save = vi.fn(), initial = props(save);
  await act(async () => root.render(<SettlementInfoTab {...initial} />));
  failRefresh = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  await clickAdd(); expectKnownValuesSaved(save);
});
