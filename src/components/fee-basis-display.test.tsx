// @vitest-environment jsdom
// 차수카드의 「비운 이유」·「적용 기준」 글 — 정산 기준표(정확히 하나 방식)가 차수에 저장한 `_fsr_<칸>`·`_fsb_<칸>` 를 그대로 보여 준다.
// 순수 함수(feeBasisNoteOf), 작은 표시 부품(FeeBasisNote), 그리고 SettlementInfoTab 의 실제 연결까지 시험한다.
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeePublicTargetV1, FieldDef, TierData } from "@wedly/ui-shared";
import SettlementInfoTab from "./SettlementInfoTab";
import {
  FEE_BASIS_LABEL,
  FEE_BASIS_KEY_PREFIX,
  FEE_OVERRIDE_KEY_PREFIX,
  FEE_REASON_KEY_PREFIX,
  FeeBasisNote,
  feeBasisNoteOf,
} from "./fee-basis-display";

const tier = (extra: Record<string, unknown>): TierData => ({ id: "t1", label: "1차", ...extra }) as TierData;

describe("feeBasisNoteOf — 저장된 기록에서 보여 줄 글을 고른다", () => {
  it("저장 키 접두사는 공용 엔진 계약과 같다(_fsr_ · _fsb_ · _ovr_)", () => {
    expect(FEE_REASON_KEY_PREFIX).toBe("_fsr_");
    expect(FEE_BASIS_KEY_PREFIX).toBe("_fsb_");
    expect(FEE_OVERRIDE_KEY_PREFIX).toBe("_ovr_");
    expect(FEE_BASIS_LABEL).toBe("적용 기준");
  });

  it("값이 있고 적용 기준(_fsb_)이 있으면 기준 글만 낸다", () => {
    expect(feeBasisNoteOf(tier({ fee: 880000, _fsb_fee: "정부지원금 13번 행" }), "fee")).toEqual({ basis: "정부지원금 13번 행" });
  });

  it("값이 비어 있고 사유(_fsr_)가 있으면 사유 글만 낸다 — 적용 기준이 남아 있어도 숨긴다", () => {
    expect(feeBasisNoteOf(tier({ _fsr_fee: "조건 중복 - 확인 필요" }), "fee")).toEqual({ reason: "조건 중복 - 확인 필요" });
    expect(feeBasisNoteOf(tier({ _fsr_fee: "정산 기준 확인 필요", _fsb_fee: "정부지원금 13번 행" }), "fee")).toEqual({ reason: "정산 기준 확인 필요" });
  });

  it.each([undefined, null, "", "   ", Number.NaN])("보이는 값 %j 은(는) 빈 값이다", shown => {
    expect(feeBasisNoteOf(tier({ _fsr_fee: "날짜 확인 필요" }), "fee", { shown })).toEqual({ reason: "날짜 확인 필요" });
  });

  it.each([0, "0", 1, "880000"])("보이는 값 %j 은(는) 값이 있는 것이다 — 0 도 계산된 값이라 사유를 숨기고 기준을 보인다", shown => {
    expect(feeBasisNoteOf(tier({ _fsr_fee: "날짜 확인 필요", _fsb_fee: "정부지원금 2번 행" }), "fee", { shown })).toEqual({ basis: "정부지원금 2번 행" });
  });

  it("보이는 값을 안 넘기면 차수에 저장된 칸 값을 본다", () => {
    expect(feeBasisNoteOf(tier({ fee: 0, _fsb_fee: "정부지원금 2번 행" }), "fee")).toEqual({ basis: "정부지원금 2번 행" });
    expect(feeBasisNoteOf(tier({ fee: "", _fsr_fee: "주소 확인 필요" }), "fee")).toEqual({ reason: "주소 확인 필요" });
    expect(feeBasisNoteOf(tier({ fee: null, _fsr_fee: "주소 확인 필요" }), "fee")).toEqual({ reason: "주소 확인 필요" });
  });

  it("보이는 값을 넘기면 저장된 칸 값보다 그것을 따른다", () => {
    expect(feeBasisNoteOf(tier({ fee: 500, _fsr_fee: "날짜 확인 필요" }), "fee", { shown: null })).toEqual({ reason: "날짜 확인 필요" });
    expect(feeBasisNoteOf(tier({ _fsb_fee: "정부지원금 13번 행" }), "fee", { shown: 500 })).toEqual({ basis: "정부지원금 13번 행" });
  });

  it("사람이 고친 값(_ovr_)이 있으면 아무 글도 내지 않는다 — 사람 값이 항상 먼저", () => {
    for (const ovr of [500000, 0, "500000"]) {
      expect(feeBasisNoteOf(tier({ fee: 500000, _ovr_fee: ovr, _fsb_fee: "정부지원금 13번 행" }), "fee")).toEqual({});
      expect(feeBasisNoteOf(tier({ _ovr_fee: ovr, _fsr_fee: "조건 중복 - 확인 필요" }), "fee", { shown: null })).toEqual({});
    }
  });

  it("_ovr_ 가 비었거나 숫자가 아니면 사람이 고친 값으로 보지 않는다", () => {
    for (const ovr of ["", null, "abc", undefined, {}]) {
      expect(feeBasisNoteOf(tier({ fee: 880000, _ovr_fee: ovr, _fsb_fee: "정부지원금 13번 행" }), "fee")).toEqual({ basis: "정부지원금 13번 행" });
    }
  });

  it("호출자가 수정됨을 알려 주면(edited) 글을 내지 않는다", () => {
    expect(feeBasisNoteOf(tier({ fee: 1, _fsb_fee: "정부지원금 13번 행" }), "fee", { edited: true })).toEqual({});
  });

  it("확정된 정산이면 적용 기준을 숨긴다(사유는 그대로)", () => {
    expect(feeBasisNoteOf(tier({ fee: 1, _fsb_fee: "정부지원금 13번 행" }), "fee", { finalized: true })).toEqual({});
    expect(feeBasisNoteOf(tier({ _fsr_fee: "정산 기준 확인 필요" }), "fee", { finalized: true })).toEqual({ reason: "정산 기준 확인 필요" });
  });

  it("저장 기록이 없거나 글자가 아니거나 공백뿐이면 아무 글도 내지 않는다", () => {
    expect(feeBasisNoteOf(tier({ fee: 1 }), "fee")).toEqual({});
    expect(feeBasisNoteOf(tier({}), "fee")).toEqual({});
    expect(feeBasisNoteOf(tier({ _fsb_fee: 7, _fsr_fee: 7 }), "fee", { shown: 1 })).toEqual({});
    expect(feeBasisNoteOf(tier({ _fsb_fee: "  " }), "fee", { shown: 1 })).toEqual({});
    expect(feeBasisNoteOf(tier({ _fsr_fee: "  " }), "fee", { shown: null })).toEqual({});
    expect(feeBasisNoteOf(tier({ _fsr_fee: ["조건 중복"] }), "fee", { shown: null })).toEqual({});
  });

  it("다른 칸의 기록은 읽지 않고, 칸 키가 비었거나 위험해도 던지지 않는다", () => {
    const t = tier({ _fsr_other: "날짜 확인 필요", _fsb_other: "정부지원금 13번 행" });
    expect(feeBasisNoteOf(t, "fee")).toEqual({});
    expect(feeBasisNoteOf(t, "")).toEqual({});
    expect(feeBasisNoteOf(t, "__proto__")).toEqual({});
  });

  it("앞뒤 공백은 지우고 긴 글은 잘라서 낸다", () => {
    expect(feeBasisNoteOf(tier({ fee: 1, _fsb_fee: "  정부지원금 13번 행 " }), "fee")).toEqual({ basis: "정부지원금 13번 행" });
    const long = feeBasisNoteOf(tier({ _fsr_fee: "가".repeat(500) }), "fee", { shown: null }).reason!;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.startsWith("가가가")).toBe(true);
  });

  it("차수를 바꾸지 않는다", () => {
    const t = tier({ fee: 1, _fsb_fee: "정부지원금 13번 행", _fsr_fee: "x" });
    const before = JSON.stringify(t);
    feeBasisNoteOf(t, "fee");
    feeBasisNoteOf(t, "fee", { shown: null, finalized: true, edited: true });
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("FeeBasisNote — 작은 표시 부품", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const show = async (note: ComponentProps<typeof FeeBasisNote>["note"]) => { await act(async () => root.render(<FeeBasisNote note={note} />)); };

  it("사유가 있으면 그 글을 그대로 보인다", async () => {
    await show({ reason: "조건 중복 - 확인 필요" });
    expect(host.textContent).toBe("조건 중복 - 확인 필요");
  });

  it("적용 기준이 있으면 「적용 기준: …」 한 줄을 작게 보인다", async () => {
    await show({ basis: "정부지원금 13번 행" });
    expect(host.textContent).toBe("적용 기준: 정부지원금 13번 행");
    expect(host.querySelector(".text-\\[11px\\]")).toBeTruthy();
  });

  it("글이 없으면 아무것도 그리지 않는다", async () => {
    await show({});
    expect(host.innerHTML).toBe("");
    await show(undefined);
    expect(host.innerHTML).toBe("");
  });

  it("글자는 HTML 로 해석하지 않고 WEDLY 색 토큰만 쓴다", async () => {
    await show({ reason: "<b>굵게</b>" });
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toBe("<b>굵게</b>");
    const classes = host.innerHTML;
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(classes).not.toMatch(/\b(?:text|bg|border)-(?:red|gray|blue|orange|green|slate|zinc)-\d/);
    expect(classes).toMatch(/text-wedly-/);
  });
});

// ── 실제 화면 연결 — SettlementInfoTab 차수카드 칸 아래 ─────────────────────────────
type View = { mode: "legacy" } | { mode: "blocked"; message: string } | { mode: "standard"; target: FeePublicTargetV1 };
const marker = { version: 1, scope: "gov-contract", policyVersion: "test-policy", definitionSetVersion: "test-defs" };

describe("SettlementInfoTab 차수카드에 이유·적용 기준이 붙는다", () => {
  let root: Root, host: HTMLDivElement, saves: ReturnType<typeof vi.fn>;
  let nonce = 0;
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); saves = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  async function render(fields: FieldDef[], rows: TierData[], extra: Record<string, unknown> = {}) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ success: true, data: String(url).includes("fields") ? fields : { contractCards: [] } }) })));
    const original = JSON.stringify(rows);
    const props = {
      rawValue: original, onSave: saves, storagePrefix: "contract", fieldsApiPath: `/basis-fields-${++nonce}`, configApiPath: `/basis-config-${nonce}`,
      ratioBaseKey: "base", ratioFeeKey: "fee", ratioBaseLabel: "원금", ratioFeeLabel: "수수료", defaultScoreCards: [], readOnly: true, ...extra,
    } as ComponentProps<typeof SettlementInfoTab>;
    await act(async () => { root.render(<SettlementInfoTab {...props} />); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(JSON.stringify(rows)).toBe(original); expect(saves).not.toHaveBeenCalled();
  }
  const legacyFields = [{ key: "fee", label: "검사 수수료", type: "number" }] as FieldDef[];

  it("값이 있고 적용 기준이 저장돼 있으면 그 칸 아래에 「적용 기준: …」을 보인다", async () => {
    await render(legacyFields, [{ id: "one", label: "1차", fee: 880000, _fsb_fee: "정부지원금 13번 행" }]);
    expect(host.textContent).toContain("적용 기준: 정부지원금 13번 행");
    expect(host.textContent).toContain("880,000");
  });

  it("값이 비어 있고 사유가 저장돼 있으면 사유 글을 보인다", async () => {
    await render(legacyFields, [{ id: "one", label: "1차", _fsr_fee: "조건 중복 - 확인 필요" } as TierData]);
    expect(host.textContent).toContain("조건 중복 - 확인 필요");
    expect(host.textContent).not.toContain("적용 기준");
  });

  it("사람이 고친 값(_ovr_)이 있으면 적용 기준을 숨긴다", async () => {
    await render(legacyFields, [{ id: "one", label: "1차", fee: 500000, _ovr_fee: 500000, _fsb_fee: "정부지원금 13번 행" } as TierData]);
    expect(host.textContent).not.toContain("적용 기준");
  });

  it("저장 기록이 없는 차수는 아무 글도 늘지 않는다(지금과 같다)", async () => {
    await render(legacyFields, [{ id: "one", label: "1차", fee: 880000 }]);
    expect(host.textContent).not.toContain("적용 기준");
    expect(host.textContent).not.toContain("확인 필요");
  });

  const serverFields = [{ key: "fee", label: "검사 수수료", type: "number", feeStandard: marker }] as unknown as FieldDef[];
  const serverView = (value: number | null, source: "automatic" | "manual" | "finalized"): View => ({
    mode: "standard", target: { scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: "one" }, status: "calculated",
      fields: { fee: { value, source, automaticValue: source === "manual" ? 123 : null } }, edits: {} },
  });

  it("서버가 확정(finalized)한 칸은 적용 기준을 숨긴다", async () => {
    await render(serverFields, [{ id: "one", label: "1차", _fsb_fee: "정부지원금 13번 행" } as TierData], { feeTargetForTier: () => serverView(200000, "finalized") });
    expect(host.textContent).toContain("200,000");
    expect(host.textContent).not.toContain("적용 기준");
  });

  it("서버가 수동(manual)으로 알린 칸도 적용 기준을 숨긴다", async () => {
    await render(serverFields, [{ id: "one", label: "1차", _fsb_fee: "정부지원금 13번 행" } as TierData], { feeTargetForTier: () => serverView(200000, "manual") });
    expect(host.textContent).not.toContain("적용 기준");
  });

  it("서버가 자동 계산한 값이면 적용 기준을 보이고, 서버 값이 비면 사유를 보인다", async () => {
    await render(serverFields, [{ id: "one", label: "1차", _fsb_fee: "정부지원금 13번 행" } as TierData], { feeTargetForTier: () => serverView(200000, "automatic") });
    expect(host.textContent).toContain("적용 기준: 정부지원금 13번 행");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(serverFields, [{ id: "one", label: "1차", _fsr_fee: "정산 기준 확인 필요" } as TierData], { feeTargetForTier: () => serverView(null, "automatic") });
    expect(host.textContent).toContain("정산 기준 확인 필요");
    expect(host.textContent).not.toContain("적용 기준");
  });
});
