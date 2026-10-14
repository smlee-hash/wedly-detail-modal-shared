import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGovSubsidyPanel, type GovSubsidyPanelConfig } from "./GovSubsidyPanel";

// 정부지원금 패널 히스토리 소유 항목 분리(filterHistoryRows) 시험.
// 이 패키지에는 화면 시험 도구(jsdom·testing-library)가 없다. 그래서 진짜 createGovSubsidyPanel 결과를
// react-dom/server 로 한 번 그리고, 패널이 HistoryPanel·SettlementInfoTab·MeetingsTab 에 넘긴 prop 을 붙잡아
// 그 안의 adapter(fetch/create/edit/remove)와 onSave 를 직접 부른다 — 손으로 흉내 낸 함수가 아니라 패널이 만든 것이다.
// (서버 렌더는 effect 를 돌리지 않는다. 이 시험이 보는 것은 렌더 중에 정해지는 값과 붙잡은 콜백뿐이다.)
// 컴포넌트 파일의 JSX 가 클래식 변환으로 컴파일돼도 돌도록 React 전역을 둔다(렌더 시점에만 쓰인다).
(globalThis as { React?: unknown }).React = React;

const captured = vi.hoisted(() => ({
  history: [] as Array<Record<string, unknown>>,
  settlement: [] as Array<Record<string, unknown>>,
  meetings: [] as Array<Record<string, unknown>>,
}));

vi.mock("@wedly/ui-shared", () => ({
  HistoryPanel: (props: Record<string, unknown>) => {
    captured.history.push(props);
    return null;
  },
  timeAgo: () => "",
  COMMON_BASIC_FIELD_SPECS: [],
  useDetailLoadState: () => ({ rowsLoadFailed: false }),
  checkApiResult: (res: { ok: boolean }) => (res.ok ? "none" : "http"),
  makePersistError: (_bad: string, reason: string) => new Error(reason),
  failureReason: (bad: string) => `요청 실패(${bad})`,
}));

vi.mock("./SettlementInfoTab", () => ({
  default: (props: Record<string, unknown>) => {
    captured.settlement.push(props);
    return null;
  },
}));

type Rows = Parameters<GovSubsidyPanelConfig["filterPolicyRows"]>[0];
type Cmt = { id: string; text: string; author: string };
type HistoryAdapterLike = {
  fetch(): Promise<{ comments: Cmt[] }>;
  create(a: { text: string; category?: string }): Promise<Cmt[]>;
  edit(a: { commentId: string; text: string }): Promise<Cmt[]>;
  remove(a: { commentId: string }): Promise<Cmt[]>;
};

function last<T>(a: T[]): T {
  return a[a.length - 1];
}

// ── 가짜 댓글 서버: /api/comments/<entryId> — 일루아 응답 형태({data:{illuaComments}}), 항목별 저장소 ──
function makeBackend(seed: Record<string, Cmt[]>) {
  const store = new Map<string, Cmt[]>(Object.entries(seed).map(([k, v]) => [k, v.map((c) => ({ ...c }))]));
  const calls: string[] = [];
  const failGet = new Set<string>();
  let seq = 0;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const list = (id: string) => json(200, { success: true, data: { illuaComments: store.get(id) ?? [] } });
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const m = /^\/api\/comments\/(.+)$/.exec(path);
    if (!m) throw new Error(`예상 밖 fetch: ${path}`);
    const id = m[1];
    calls.push(`${method} ${path}`);
    const body = init?.body ? (JSON.parse(String(init.body)) as { text?: string; commentId?: string }) : {};
    const arr = store.get(id) ?? [];
    store.set(id, arr);
    if (method === "GET") return failGet.has(id) ? json(500, { success: false }) : list(id);
    if (method === "POST") {
      arr.push({ id: `new-${++seq}`, text: body.text ?? "", author: "테스터" });
      return list(id);
    }
    const at = arr.findIndex((c) => c.id === body.commentId);
    if (at < 0) return json(404, { success: false });
    if (method === "PATCH") arr[at] = { ...arr[at], text: body.text ?? "" };
    if (method === "DELETE") arr.splice(at, 1);
    return list(id);
  });
  return { store, calls, failGet, fetchFn, writes: () => calls.filter((c) => !c.startsWith("GET ")), gets: () => calls.filter((c) => c.startsWith("GET ")) };
}

