// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionPanelProps } from "@wedly/ui-shared";
import { createGovSubsidyPanel } from "./GovSubsidyPanel";

// 새 업체를 등록하는 중에 사업자번호(조회 기준)가 바뀌어도, 방금 만든(또는 만드는 중인) 계약을 잃지 않는 시험.
// 10/15 사고: 연락처 저장 → 사업자번호 입력으로 조회 기준이 바뀌자 패널 범위가 갈라져,
// 진행 중이던 계약 만들기가 사라지고 다음 저장이 계약을 한 번 더 만들었다.

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

function setup() {
  let resolveCreate!: (id: string) => void;
  const create = vi.fn(() => new Promise<string>((resolve) => { resolveCreate = resolve; }));
  const save = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  const captured: { meetings: { onSave: (json: string) => void } | null } = { meetings: null };
  const MeetingsTab = (props: { onSave: (json: string) => void }) => {
    captured.meetings = props;
    return null;
  };
  const Panel = createGovSubsidyPanel({
    editable: true, allowStructureEdit: false, allowNonAdminEdit: true, ownSource: "illua",
    commentsPath: (id) => `/comments/${id}`, contractFieldsPath: "/anchor-fields-contract",
    settlementFieldsPath: "/anchor-fields-settlement", refundFieldsPath: "/anchor-fields-refund",
    configPath: "/anchor-config", createContract: create, savePolicyField: save, filterPolicyRows: (rows) => rows,
  });
  const draw = async (tab: string, primaryRow: Record<string, unknown>) => {
    const props = {
      rows: [] as unknown as SectionPanelProps["rows"], primaryRow, isAdmin: true, hideSubTabBar: true, subTab: tab,
      onSubTabChange: vi.fn(), onSaved: vi.fn(),
      adapter: { api: { currentUser: async () => ({ name: "검사" }) }, components: { MeetingsTab } } as unknown as SectionPanelProps["adapter"],
    };
    await act(async () => root.render(<Panel {...props} />));
  };
  return { create, save, captured, draw, resolveCreate: (id: string) => resolveCreate(id) };
}

async function editField(label: string, value: string) {
  const field = host.querySelector(`[title="${label}"]`)!.parentElement!;
  await act(async () => field.querySelector<HTMLElement>(".cursor-pointer")!.click());
  const input = field.querySelector<HTMLInputElement>("input")!;
  expect(input).toBeTruthy();
  input.value = value;
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}

const NEW_COMPANY = { _id: "new-company", "02상호명": "테스트" };
const WITH_PHONE = { ...NEW_COMPANY, "04연락처": "010-0000-0000" };
const WITH_BIZNO = { ...WITH_PHONE, "15사업자번호": "123-45-67890" };

describe("조회 기준(연락처·사업자번호)이 바뀌어도 같은 회사의 첫 계약 만들기는 하나다", () => {
  it("계약을 만드는 중에 사업자번호가 입력돼도 다음 저장이 계약을 또 만들지 않는다", async () => {
    const t = setup();
    await t.draw("contract", WITH_PHONE);
    await editField("담당자", "첫 담당");
    expect(t.create).toHaveBeenCalledTimes(1);
    // 만드는 중에 사업자번호가 입력되어 조회 기준이 바뀐다.
    await t.draw("meetings", WITH_BIZNO);
    await act(async () => { t.captured.meetings!.onSave('[{"id":"m1"}]'); });
    expect(t.create).toHaveBeenCalledTimes(1);
    await act(async () => t.resolveCreate("created-one"));
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.save.mock.calls.map((c) => c.slice(0, 2))).toEqual(expect.arrayContaining([
      ["created-one", "계약정보_차수"], ["created-one", "_meetings"],
    ]));
    expect(t.save.mock.calls.every((c) => c[0] === "created-one")).toBe(true);
  });

  it("방금 만든 계약이 아직 목록에 안 보이는 사이 조회 기준이 바뀌어도 그 계약에 이어 쓴다", async () => {
    const t = setup();
    await t.draw("meetings", NEW_COMPANY);
    await act(async () => { t.captured.meetings!.onSave('[{"id":"m1"}]'); });
    await act(async () => t.resolveCreate("created-one"));
    expect(t.create).toHaveBeenCalledTimes(1);
    // 조회 기준이 연락처 → 사업자번호로 바뀌고, 목록은 아직 새 줄을 보여 주지 못한다.
    await t.draw("meetings", WITH_PHONE);
    await t.draw("meetings", WITH_BIZNO);
    await act(async () => { t.captured.meetings!.onSave('[{"id":"m2"}]'); });
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.save.mock.calls.map((c) => [c[0], c[1]])).toEqual([["created-one", "_meetings"], ["created-one", "_meetings"]]);
  });

  it("다른 회사(_id 가 다름)는 사업자번호가 같아도 따로 만든다 — 기존 구분 유지", async () => {
    const t = setup();
    await t.draw("meetings", { _id: "company-a", "15사업자번호": "123-45-67890" });
    await act(async () => { t.captured.meetings!.onSave('[{"id":"a"}]'); });
    await t.draw("meetings", { _id: "company-b", "15사업자번호": "123-45-67890" });
    await act(async () => { t.captured.meetings!.onSave('[{"id":"b"}]'); });
    expect(t.create).toHaveBeenCalledTimes(2);
  });

  it("_id 가 아직 없는 행은 예전처럼 사업자번호로 구분한다", async () => {
    const t = setup();
    await t.draw("meetings", { "15사업자번호": "111-11-11111" });
    await act(async () => { t.captured.meetings!.onSave('[{"id":"a"}]'); });
    await t.draw("meetings", { "15사업자번호": "222-22-22222" });
    await act(async () => { t.captured.meetings!.onSave('[{"id":"b"}]'); });
    expect(t.create).toHaveBeenCalledTimes(2);
  });
});
