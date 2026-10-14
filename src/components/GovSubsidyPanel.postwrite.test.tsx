import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

// 히스토리 소유 계약 분리(filterHistoryRows) 시험.
//
// 댓글 통로의 비동기 순서를 직접 검증하려고 서버 렌더(renderToStaticMarkup)를 쓴다.
// 그래서 ① 공용 부품(@wedly/ui-shared)·SettlementInfoTab 은 「받은 prop 을 잡아 두는 가짜」로 바꾸고,
// ② 서버 렌더는 단추를 누를 수 없으니 하위 탭의 시작값만 시험이 정한다(react 의 useState 를 감싸 "history" 시작값만 바꿈).
// 시험은 진짜 GovSubsidyPanel 을 그려서, 진짜 코드가 HistoryPanel 에 넘긴 어댑터(fetch/create/edit/remove)와
// SettlementInfoTab/MeetingsTab 에 넘긴 onSave(= 수수료·미팅 저장)를 그대로 불러 본다.

type TestComment = { id: string; text: string; createdAt?: string };
type HistoryAdapterLike = {
  fetch: () => Promise<{ comments: TestComment[] }>;
  create: (a: { text: string; category?: string }) => Promise<TestComment[]>;
  edit: (a: { commentId: string; text: string }) => Promise<TestComment[]>;
  remove: (a: { commentId: string }) => Promise<TestComment[]>;
};
type HistoryPanelProps = { pageId: string; draftId: string; readOnly: boolean; adapter: HistoryAdapterLike;
  buildKakaoReport?: (comment: TestComment) => Promise<string> };
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
  checkApiResult: (res: { ok: boolean; status: number }) => (res.ok ? "none" : [401, 403, 405].includes(res.status) ? "auth" : "server"),
  makePersistError: (bad: string, reason: string) => Object.assign(new Error(reason), { persistKind: bad }),
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
    ownSource: "erp",
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

describe("ERP 수식 공용본의 댓글 쓰기 후 조회 실패", () => {
  it("기존 시간순·중복 표시 제거와 실제 소유 계약으로 보고서를 만드는 동작을 유지한다", async () => {
    const older = { id: "old", text: "먼저", createdAt: "2026-10-13T00:00:00Z" };
    const newer = { id: "new", text: "나중", createdAt: "2026-10-14T00:00:00Z" };
    const duplicate = { id: "dup", text: "공통", createdAt: "2026-10-15T00:00:00Z" };
    installBackend({ p1: [newer, duplicate], f1: [older, duplicate] });
    const buildKakaoReport = vi.fn(async () => "보고서");
    render(historyConfig({ buildKakaoReport }), [row("p1"), row("f1")]);
    expect(await historyAdapter().fetch()).toEqual({ comments: [older, newer, duplicate] });
    await expect(h.historyProps!.buildKakaoReport!(older)).resolves.toBe("보고서");
    expect(buildKakaoReport).toHaveBeenCalledWith("f1", "old");
    await expect(h.historyProps!.buildKakaoReport!(duplicate)).rejects.toThrow("여러 계약");
    await expect(h.historyProps!.buildKakaoReport!({ id: "missing", text: "없음" })).rejects.toThrow("확인하지 못했습니다");
    expect(buildKakaoReport).toHaveBeenCalledTimes(1);
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

});


describe("ERP 실제 댓글 응답과 재진입 경계", () => {
  it("쓰기 응답에 없는 이전 읽기 전용 기록을 보존하고 직접 삭제한 댓글만 제거한다", async () => {
    const base = { id: "base", text: "원글" };
    const readOnly = [{ id: "legacy-illua", text: "옛 일루아 글" }, { id: "pt-tracker", text: "진행 정책 기록" }];
    let reads = 0;
    let comments = [base];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        reads++;
        return { ok: reads === 1, status: reads === 1 ? 200 : 500,
          json: async () => ({ success: reads === 1, data: [...comments, ...readOnly] }) };
      }
      if (method === "POST") comments = [...comments, { id: "new", text: "새 글" }];
      if (method === "PATCH") comments = comments.map(c => c.id === "base" ? { ...c, text: "수정됨" } : c);
      if (method === "DELETE") comments = comments.filter(c => c.id !== "base");
      return { ok: true, status: 200, json: async () => ({ success: true, data: comments }) };
    }));
    render(historyConfig(), [row("p1")]);
    const adapter = historyAdapter();
    await adapter.fetch();
    expect((await adapter.create({ text: "새 글" })).map(c => c.id).sort()).toEqual(["base", "legacy-illua", "new", "pt-tracker"]);
    const edited = await adapter.edit({ commentId: "base", text: "수정됨" });
    expect(edited.find(c => c.id === "base")?.text).toBe("수정됨");
    expect((await adapter.remove({ commentId: "base" })).map(c => c.id).sort()).toEqual(["legacy-illua", "new", "pt-tracker"]);
  });

  it("한 어댑터의 겹친 쓰기는 앞 응답을 받은 뒤 다음 쓰기를 보내 순서를 지킨다", async () => {
    let writes = 0;
    let release!: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return { ok: false, status: 500, json: async () => ({ success: false }) };
      const seq = ++writes;
      if (seq === 1) await first;
      return { ok: true, status: 200, json: async () => ({ success: true, data: Array.from({ length: seq }, (_, i) => ({ id: String(i + 1), text: "글" })) }) };
    }));
    render(historyConfig(), [row("p1")]);
    const adapter = historyAdapter();
    const a = adapter.create({ text: "첫 글" });
    const b = adapter.create({ text: "다음 글" });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const beforeAck = writes;
    release();
    await a;
    const final = await b;
    expect(beforeAck).toBe(1);
    expect(final.map(c => c.id)).toEqual(["1", "2"]);
  });

  it("다른 소유 계약 첫 조회가 인증 실패하면 종류를 보존하고 쓰지 않는다", async () => {
    const fake = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ success: false }) }));
    vi.stubGlobal("fetch", fake);
    render(historyConfig(), [row("p1"), row("p2")]);
    await expect(historyAdapter().create({ text: "미저장" })).rejects.toMatchObject({ persistKind: "auth" });
    expect(fake.mock.calls).toHaveLength(2);
  });
});