// ── 패널 그리기 ──
const commentsPath = (id: string) => `/api/comments/${id}`;
const savePolicyField = vi.fn<(id: string, key: string, value: string | number | boolean | null) => Promise<void>>(async () => {});
const createContract = vi.fn<(primary: Record<string, unknown>) => Promise<string>>(async () => "pol-new");
const MeetingsStub = (props: Record<string, unknown>) => {
  captured.meetings.push(props);
  return null;
};

const rowsOf = (...ids: string[]) => ids.map((entryId) => ({ entryId, domain: "government-subsidy", row: {} })) as unknown as Rows;
const policyOnly = (rs: Rows) => rs.filter((r) => r.entryId.startsWith("pol-")) as Rows;
const freeOnly = (rs: Rows) => rs.filter((r) => r.entryId.startsWith("free-")) as Rows;
// 앱이 쓸 법한 규칙: 계약(정책) 행이 있으면 그 기록, 없을 때만 무료 행 기록.
const policyElseFree = (rs: Rows) => (policyOnly(rs).length ? policyOnly(rs) : freeOnly(rs));
// 계약 행과 무료 행 둘 다 — 무료가 앞이라 히스토리 대표가 정책 행과 달라진다.
const freeThenPolicy = (rs: Rows) => [...freeOnly(rs), ...policyOnly(rs)] as Rows;

function makeConfig(over: Partial<GovSubsidyPanelConfig> = {}): GovSubsidyPanelConfig {
  return {
    editable: true,
    allowStructureEdit: false,
    allowNonAdminEdit: true,
    ownSource: "illua",
    commentsPath,
    contractFieldsPath: "/api/contract-fields",
    refundFieldsPath: "/api/refund-fields",
    settlementFieldsPath: "/api/settlement-fields",
    configPath: "/api/config",
    savePolicyField,
    createContract,
    filterPolicyRows: policyOnly,
    ...over,
  };
}

const PRIMARY_ROW = { _id: "co-1", "15사업자번호": "123-45-67890" };

function render(config: GovSubsidyPanelConfig, rs: Rows, extra: Record<string, unknown> = {}) {
  captured.history.length = 0;
  captured.settlement.length = 0;
  captured.meetings.length = 0;
  const Panel = createGovSubsidyPanel(config) as unknown as React.ComponentType<Record<string, unknown>>;
  const onSaved = vi.fn();
  const html = renderToStaticMarkup(
    React.createElement(Panel, {
      rows: rs,
      primaryRow: PRIMARY_ROW,
      isAdmin: true,
      onSaved,
      adapter: { api: { currentUser: async () => ({ name: "테스터" }) }, components: { MeetingsTab: MeetingsStub } },
      ...extra,
    }),
  );
  return { html, onSaved };
}

const historyProps = () => last(captured.history);
const historyAdapter = () => historyProps().adapter as HistoryAdapterLike;
const FEE_JSON = '{"차수":[{"id":"t1"}]}';
// 계약정보 탭의 수수료 저장 — 패널이 SettlementInfoTab 에 넘긴 onSave 를 그대로 부른다.
async function saveFee(config: GovSubsidyPanelConfig, rs: Rows) {
  const r = render(config, rs, { subTab: "contract", onSubTabChange: () => {}, hideSubTabBar: true });
  const tab = captured.settlement.find((p) => p.storagePrefix === "contract");
  expect(tab, "계약정보 탭이 그려져야 한다").toBeTruthy();
  await (tab!.onSave as (json: string) => Promise<void>)(FEE_JSON);
  return r;
}

