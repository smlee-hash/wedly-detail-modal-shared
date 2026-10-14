import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

// 히스토리 소유 계약 분리(filterHistoryRows) 시험.
//
// 이 작업 사본에는 DOM 환경(jsdom·testing-library)이 없어 서버 렌더(renderToStaticMarkup)만 쓴다.
// 그래서 ① 공용 부품(@wedly/ui-shared)·SettlementInfoTab 은 「받은 prop 을 잡아 두는 가짜」로 바꾸고,
// ② 서버 렌더는 단추를 누를 수 없으니 하위 탭의 시작값만 시험이 정한다(react 의 useState 를 감싸 "history" 시작값만 바꿈).
// 시험은 진짜 GovSubsidyPanel 을 그려서, 진짜 코드가 HistoryPanel 에 넘긴 어댑터(fetch/create/edit/remove)와
// SettlementInfoTab/MeetingsTab 에 넘긴 onSave(= 수수료·미팅 저장)를 그대로 불러 본다.

type TestComment = { id: string; text: string };
type HistoryAdapterLike = {
  fetch: () => Promise<{ comments: TestComment[] }>;
  create: (a: { text: string; category?: string }) => Promise<TestComment[]>;
  edit: (a: { commentId: string; text: string }) => Promise<TestComment[]>;
  remove: (a: { commentId: string }) => Promise<TestComment[]>;
};
type HistoryPanelProps = { pageId: string; draftId: string; readOnly: boolean; adapter: HistoryAdapterLike };
type MeetingsProps = { rawValue: unknown; onSave: (json: string) => unknown; readOnly?: boolean };

const h = vi.hoisted(() => ({
  tab: "history" as string,
  rowsLoadFailed: false,
  historyProps: null as HistoryPanelProps | null,
  settlement: [] as Array<Record<string, unknown>>,
  meetings: null as MeetingsProps | null,
}));

vi.mock("react", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown> & { default?: Record<string, unknown> }>();
  const real = { ...mod, ...(mod.default ?? {}) } as Record<string, unknown> & { useState: (init: unknown) => unknown };
  return {
    ...real,
    default: real,
    useState: (init: unknown) => real.useState(init === "history" ? h.tab : init),
  };
});

vi.mock("@wedly/ui-shared", () => ({
  HistoryPanel: (props: HistoryPanelProps) => {
    h.historyProps = props;
    return null;
  },
  timeAgo: () => "",
  COMMON_BASIC_FIELD_SPECS: [],
  useDetailLoadState: () => ({ rowsLoadFailed: h.rowsLoadFailed }),
  checkApiResult: (res: { ok: boolean }) => (res.ok ? "none" : "http"),
  makePersistError: (_bad: string, reason: string) => new Error(reason),
  failureReason: (bad: string) => `요청 실패(${bad})`,
}));

vi.mock("./SettlementInfoTab", () => ({
  default: (props: Record<string, unknown>) => {
    h.settlement.push(props);
    return null;
  },
}));

type Rows = Parameters<GovSubsidyPanelConfig["filterPolicyRows"]>[0];
type RowT = Rows[number];

const HIST = "/api/hist/";
const PRIMARY = { "15사업자번호": "123-45-67890" };
const row = (entryId: string) => ({ entryId, domain: "government-subsidy", row: { _entry: entryId } }) as unknown as RowT;
// 시험 규약: entryId "p…" = 정책(수수료) 계약, "f…" = 무상(free) 계약.
const isPolicy = (r: RowT) => r.entryId.startsWith("p");
const isFree = (r: RowT) => r.entryId.startsWith("f");

