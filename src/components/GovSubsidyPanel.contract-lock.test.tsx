// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLoadStateProvider, type SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

// 계약 목록을 못 불러왔을 때(rowsLoadFailed) 계약정보·정산정보·환불정보·미팅정보를 히스토리처럼 잠그는 시험.
// 진짜 @wedly/ui-shared 의 DetailLoadStateProvider 로 「못 불러옴」을 흉내 낸다.

const TITLE = "계약 정보를 불러오지 못했어요";
const LOCK_BODY = "지금 입력하면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다";
const HISTORY_BODY = "지금 글을 남기면 이 회사에 계약 줄이 새로 생길 수 있어 입력을 잠갔습니다";
const DROPPED = "계약 정보를 불러오지 못해 방금 입력한 값은 저장하지 않았습니다";
const fields = [
  { key: "계약금", label: "계약금", type: "number" },
  { key: "담당컨설턴트", label: "담당자", type: "text" },
];

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : {} }) })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function owner() {
  return {
    domain: "government-subsidy", entryId: "first", domainLabel: "정부지원금",
    row: { 계약정보_차수: JSON.stringify([{ id: "one", 계약금: 100, 담당컨설턴트: "기존" }]) },
  };
}

type Captured = { meetings: { onSave: (json: string) => void } | null };
function setup(over: Partial<GovSubsidyPanelConfig> = {}) {
  const create = vi.fn(async () => "created-one");
  const save = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  const captured: Captured = { meetings: null };
  const MeetingsTab = (props: { onSave: (json: string) => void }) => {
    captured.meetings = props;
    return <div data-testid="meetings-tab">미팅 부품</div>;
  };
  const Panel = createGovSubsidyPanel({
    editable: true, allowStructureEdit: false, allowNonAdminEdit: true, ownSource: "illua",
    commentsPath: (id) => `/comments/${id}`, contractFieldsPath: "/lock-fields-contract",
    settlementFieldsPath: "/lock-fields-settlement", refundFieldsPath: "/lock-fields-refund",
    configPath: "/lock-config", createContract: create, savePolicyField: save, filterPolicyRows: (rows) => rows, ...over,
  });
  const base = {
    rows: [] as unknown as SectionPanelProps["rows"], primaryRow: { _id: "customer-one" } as Record<string, unknown>,
    isAdmin: true, hideSubTabBar: true, onSubTabChange: vi.fn(), onSaved: vi.fn(),
    adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab } } as unknown as SectionPanelProps["adapter"],
  };
  const draw = async (tab: string, opt: { failed: boolean; rows?: unknown[]; primaryRow?: Record<string, unknown> }) => {
    const props = { ...base, subTab: tab, rows: (opt.rows ?? []) as SectionPanelProps["rows"], primaryRow: opt.primaryRow ?? base.primaryRow };
    await act(async () => root.render(
      <DetailLoadStateProvider rowsLoadFailed={opt.failed}><Panel {...props} /></DetailLoadStateProvider>,
    ));
  };
  return { create, save, captured, draw, base };
}

const hasField = (label: string) => host.querySelector(`[title="${label}"]`) !== null;
const alerts = () => [...host.querySelectorAll('[role="alert"]')].map((e) => e.textContent ?? "");

describe("계약 목록을 못 불러왔을 때 4개 탭 잠금", () => {
  for (const [tab, label] of [["contract", "계약정보"], ["settlement", "정산정보"], ["refund", "환불정보"], ["meetings", "미팅정보"]] as const) {
    it(`${label}: 빨간 상자만 보이고 칸·추가 단추·미팅 부품은 없다. 계약도 만들지 않는다`, async () => {
      const t = setup();
      await t.draw(tab, { failed: true });
      expect(host.textContent).toContain(TITLE);
      expect(host.textContent).toContain(LOCK_BODY);
      expect(hasField("계약금")).toBe(false);
      expect(host.textContent).not.toContain("추가");
      expect(host.querySelector('[data-testid="meetings-tab"]')).toBeNull();
      expect(host.querySelector("input, textarea")).toBeNull();
      expect(t.create).not.toHaveBeenCalled();
      expect(t.save).not.toHaveBeenCalled();
    });
  }

  it("히스토리 탭은 지금 그대로다(본문은 「글을 남기면」)", async () => {
    const t = setup();
    await t.draw("history", { failed: true });
    expect(host.textContent).toContain(TITLE);
    expect(host.textContent).toContain(HISTORY_BODY);
    expect(host.textContent).not.toContain(LOCK_BODY);
  });

  it("목록을 제대로 받았으면(계약 0건) 계약정보 칸이 열려 있고 상자는 없다 — 계약이 정말 없는 회사의 평소 화면", async () => {
    const t = setup();
    await t.draw("contract", { failed: false });
    expect(host.textContent).not.toContain(TITLE);
    expect(hasField("계약금")).toBe(true);
  });

  it("못 불러왔어도 이미 보이는 계약이 있으면 지금처럼 고칠 수 있다", async () => {
    const t = setup();
    await t.draw("contract", { failed: true, rows: [owner()] });
    expect(host.textContent).not.toContain(TITLE);
    expect(hasField("계약금")).toBe(true);
  });

  it("목록을 다시 받으면 잠금이 풀려 칸이 다시 열린다", async () => {
    const t = setup();
    await t.draw("contract", { failed: true });
    expect(hasField("계약금")).toBe(false);
    await t.draw("contract", { failed: false, rows: [owner()] });
    expect(host.textContent).not.toContain(TITLE);
    expect(hasField("계약금")).toBe(true);
  });
});