let backend: ReturnType<typeof makeBackend>;
beforeEach(() => {
  vi.clearAllMocks();
  backend = makeBackend({});
  vi.stubGlobal("fetch", backend.fetchFn);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filterHistoryRows — 무료 행에만 기록이 있는 회사", () => {
  it("계약 행이 없어도 히스토리 패널이 열리고, 식별·pageId·draftId 는 히스토리 대표(무료 행)다", async () => {
    backend = makeBackend({ "free-1": [{ id: "f1", text: "무료 메모", author: "가" }] });
    vi.stubGlobal("fetch", backend.fetchFn);
    const { html } = render(makeConfig({ filterHistoryRows: policyElseFree }), rowsOf("free-1"));

    expect(captured.history).toHaveLength(1);
    expect(historyProps().pageId).toBe("free-1");
    expect(historyProps().draftId).toBe("free-1");
    expect(html).not.toContain("히스토리 메모를 입력하세요"); // 첫 메모 입력칸(composer)이 아니다

    const res = await historyAdapter().fetch();
    expect(res.comments.map((c) => c.id)).toEqual(["f1"]);
    expect(backend.calls).toEqual(["GET /api/comments/free-1"]);
    expect(createContract).not.toHaveBeenCalled();
  });

  it("새 글은 히스토리 대표(무료 행)에 쓰고 계약 줄을 새로 만들지 않는다", async () => {
    backend = makeBackend({ "free-1": [] });
    vi.stubGlobal("fetch", backend.fetchFn);
    render(makeConfig({ filterHistoryRows: policyElseFree }), rowsOf("free-1"));

    const after = await historyAdapter().create({ text: "첫 글" });
    expect(backend.writes()).toEqual(["POST /api/comments/free-1"]);
    expect(after.map((c) => c.text)).toEqual(["첫 글"]);
    expect(createContract).not.toHaveBeenCalled();
  });
});

describe("filterHistoryRows — 수수료·미팅 저장은 계약(정책) 행만", () => {
  it("무료 행만 있을 때 첫 수수료 저장은 새 계약을 만들고 무료 행에는 쓰지 않는다", async () => {
    const { onSaved } = await saveFee(makeConfig({ filterHistoryRows: policyElseFree }), rowsOf("free-1"));

    expect(createContract).toHaveBeenCalledTimes(1);
    expect(createContract).toHaveBeenCalledWith(expect.objectContaining({ _id: "co-1" }));
    expect(savePolicyField).toHaveBeenCalledTimes(1);
    expect(savePolicyField).toHaveBeenCalledWith("pol-new", "계약정보_차수", FEE_JSON);
    expect(savePolicyField.mock.calls.some((c) => c[0] === "free-1")).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(backend.fetchFn).not.toHaveBeenCalled();
  });

  it("히스토리 대표가 무료 행이어도 수수료는 고른 계약 행에, 새 계약은 만들지 않는다", async () => {
    const config = makeConfig({ filterHistoryRows: freeThenPolicy });
    render(config, rowsOf("free-1", "pol-1")); // 히스토리 탭
    expect(historyProps().pageId).toBe("free-1"); // 히스토리 식별은 대표 행

    await saveFee(config, rowsOf("free-1", "pol-1")); // 계약정보 탭
    expect(savePolicyField).toHaveBeenCalledWith("pol-1", "계약정보_차수", FEE_JSON); // 쓰기는 정책 행
    expect(savePolicyField.mock.calls.some((c) => c[0] === "free-1")).toBe(false);
    expect(createContract).not.toHaveBeenCalled();
  });

  it("미팅 저장도 정책 행에만 간다(히스토리 대표와 무관)", async () => {
    render(makeConfig({ filterHistoryRows: freeThenPolicy }), rowsOf("free-1", "pol-1"), {
      subTab: "meetings",
      onSubTabChange: () => {},
      hideSubTabBar: true,
    });
    const meetings = last(captured.meetings);
    await (meetings.onSave as (json: string) => Promise<void>)('{"m":1}');

    expect(savePolicyField).toHaveBeenCalledTimes(1);
    expect(savePolicyField).toHaveBeenCalledWith("pol-1", "_meetings", '{"m":1}');
    expect(createContract).not.toHaveBeenCalled();
  });
});

describe("filterHistoryRows — 계약 행이 있으면 예전 히스토리 그대로", () => {
  it("계약+무료가 같이 있으면 계약 행 기록만 — 훅을 안 넣었을 때와 같은 요청·같은 식별", async () => {
    const seed = {
      "pol-1": [{ id: "p1", text: "계약 메모", author: "가" }],
      "free-1": [{ id: "f1", text: "무료 메모", author: "나" }],
    };
    const rs = rowsOf("pol-1", "free-1");

    const runs: Array<{ pageId: unknown; draftId: unknown; calls: string[]; ids: string[] }> = [];
    for (const over of [{}, { filterHistoryRows: policyElseFree }]) {
      backend = makeBackend(seed);
      vi.stubGlobal("fetch", backend.fetchFn);
      render(makeConfig(over), rs);
      const res = await historyAdapter().fetch();
      runs.push({ pageId: historyProps().pageId, draftId: historyProps().draftId, calls: backend.calls.slice(), ids: res.comments.map((c) => c.id) });
    }

    expect(runs[1]).toEqual(runs[0]);
    expect(runs[0]).toEqual({ pageId: "pol-1", draftId: "pol-1", calls: ["GET /api/comments/pol-1"], ids: ["p1"] });
  });
});