function baseConfig(over: Partial<GovSubsidyPanelConfig> = {}): GovSubsidyPanelConfig {
  return {
    editable: true,
    allowStructureEdit: false,
    allowNonAdminEdit: true,
    ownSource: "hive",
    commentsPath: (id) => `${HIST}${id}`,
    contractFieldsPath: "/api/fields/contract",
    refundFieldsPath: "/api/fields/refund",
    settlementFieldsPath: "/api/fields/settlement",
    configPath: "/api/config",
    filterPolicyRows: (rows) => rows.filter(isPolicy),
    createContract: vi.fn<(primaryRow: Record<string, unknown>) => Promise<string>>(async () => "p-new"),
    savePolicyField: vi.fn<(id: string, key: string, value: string | number | boolean | null) => Promise<void>>(async () => {}),
    ...over,
  };
}

// 히스토리 소유 = 정책+무상 전부(받은 순서 그대로).
const historyConfig = (over: Partial<GovSubsidyPanelConfig> = {}) =>
  baseConfig({ filterHistoryRows: (rows) => rows.filter((r) => isPolicy(r) || isFree(r)), ...over });

function render(config: GovSubsidyPanelConfig, rows: Rows, tab: "history" | "contract" | "meetings" = "history") {
  h.tab = tab;
  h.historyProps = null;
  h.settlement.length = 0;
  h.meetings = null;
  const onSaved = vi.fn();
  const MeetingsTab = (props: MeetingsProps) => {
    h.meetings = props;
    return null;
  };
  const adapter = { api: { currentUser: async () => ({ name: "tester" }) }, components: { MeetingsTab } };
  const Panel = createGovSubsidyPanel(config) as unknown as ComponentType<Record<string, unknown>>;
  const html = renderToStaticMarkup(createElement(Panel, { rows, primaryRow: PRIMARY, isAdmin: true, onSaved, adapter }));
  return { html, onSaved };
}

function historyAdapter(): HistoryAdapterLike {
  if (!h.historyProps) throw new Error("HistoryPanel 이 그려지지 않았다");
  return h.historyProps.adapter;
}

function contractSave(): (json: string) => Promise<void> {
  const p = h.settlement.find((s) => s.storagePrefix === "contract");
  if (!p) throw new Error("계약정보 SettlementInfoTab 이 그려지지 않았다");
  return p.onSave as (json: string) => Promise<void>;
}

// 계약(entryId)별 댓글 저장소 흉내. GET=읽기, POST/PATCH/DELETE=쓰기. failRead/failWrite 에 든 계약은 500.
function installBackend(initial: Record<string, TestComment[]>, opts: { failRead?: string[]; failWrite?: string[] } = {}) {
  const store = new Map<string, TestComment[]>(Object.entries(initial).map(([k, v]) => [k, v.map((c) => ({ ...c }))]));
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  let seq = 0;
  const reply = (ok: boolean, data: unknown) => ({ ok, status: ok ? 200 : 500, json: async () => ({ success: ok, data }) });
  const fake = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const owner = url.slice(HIST.length);
    if ((method === "GET" ? opts.failRead : opts.failWrite)?.includes(owner)) return reply(false, null);
    const list = store.get(owner) ?? [];
    store.set(owner, list);
    if (method === "POST") list.push({ id: `new-${++seq}`, text: body.text });
    if (method === "PATCH") {
      const hit = list.find((c) => c.id === body.commentId);
      if (hit) hit.text = body.text;
    }
    if (method === "DELETE") store.set(owner, list.filter((c) => c.id !== body.commentId));
    return reply(true, (store.get(owner) ?? []).map((c) => ({ ...c })));
  });
  vi.stubGlobal("fetch", fake);
  return {
    fake,
    calls,
    trace: () => calls.map((c) => `${c.method} ${c.url}`),
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}