describe("입력하던 중에 목록 받기가 끊기면", () => {
  it("방금 입력한 값은 저장하지 않고 위쪽 빨간 줄 안내를 한 번만 띄운다", async () => {
    const t = setup();
    await t.draw("contract", { failed: false });
    const field = host.querySelector(`[title="담당자"]`)!.parentElement!;
    await act(async () => field.querySelector<HTMLElement>(".cursor-pointer")!.click());
    const input = field.querySelector<HTMLInputElement>("input")!;
    expect(input).toBeTruthy();
    // 글자를 치는 중 — 아직 칸을 떠나지 않았다.
    await act(async () => { input.value = "새 담당"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await t.draw("contract", { failed: true });
    expect(host.textContent).toContain(TITLE);
    expect(t.create).not.toHaveBeenCalled();
    expect(t.save).not.toHaveBeenCalled();
    expect(alerts().filter((a) => a.includes(DROPPED))).toHaveLength(1);
    expect(host.textContent!.split(DROPPED).length - 1).toBe(1);
    // 다시 그려도 늘어나지 않는다.
    await t.draw("contract", { failed: true });
    expect(host.textContent!.split(DROPPED).length - 1).toBe(1);
  });

  it("칸을 건드리지 않았으면 안내를 띄우지 않는다 — 잠금 상자만", async () => {
    const t = setup();
    await t.draw("contract", { failed: false });
    await t.draw("contract", { failed: true });
    expect(host.textContent).toContain(TITLE);
    expect(host.textContent).not.toContain(DROPPED);
  });

  it("목록을 다시 받으면 안내가 사라진다", async () => {
    const t = setup();
    await t.draw("contract", { failed: false });
    const field = host.querySelector(`[title="담당자"]`)!.parentElement!;
    await act(async () => field.querySelector<HTMLElement>(".cursor-pointer")!.click());
    const input = field.querySelector<HTMLInputElement>("input")!;
    await act(async () => { input.value = "새 담당"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await t.draw("contract", { failed: true });
    expect(host.textContent).toContain(DROPPED);
    await t.draw("contract", { failed: false, rows: [owner()] });
    expect(host.textContent).not.toContain(DROPPED);
  });

  it("잠기기 전에 받아 둔 저장 함수(미팅 저장)를 잠긴 뒤에 불러도 계약을 만들지 않고 안내를 한 번만 띄운다", async () => {
    const t = setup();
    await t.draw("meetings", { failed: false });
    const staleSave = t.captured.meetings!.onSave;
    await t.draw("meetings", { failed: true });
    await act(async () => { staleSave('[{"id":"m1"}]'); });
    await act(async () => { staleSave('[{"id":"m2"}]'); });
    expect(t.create).not.toHaveBeenCalled();
    expect(t.save).not.toHaveBeenCalled();
    expect(host.textContent!.split(DROPPED).length - 1).toBe(1);
  });

  it("목록을 받은 평소에는 미팅 저장이 계약 0건 회사에서 지금처럼 계약을 한 번 만든다", async () => {
    const t = setup();
    await t.draw("meetings", { failed: false });
    await act(async () => { t.captured.meetings!.onSave('[{"id":"m1"}]'); });
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.save.mock.calls[0].slice(0, 2)).toEqual(["created-one", "_meetings"]);
  });
});