describe("filterHistoryRows — 여러 소유 항목의 댓글을 합치고 수정·삭제는 원래 주인에게", () => {
  const seed = () => ({
    "pol-1": [{ id: "p1", text: "계약 메모", author: "가" }],
    "free-1": [{ id: "f1", text: "무료 메모", author: "나" }],
  });
  const both = (rs: Rows) => [...policyOnly(rs), ...freeOnly(rs)] as Rows;

  beforeEach(() => {
    backend = makeBackend(seed());
    vi.stubGlobal("fetch", backend.fetchFn);
  });

  it("가져오기: 소유 항목마다 받아 항목 순서대로 합친다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    expect(historyProps().pageId).toBe("pol-1");
    const res = await historyAdapter().fetch();
    expect(res.comments.map((c) => c.id)).toEqual(["p1", "f1"]);
    expect(backend.gets().sort()).toEqual(["GET /api/comments/free-1", "GET /api/comments/pol-1"]);
  });

  it("수정: 무료 행의 글은 무료 행으로만 PATCH 하고, 쓰고 나면 모든 소유 항목을 다시 받아 합쳐 돌려준다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();
    backend.calls.length = 0;

    const after = await a.edit({ commentId: "f1", text: "고친 글" });

    expect(backend.writes()).toEqual(["PATCH /api/comments/free-1"]);
    expect(backend.store.get("free-1")![0].text).toBe("고친 글");
    expect(backend.store.get("pol-1")![0].text).toBe("계약 메모");
    expect(backend.gets().sort()).toEqual(["GET /api/comments/free-1", "GET /api/comments/pol-1"]);
    expect(after.map((c) => [c.id, c.text])).toEqual([["p1", "계약 메모"], ["f1", "고친 글"]]);
  });

  it("삭제: 계약 행의 글은 계약 행으로만 DELETE 하고, 다른 소유 항목 글은 목록에 남는다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();
    backend.calls.length = 0;

    const after = await a.remove({ commentId: "p1" });

    expect(backend.writes()).toEqual(["DELETE /api/comments/pol-1"]);
    expect(backend.store.get("pol-1")).toEqual([]);
    expect(after.map((c) => c.id)).toEqual(["f1"]);
  });

  it("새 글: 다른 소유 항목 목록이 없으면 쓰기 전에 모두 받고, 히스토리 대표(첫 항목)에만 POST 한 뒤 다시 받는다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const after = await historyAdapter().create({ text: "새 글" });

    // 먼저 받아 두는 것은 쓰고 나서 다시 받기가 실패해도 돌려줄 완전한 목록을 갖추기 위해서다.
    expect(backend.calls).toEqual([
      "GET /api/comments/pol-1",
      "GET /api/comments/free-1",
      "POST /api/comments/pol-1",
      "GET /api/comments/pol-1",
      "GET /api/comments/free-1",
    ]);
    expect(after.map((c) => c.text)).toEqual(["계약 메모", "새 글", "무료 메모"]);
  });

  it("새 글: 이미 모든 항목 목록을 받아 뒀다면 쓰기 전에 다시 받지 않는다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();
    backend.calls.length = 0;

    await a.create({ text: "새 글" });

    expect(backend.calls[0]).toBe("POST /api/comments/pol-1");
    expect(backend.writes()).toEqual(["POST /api/comments/pol-1"]);
  });

  it("주인 불명: 목록을 받은 적 없거나 목록에 없는 글은 수정·삭제가 아무것도 쓰지 않고 실패한다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();

    await expect(a.edit({ commentId: "f1", text: "x" })).rejects.toThrow(/확인할 수 없어/); // 아직 fetch 전
    await a.fetch();
    await expect(a.edit({ commentId: "ghost", text: "x" })).rejects.toThrow(/확인할 수 없어/);
    await expect(a.remove({ commentId: "ghost" })).rejects.toThrow(/확인할 수 없어/);
    await expect(a.remove({ commentId: "" })).rejects.toThrow(/확인할 수 없어/);

    expect(backend.writes()).toEqual([]);
  });

  it("주인 중복: 같은 id 가 두 소유 항목에 있으면 수정·삭제가 아무것도 쓰지 않고 실패한다", async () => {
    backend = makeBackend({
      "pol-1": [{ id: "dup", text: "계약쪽", author: "가" }],
      "free-1": [{ id: "dup", text: "무료쪽", author: "나" }],
    });
    vi.stubGlobal("fetch", backend.fetchFn);
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();

    await expect(a.edit({ commentId: "dup", text: "x" })).rejects.toThrow(/확정할 수 없어/);
    await expect(a.remove({ commentId: "dup" })).rejects.toThrow(/확정할 수 없어/);

    expect(backend.writes()).toEqual([]);
    expect(backend.store.get("pol-1")![0].text).toBe("계약쪽");
    expect(backend.store.get("free-1")![0].text).toBe("무료쪽");
  });

  it("가져오기 실패: 소유 항목 하나라도 실패하면 일부만 보여 주지 않고 통째로 실패한다", async () => {
    backend.failGet.add("free-1");
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    await expect(historyAdapter().fetch()).rejects.toThrow(/요청 실패/);
  });

  it("쓰기 성공 뒤 조회 실패는 저장 성공 목록을 반환해 재전송을 막는다", async () => {
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();
    backend.failGet.add("free-1");

    await expect(a.create({ text: "새 글" })).resolves.toEqual([
      { id: "p1", text: "계약 메모", author: "가" },
      { id: "new-1", text: "새 글", author: "테스터" },
      { id: "f1", text: "무료 메모", author: "나" },
    ]);
    expect(backend.writes()).toEqual(["POST /api/comments/pol-1"]);
    await expect(a.edit({ commentId: "new-1", text: "고침" })).resolves.toContainEqual({ id: "new-1", text: "고침", author: "테스터" });
    await expect(a.remove({ commentId: "f1" })).resolves.not.toContainEqual({ id: "f1", text: "무료 메모", author: "나" });
  });

  it("다른 소유자 목록을 한 번도 못 읽으면 저장 전에 멈춘다", async () => {
    backend.failGet.add("free-1");
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    await expect(historyAdapter().create({ text: "글" })).rejects.toThrow(/요청 실패/);
    expect(backend.writes()).toEqual([]);
  });

  it("겹친 가져오기: 쓰기 확정보다 먼저 시작한 낡은 가져오기가 늦게 끝나도 확정된 글을 되돌리지 않는다", async () => {
    let hold = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await backend.fetchFn(input, init); // 응답 내용은 이 시점의 서버 상태로 이미 정해진다
      if (hold && String(input) === commentsPath("pol-1") && (init?.method ?? "GET") === "GET") {
        hold = false;
        await gate; // 이 한 번의 가져오기만 쓰기가 끝난 뒤에야 돌아오게 붙잡는다
      }
      return res;
    });
    render(makeConfig({ filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();

    hold = true;
    const stale = a.fetch(); // 고치기 전 내용을 받아 두고 늦게 돌아온다
    await a.edit({ commentId: "p1", text: "고친 글" });
    release();
    const late = await stale;

    expect(late.comments.map((c) => [c.id, c.text])).toEqual([["p1", "고친 글"], ["f1", "무료 메모"]]);
    // 낡은 결과가 소유 대응도 건드리지 않았다 — 이어서 고쳐도 원래 주인(계약 행)으로 간다.
    backend.calls.length = 0;
    await a.edit({ commentId: "p1", text: "또 고친 글" });
    expect(backend.writes()).toEqual(["PATCH /api/comments/pol-1"]);
    expect(backend.store.get("pol-1")![0].text).toBe("또 고친 글");
  });

  it("보기 전용 앱이면 훅이 있어도 작성·수정·삭제는 막힌다", async () => {
    render(makeConfig({ commentsReadOnly: true, filterHistoryRows: both }), rowsOf("pol-1", "free-1"));
    const a = historyAdapter();
    await a.fetch();
    backend.calls.length = 0;

    await expect(a.create({ text: "x" })).rejects.toThrow(/작성할 수 없습니다/);
    await expect(a.edit({ commentId: "f1", text: "x" })).rejects.toThrow(/작성할 수 없습니다/);
    await expect(a.remove({ commentId: "f1" })).rejects.toThrow(/작성할 수 없습니다/);
    expect(backend.calls).toEqual([]);
  });
});