beforeEach(() => {
  h.tab = "history";
  h.rowsLoadFailed = false;
  h.historyProps = null;
  h.settlement.length = 0;
  h.meetings = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("무상 계약만 있는 히스토리", () => {
  it("히스토리 패널이 무상 계약으로 열리고 읽기·쓰기가 그 계약으로 간다", async () => {
    const be = installBackend({ f1: [{ id: "c-f1", text: "무상 메모" }] });
    const { html } = render(historyConfig(), [row("f1")]);

    expect(html).not.toContain("히스토리 남기기"); // 첫 메모 입력칸(composer)이 아니라 패널
    expect(h.historyProps?.pageId).toBe("f1");
    expect(h.historyProps?.draftId).toBe("f1");

    const a = historyAdapter();
    expect(await a.fetch()).toEqual({ comments: [{ id: "c-f1", text: "무상 메모" }] });
    await a.create({ text: "새 글", category: "x" });
    expect(be.writes()).toEqual([{ method: "POST", url: "/api/hist/f1", body: { text: "새 글", category: "x" } }]);
  });

  it("같은 행을 훅 없이 그리면 예전대로 정책 계약이 없는 것 — 첫 메모 입력칸이 열린다", () => {
    installBackend({});
    const { html } = render(baseConfig(), [row("f1")]);
    expect(html).toContain("히스토리 남기기");
    expect(h.historyProps).toBeNull();
  });
});

describe("수수료·미팅 저장은 정책 계약(filterPolicyRows)에만 간다", () => {
  it("무상 계약만 있을 때 첫 수수료 저장은 정책 계약을 새로 만들고 무상 계약에는 쓰지 않는다", async () => {
    const be = installBackend({ f1: [] });
    const createContract = vi.fn<(primaryRow: Record<string, unknown>) => Promise<string>>(async () => "p-new");
    const savePolicyField = vi.fn<(id: string, key: string, value: string | number | boolean | null) => Promise<void>>(async () => {});
    const { onSaved } = render(historyConfig({ createContract, savePolicyField }), [row("f1")], "contract");

    const save = contractSave();
    await save('{"fee":1}');
    await save('{"fee":2}'); // 두 번째는 방금 만든 계약을 재사용(기존 동작)

    expect(createContract).toHaveBeenCalledTimes(1);
    expect(createContract).toHaveBeenCalledWith(PRIMARY);
    expect(savePolicyField.mock.calls).toEqual([
      ["p-new", "계약정보_차수", '{"fee":1}'],
      ["p-new", "계약정보_차수", '{"fee":2}'],
    ]);
    expect(savePolicyField.mock.calls.some(([id]) => id === "f1")).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(be.calls).toEqual([]); // 수수료 저장은 댓글 통로를 건드리지 않는다
  });

  it("정책+무상이면 수수료·미팅 저장은 정책 계약으로만 가고 계약을 새로 만들지 않는다", async () => {
    installBackend({});
    const createContract = vi.fn<(primaryRow: Record<string, unknown>) => Promise<string>>(async () => "p-new");
    const savePolicyField = vi.fn<(id: string, key: string, value: string | number | boolean | null) => Promise<void>>(async () => {});
    const config = historyConfig({ createContract, savePolicyField });

    render(config, [row("f1"), row("p1")], "contract");
    await contractSave()('{"fee":9}');

    render(config, [row("f1"), row("p1")], "meetings");
    expect(h.meetings?.readOnly).toBe(false);
    await h.meetings!.onSave('{"m":1}');

    expect(savePolicyField.mock.calls).toEqual([
      ["p1", "계약정보_차수", '{"fee":9}'],
      ["p1", "_meetings", '{"m":1}'],
    ]);
    expect(createContract).not.toHaveBeenCalled();
  });

  it("행이 아예 없으면 지금처럼 첫 메모 입력칸이 열리고 첫 저장이 계약을 만든다", async () => {
    installBackend({});
    const createContract = vi.fn<(primaryRow: Record<string, unknown>) => Promise<string>>(async () => "p-new");
    const savePolicyField = vi.fn<(id: string, key: string, value: string | number | boolean | null) => Promise<void>>(async () => {});
    const config = historyConfig({ createContract, savePolicyField });

    expect(render(config, []).html).toContain("히스토리 남기기");

    render(config, [], "contract");
    await contractSave()('{"fee":1}');
    expect(createContract).toHaveBeenCalledTimes(1);
    expect(savePolicyField).toHaveBeenCalledWith("p-new", "계약정보_차수", '{"fee":1}');
  });
});

describe("정책+무상 히스토리", () => {
  it("정책 히스토리를 유지하고 훅이 정한 첫 행을 히스토리 대표로 쓴다", async () => {
    const be = installBackend({
      p1: [{ id: "c-p1", text: "정책 메모" }],
      f1: [{ id: "c-f1", text: "무상 메모" }],
    });
    // 훅이 무상 행을 먼저 주면 히스토리 대표만 무상 행이 된다. 계약 저장 대상은 그대로다.
    render(historyConfig(), [row("f1"), row("p1")]);
    expect(h.historyProps?.pageId).toBe("f1");
    expect(h.historyProps?.draftId).toBe("f1");

    const out = await historyAdapter().fetch();
    // 소유 계약 순서(f1, p1)대로 합쳐지고 정책 계약의 기존 댓글이 빠지지 않는다.
    expect(out.comments).toEqual([
      { id: "c-f1", text: "무상 메모" },
      { id: "c-p1", text: "정책 메모" },
    ]);
    expect(be.calls.map((c) => c.url).sort()).toEqual(["/api/hist/f1", "/api/hist/p1"]);
    expect(be.fake).toHaveBeenCalledWith("/api/hist/p1", { cache: "no-store" });
  });
});

describe("수정·삭제·작성은 소유 계약대로", () => {
  it("수정·삭제는 댓글을 읽어 온 원래 계약으로 가고 새 글은 대표 계약으로 간다 — 쓴 뒤 모든 계약을 다시 읽는다", async () => {
    const be = installBackend({
      p1: [{ id: "c-p1", text: "정책" }],
      f1: [{ id: "c-f1", text: "무상" }],
    });
    render(historyConfig(), [row("p1"), row("f1")]);
    const a = historyAdapter();
    await a.fetch();
    be.calls.length = 0;

    // 무상 계약의 댓글 수정 → 무상 계약으로만 PATCH, 그 뒤 둘 다 다시 읽음
    const afterEdit = await a.edit({ commentId: "c-f1", text: "무상(수정)" });
    expect(be.trace()).toEqual(["PATCH /api/hist/f1", "GET /api/hist/p1", "GET /api/hist/f1"]);
    expect(be.calls[0].body).toEqual({ commentId: "c-f1", text: "무상(수정)" });
    expect(afterEdit).toEqual([
      { id: "c-p1", text: "정책" },
      { id: "c-f1", text: "무상(수정)" },
    ]);

    // 정책 계약의 댓글 삭제 → 정책 계약으로만 DELETE
    be.calls.length = 0;
    const afterRemove = await a.remove({ commentId: "c-p1" });
    expect(be.trace()).toEqual(["DELETE /api/hist/p1", "GET /api/hist/p1", "GET /api/hist/f1"]);
    expect(be.calls[0].body).toEqual({ commentId: "c-p1" });
    expect(afterRemove).toEqual([{ id: "c-f1", text: "무상(수정)" }]);

    // 새 글 → 대표(p1)로 POST, 합친 목록을 돌려줌. 위 읽기로 확정 목록이 이미 있으니 쓰기 전 추가 읽기는 없다
    // (확정 목록이 없을 때의 쓰기 전 읽기는 아래 「확정된 목록이 없는 채…」 시험이 따로 본다).
    be.calls.length = 0;
    const afterCreate = await a.create({ text: "새 글", category: "x" });
    expect(be.trace()).toEqual(["POST /api/hist/p1", "GET /api/hist/p1", "GET /api/hist/f1"]);
    expect(afterCreate.map((c) => c.text)).toEqual(["새 글", "무상(수정)"]);
  });

  it("소유 계약을 모르거나 모호한 댓글은 아무 계약에도 쓰지 않고 실패한다", async () => {
    const be = installBackend({
      p1: [{ id: "dup", text: "a" }, { id: "only-p1", text: "b" }],
      f1: [{ id: "dup", text: "c" }],
    });
    render(historyConfig(), [row("p1"), row("f1")]);
    const a = historyAdapter();

    // 아직 한 번도 못 읽었으면 어느 계약 댓글인지 모른다.
    await expect(a.edit({ commentId: "only-p1", text: "x" })).rejects.toThrow("확인하지 못했습니다");

    await a.fetch();
    await expect(a.edit({ commentId: "dup", text: "x" })).rejects.toThrow("여러 계약");
    await expect(a.remove({ commentId: "dup" })).rejects.toThrow("여러 계약");
    await expect(a.edit({ commentId: "ghost", text: "x" })).rejects.toThrow("확인하지 못했습니다");
    await expect(a.remove({ commentId: "ghost" })).rejects.toThrow("확인하지 못했습니다");
    expect(be.writes()).toEqual([]);

    // 한 계약에만 있는 id 는 정상 — 모호한 것만 막힌다.
    await a.edit({ commentId: "only-p1", text: "x" });
    expect(be.writes()).toEqual([{ method: "PATCH", url: "/api/hist/p1", body: { commentId: "only-p1", text: "x" } }]);
  });

  it("한 계약이라도 읽기에 실패하면 읽기 전체가 실패한다(일부만 보여 주지 않는다)", async () => {
    installBackend(
      { p1: [{ id: "c-p1", text: "정책" }], f1: [{ id: "c-f1", text: "무상" }] },
      { failRead: ["f1"] },
    );
    render(historyConfig(), [row("p1"), row("f1")]);
    await expect(historyAdapter().fetch()).rejects.toThrow("요청 실패");
  });

  it("쓰기 성공 뒤 조회 실패는 저장 성공 목록을 반환하고 진짜 쓰기 실패만 거절한다", async () => {
    const opts = { failRead: [] as string[] };
    const readFail = installBackend({ p1: [{ id: "c-p1", text: "정책" }], f1: [{ id: "c-f1", text: "무상" }] }, opts);
    render(historyConfig(), [row("p1"), row("f1")]);
    const saved = historyAdapter();
    await saved.fetch();
    opts.failRead.push("f1");
    await expect(saved.create({ text: "글" })).resolves.toEqual([
      { id: "c-p1", text: "정책" }, { id: "new-1", text: "글" }, { id: "c-f1", text: "무상" },
    ]);
    expect(readFail.writes()).toEqual([{ method: "POST", url: "/api/hist/p1", body: { text: "글" } }]);
    await expect(saved.edit({ commentId: "new-1", text: "고침" })).resolves.toContainEqual({ id: "new-1", text: "고침" });
    await expect(saved.remove({ commentId: "c-f1" })).resolves.not.toContainEqual({ id: "c-f1", text: "무상" });

    vi.unstubAllGlobals();
    const writeFail = installBackend(
      { p1: [{ id: "c-p1", text: "정책" }], f1: [{ id: "c-f1", text: "무상" }] },
      { failWrite: ["f1"] },
    );
    render(historyConfig(), [row("p1"), row("f1")]);
    const a = historyAdapter();
    await a.fetch();
    writeFail.calls.length = 0;
    await expect(a.edit({ commentId: "c-f1", text: "x" })).rejects.toThrow("요청 실패");
    expect(writeFail.trace()).toEqual(["PATCH /api/hist/f1"]);
  });

  it("다른 소유자 목록을 한 번도 못 읽으면 저장 전에 멈춘다", async () => {
    const be = installBackend({ p1: [], f1: [] }, { failRead: ["f1"] });
    render(historyConfig(), [row("p1"), row("f1")]);
    await expect(historyAdapter().create({ text: "글" })).rejects.toThrow("요청 실패");
    expect(be.writes()).toEqual([]);
  });

  it("확정된 목록이 없는 채 여러 소유 계약에 새 글을 쓰면 쓰기 전에 모든 계약을 먼저 읽는다", async () => {
    const be = installBackend({ p1: [{ id: "c-p1", text: "정책" }], f1: [{ id: "c-f1", text: "무상" }] });
    render(historyConfig(), [row("p1"), row("f1")]);
    const out = await historyAdapter().create({ text: "글" });
    expect(be.trace()).toEqual([
      "GET /api/hist/p1", "GET /api/hist/f1", // 쓰기 전 먼저 읽기
      "POST /api/hist/p1", "GET /api/hist/p1", "GET /api/hist/f1",
    ]);
    expect(out).toEqual([{ id: "c-p1", text: "정책" }, { id: "new-1", text: "글" }, { id: "c-f1", text: "무상" }]);
  });

  it("소유 계약이 하나면 쓰기 뒤 조회가 실패해도 저장 성공 목록을 반환하고, 이어 수정도 된다", async () => {
    const opts = { failRead: [] as string[] };
    const be = installBackend({ f1: [{ id: "c-f1", text: "무상" }] }, opts);
    render(historyConfig(), [row("f1")]);
    const a = historyAdapter();
    opts.failRead.push("f1");

    // 읽은 적이 없어도 소유 계약이 하나뿐이면 쓰기 전 읽기가 없다 — 쓰기 응답이 곧 확정 목록이다.
    await expect(a.create({ text: "글" })).resolves.toEqual([{ id: "c-f1", text: "무상" }, { id: "new-1", text: "글" }]);
    expect(be.trace()).toEqual(["POST /api/hist/f1", "GET /api/hist/f1"]);
    await expect(a.edit({ commentId: "new-1", text: "고침" })).resolves.toContainEqual({ id: "new-1", text: "고침" });
    expect(be.writes().map((w) => w.method)).toEqual(["POST", "PATCH"]);
  });

  it("쓰기 응답 뒤에 늦게 도착한 오래된 조회(폴링) 결과는 확정된 목록을 되돌리지 못한다", async () => {
    const be = installBackend({ p1: [{ id: "c-p1", text: "정책" }], f1: [{ id: "c-f1", text: "무상" }] });
    render(historyConfig(), [row("p1"), row("f1")]);
    const a = historyAdapter();
    await a.fetch();

    // 다음 p1 읽기 하나만 응답을 붙잡아 둔다(응답 내용은 읽은 그 시점 것 = 쓰기 전 목록).
    const real = be.fake;
    let hold = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const held = hold && url === `${HIST}p1` && !init?.method;
      if (held) hold = false;
      const res = real(url, init);
      return held ? res.then(async (r) => { await gate; return r; }) : res;
    });

    const poll = a.fetch(); // 오래된 조회: p1 응답이 아직 안 왔다
    const created = await a.create({ text: "글" });
    const settled = [{ id: "c-p1", text: "정책" }, { id: "new-1", text: "글" }, { id: "c-f1", text: "무상" }];
    expect(created).toEqual(settled);

    release();
    expect(await poll).toEqual({ comments: settled }); // 오래된 p1 목록(새 글 없음)이 덮지 못했다
    // 새 글의 소유 계약도 그대로 기억한다.
    await expect(a.edit({ commentId: "new-1", text: "고침" })).resolves.toContainEqual({ id: "new-1", text: "고침" });
  });

  it("보기 전용(commentsReadOnly)이면 합쳐 읽기만 되고 작성·수정·삭제는 기존처럼 막힌다", async () => {
    const be = installBackend({ p1: [{ id: "c-p1", text: "정책" }], f1: [{ id: "c-f1", text: "무상" }] });
    render(historyConfig({ commentsReadOnly: true }), [row("p1"), row("f1")]);
    expect(h.historyProps?.readOnly).toBe(true);
    const a = historyAdapter();

    expect((await a.fetch()).comments).toHaveLength(2);
    await expect(a.create({ text: "x" })).rejects.toThrow("작성할 수 없습니다");
    await expect(a.edit({ commentId: "c-p1", text: "x" })).rejects.toThrow("작성할 수 없습니다");
    await expect(a.remove({ commentId: "c-f1" })).rejects.toThrow("작성할 수 없습니다");
    expect(be.writes()).toEqual([]);
  });
});

describe("filterHistoryRows 가 없으면 기존 동작 그대로", () => {
  it("고른 정책 계약 하나의 댓글 통로만 쓰고, 합치기·다시 읽기·다른 계약 접근이 없다", async () => {
    const be = installBackend({
      p1: [{ id: "c-p1", text: "정책1" }],
      p2: [{ id: "c-p2", text: "정책2" }],
      f1: [{ id: "c-f1", text: "무상" }],
    });
    render(baseConfig(), [row("f1"), row("p1"), row("p2")]);

    // 대표 = 정책 계약 첫 건(무상 행은 히스토리에 끼지 않는다)
    expect(h.historyProps?.pageId).toBe("p1");
    expect(h.historyProps?.draftId).toBe("p1");
    const a = historyAdapter();

    expect(await a.fetch()).toEqual({ comments: [{ id: "c-p1", text: "정책1" }] });
    expect(be.fake).toHaveBeenLastCalledWith("/api/hist/p1", { cache: "no-store" });

    be.calls.length = 0;
    const json = { method: "", headers: { "Content-Type": "application/json" }, body: "" };
    // 쓰기 응답이 곧 화면 목록이다(다시 읽는 GET 이 따라붙지 않는다).
    expect(await a.create({ text: "n", category: "c" })).toEqual([{ id: "c-p1", text: "정책1" }, { id: "new-1", text: "n" }]);
    expect(be.fake).toHaveBeenLastCalledWith("/api/hist/p1", { ...json, method: "POST", body: JSON.stringify({ text: "n", category: "c" }) });
    await a.edit({ commentId: "c-p1", text: "e" });
    expect(be.fake).toHaveBeenLastCalledWith("/api/hist/p1", { ...json, method: "PATCH", body: JSON.stringify({ commentId: "c-p1", text: "e" }) });
    await a.remove({ commentId: "c-p1" });
    expect(be.fake).toHaveBeenLastCalledWith("/api/hist/p1", { ...json, method: "DELETE", body: JSON.stringify({ commentId: "c-p1" }) });
    expect(be.trace()).toEqual(["POST /api/hist/p1", "PATCH /api/hist/p1", "DELETE /api/hist/p1"]);
  });

  it("보기 전용이면 훅이 없어도 기존처럼 막힌다", async () => {
    const be = installBackend({ p1: [{ id: "c-p1", text: "정책" }] });
    render(baseConfig({ commentsReadOnly: true }), [row("p1")]);
    const a = historyAdapter();
    await expect(a.create({ text: "x" })).rejects.toThrow("작성할 수 없습니다");
    await expect(a.edit({ commentId: "c-p1", text: "x" })).rejects.toThrow("작성할 수 없습니다");
    await expect(a.remove({ commentId: "c-p1" })).rejects.toThrow("작성할 수 없습니다");
    expect(be.calls).toEqual([]);
  });

  it("분야 행을 못 불러온 상태의 안내(loadFailed)는 훅 유무와 상관없이 그대로다", () => {
    h.rowsLoadFailed = true;
    installBackend({});
    expect(render(baseConfig(), []).html).toContain("계약 정보를 불러오지 못했어요");
    expect(render(historyConfig(), []).html).toContain("계약 정보를 불러오지 못했어요");
    // 소유 계약이 있으면 못 불러왔다는 표시와 상관없이 패널이 열린다(기존 게이트 규칙).
    render(historyConfig(), [row("f1")]);
    expect(h.historyProps?.pageId).toBe("f1");
  });
});