describe("filterHistoryRows — 소유 항목이 하나뿐일 때", () => {
  it("쓰기 성공 뒤 다시 받기가 실패해도 쓰기 응답 목록으로 성공하고, 새 글 수정·지운 글 대응이 맞다", async () => {
    backend = makeBackend({ "free-1": [{ id: "f1", text: "무료 메모", author: "나" }] });
    vi.stubGlobal("fetch", backend.fetchFn);
    backend.failGet.add("free-1");
    render(makeConfig({ filterHistoryRows: policyElseFree }), rowsOf("free-1"));
    const a = historyAdapter();

    // 다른 소유 항목이 없으니 쓰기 전 조회가 없다 — 쓰기 응답이 곧 완전한 목록이다.
    await expect(a.create({ text: "새 글" })).resolves.toEqual([
      { id: "f1", text: "무료 메모", author: "나" },
      { id: "new-1", text: "새 글", author: "테스터" },
    ]);
    expect(backend.calls).toEqual(["POST /api/comments/free-1", "GET /api/comments/free-1"]);

    await expect(a.edit({ commentId: "new-1", text: "고침" })).resolves.toContainEqual({ id: "new-1", text: "고침", author: "테스터" });
    const afterRemove = await a.remove({ commentId: "f1" });
    expect(afterRemove.map((c) => c.id)).toEqual(["new-1"]);

    // 지운 글은 더 이상 주인이 없다 — 다시 지우려 하면 아무것도 쓰지 않고 막힌다.
    const written = backend.writes().length;
    await expect(a.remove({ commentId: "f1" })).rejects.toThrow(/확인할 수 없어/);
    expect(backend.writes()).toHaveLength(written);
  });
});

describe("filterHistoryRows 미주입 — 예전 동작 그대로", () => {
  it("고른 계약 하나의 히스토리: 수정은 목록을 받지 않고도 그 계약으로 바로 가고, 응답 그대로 돌려준다", async () => {
    backend = makeBackend({
      "pol-1": [{ id: "p1", text: "계약 메모", author: "가" }],
      "free-1": [{ id: "f1", text: "무료 메모", author: "나" }],
    });
    vi.stubGlobal("fetch", backend.fetchFn);
    render(makeConfig(), rowsOf("pol-1", "free-1"));

    expect(historyProps().pageId).toBe("pol-1");
    const after = await historyAdapter().edit({ commentId: "p1", text: "고침" });

    expect(backend.calls).toEqual(["PATCH /api/comments/pol-1"]); // 다시 받기·소유자 조회 없음
    expect(after.map((c) => [c.id, c.text])).toEqual([["p1", "고침"]]);
  });

  it("무료 행만 있으면 예전처럼 히스토리 패널 없이 첫 메모 입력칸", () => {
    const { html } = render(makeConfig(), rowsOf("free-1"));
    expect(captured.history).toHaveLength(0);
    expect(html).toContain("히스토리 메모를 입력하세요");
  });

  it("수수료 저장은 예전과 같다: 계약 행이 없으면 새로 만들고, 있으면 그 행에 쓴다", async () => {
    await saveFee(makeConfig(), rowsOf("free-1"));
    expect(createContract).toHaveBeenCalledTimes(1);
    expect(savePolicyField).toHaveBeenCalledWith("pol-new", "계약정보_차수", FEE_JSON);

    vi.clearAllMocks();
    await saveFee(makeConfig(), rowsOf("pol-1", "free-1"));
    expect(createContract).not.toHaveBeenCalled();
    expect(savePolicyField).toHaveBeenCalledWith("pol-1", "계약정보_차수", FEE_JSON);
  });

  it("「계약 N의 기록」 안내(historyOnly·계약 여러 건)는 예전에만 나온다 — 훅을 넣으면 합쳐 보이므로 감춘다", () => {
    const rs = rowsOf("pol-1", "pol-2");
    expect(render(makeConfig(), rs, { historyOnly: true }).html).toContain("위 알약으로");
    const merged = render(makeConfig({ filterHistoryRows: policyOnly }), rs, { historyOnly: true }).html;
    expect(merged).not.toContain("위 알약으로");
    expect(merged).not.toContain("계약 2");
    expect(render(makeConfig(), rs, { historyOnly: true }).html).toContain("계약 2");
    expect(render(makeConfig({ filterHistoryRows: policyOnly }), rs, { subTab: "contract" }).html).toContain("계약 2");
  });
});
