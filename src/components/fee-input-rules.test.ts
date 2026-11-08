import { describe, expect, it } from "vitest";
import type { TierData } from "@wedly/ui-shared";
import {
  applyFeeInputEdit,
  carryFeeInputMeta,
  FEE_KEY,
  feeFieldHint,
  feeMismatchDiff,
  feeMismatchMessage,
  isFeeInputCard,
  isFeeManual,
  readFeeSource,
  TOTAL_KEY,
  VAT_KEY,
  vatOf,
} from "./fee-input-rules";

// 가짜 차수 — 실제 고객 값이 아니다. ERP 서버 쪽 시험(src/lib/domains/tax-amendment/fee-input-rules.test.ts)이 같은 표를 쓴다.
const blank = (): TierData => ({ id: "t1", label: "1차", [FEE_KEY]: null, [VAT_KEY]: null, [TOTAL_KEY]: null });
const legacy = (): TierData => ({
  id: "t1", label: "1차",
  [FEE_KEY]: 2690000, [VAT_KEY]: 269000, [TOTAL_KEY]: 2959000,
  [`_src_${FEE_KEY}`]: "legacy", [`_src_${VAT_KEY}`]: "legacy", [`_src_${TOTAL_KEY}`]: "legacy",
});

describe("applyFeeInputEdit — 수수료를 넣으면 부가세·총을 계산한다", () => {
  it("손으로 3,000,000 을 처음 넣으면 부가세 300,000, 총 3,300,000 이고 수수료는 시작값(출처 없음)이다", () => {
    const out = applyFeeInputEdit(blank(), FEE_KEY, 3000000);
    expect(out[FEE_KEY]).toBe(3000000);
    expect(out[VAT_KEY]).toBe(300000);
    expect(out[TOTAL_KEY]).toBe(3300000);
    expect(readFeeSource(out, FEE_KEY)).toBeNull();
    expect(readFeeSource(out, VAT_KEY)).toBe("calc");
    expect(readFeeSource(out, TOTAL_KEY)).toBe("calc");
    expect(isFeeManual(out, FEE_KEY)).toBe(false);
  });

  it("부가세는 원 단위 내림이다", () => {
    expect(vatOf(2696637)).toBe(269663);
    expect(vatOf(19)).toBe(1);
    expect(applyFeeInputEdit(blank(), FEE_KEY, 2696637)[TOTAL_KEY]).toBe(2696637 + 269663);
  });

  it("같은 값을 다시 넣으면 아무것도 바뀌지 않는다", () => {
    const tier = legacy();
    expect(applyFeeInputEdit(tier, FEE_KEY, 2690000)).toBe(tier);
    expect(applyFeeInputEdit(tier, FEE_KEY, "2690000")).toBe(tier);
  });

  it("부가세를 고쳐 「수정됨」으로 만든 뒤 수수료를 바꾸면 부가세는 그대로, 총만 다시 계산된다", () => {
    const afterVat = applyFeeInputEdit(applyFeeInputEdit(blank(), FEE_KEY, 3000000), VAT_KEY, 123456);
    expect(readFeeSource(afterVat, VAT_KEY)).toBe("manual");
    expect(afterVat[TOTAL_KEY]).toBe(3300000); // 부가세를 고쳐도 총은 따라가지 않는다
    const out = applyFeeInputEdit(afterVat, FEE_KEY, 4000000);
    expect(out[VAT_KEY]).toBe(123456);
    expect(readFeeSource(out, VAT_KEY)).toBe("manual");
    expect(out[TOTAL_KEY]).toBe(4000000 + 123456);
    expect(readFeeSource(out, TOTAL_KEY)).toBe("calc");
  });

  it("총을 고친 칸(수정됨)은 수수료를 바꿔도 다시 계산하지 않는다", () => {
    const base = applyFeeInputEdit(blank(), FEE_KEY, 3000000);
    const manualTotal = applyFeeInputEdit(base, TOTAL_KEY, 3500000);
    const out = applyFeeInputEdit(manualTotal, FEE_KEY, 4000000);
    expect(out[TOTAL_KEY]).toBe(3500000);
    expect(out[VAT_KEY]).toBe(400000);
  });
});

describe("applyFeeInputEdit — 출처", () => {
  it("안내문·기존 값을 사람이 고치면 수정됨(manual)이 된다", () => {
    const fromLegacy = applyFeeInputEdit(legacy(), FEE_KEY, 2700000);
    expect(readFeeSource(fromLegacy, FEE_KEY)).toBe("manual");
    expect(isFeeManual(fromLegacy, FEE_KEY)).toBe(true);
    const fromNotice = applyFeeInputEdit({ ...legacy(), [`_src_${VAT_KEY}`]: "notice" }, VAT_KEY, 1);
    expect(readFeeSource(fromNotice, VAT_KEY)).toBe("manual");
  });

  it("고친 칸의 사유 글은 지워지고, 다시 계산된 칸의 사유 글도 지워진다", () => {
    const tier: TierData = { ...legacy(), [`_nt_${FEE_KEY}`]: "자동 입력 실패", [`_nt_${VAT_KEY}`]: "안내문 값과 다름: 1원" };
    const out = applyFeeInputEdit(tier, FEE_KEY, 2800000);
    expect(out[`_nt_${FEE_KEY}`]).toBeUndefined();
    expect(out[`_nt_${VAT_KEY}`]).toBeUndefined();
  });

  it("수수료를 비우면 계산해 둔 값만 같이 비운다", () => {
    const filled = applyFeeInputEdit(blank(), FEE_KEY, 3000000);
    const cleared = applyFeeInputEdit(filled, FEE_KEY, null);
    expect(cleared[VAT_KEY]).toBeNull();
    expect(cleared[TOTAL_KEY]).toBeNull();
    const keepsLegacy = applyFeeInputEdit(legacy(), FEE_KEY, null);
    expect(keepsLegacy[VAT_KEY]).toBe(269000);
    expect(keepsLegacy[TOTAL_KEY]).toBe(2959000);
  });

  it("부가세를 비우면 수수료로 계산한 값으로 돌아간다", () => {
    const edited = applyFeeInputEdit(applyFeeInputEdit(blank(), FEE_KEY, 3000000), VAT_KEY, 5);
    const restored = applyFeeInputEdit(edited, VAT_KEY, null);
    expect(restored[VAT_KEY]).toBe(300000);
    expect(readFeeSource(restored, VAT_KEY)).toBe("calc");
  });

  it("부가세를 비우면 계산값인 총도 되돌린 부가세로 다시 맞춘다 — 안내문·사람이 고친 총은 그대로", () => {
    // 부가세를 고친 채 수수료를 바꾸면 총(calc) = 새 수수료 + 고친 부가세. 그 뒤 부가세를 비우면 총도 다시 계산해야 한다.
    const vatEdited = applyFeeInputEdit(applyFeeInputEdit(blank(), FEE_KEY, 3000000), VAT_KEY, 123456);
    const feeChanged = applyFeeInputEdit(vatEdited, FEE_KEY, 4000000);
    expect(feeChanged[TOTAL_KEY]).toBe(4123456);
    const restored = applyFeeInputEdit(feeChanged, VAT_KEY, null);
    expect(restored[VAT_KEY]).toBe(400000);
    expect(restored[TOTAL_KEY]).toBe(4400000);
    expect(readFeeSource(restored, TOTAL_KEY)).toBe("calc");
    expect(feeMismatchDiff(restored)).toBeNull();

    const totalManual = applyFeeInputEdit(feeChanged, TOTAL_KEY, 4500000);
    const keptTotal = applyFeeInputEdit(totalManual, VAT_KEY, null);
    expect(keptTotal[TOTAL_KEY]).toBe(4500000);
    expect(readFeeSource(keptTotal, TOTAL_KEY)).toBe("manual");

    const notice = { ...blank(), [FEE_KEY]: 4000000, [VAT_KEY]: 123456, [TOTAL_KEY]: 4123456, "_src_수수료_반올림": "notice", "_src_부가세": "manual", "_src_총수수료_부가세포함": "notice" };
    const keptNotice = applyFeeInputEdit(notice, VAT_KEY, null);
    expect(keptNotice[TOTAL_KEY]).toBe(4123456);
    expect(readFeeSource(keptNotice, TOTAL_KEY)).toBe("notice");
  });
});

describe("합계 불일치 경고·칸 아래 글", () => {
  it("수수료 + 부가세 ≠ 총이면 차이를 알린다", () => {
    const tier = applyFeeInputEdit(applyFeeInputEdit(blank(), FEE_KEY, 3000000), TOTAL_KEY, 3300500);
    expect(feeMismatchDiff(tier)).toBe(500);
    expect(feeMismatchMessage(500)).toBe("수수료 + 부가세가 총 수수료와 다릅니다(차이 500원)");
    expect(feeMismatchMessage(-1500)).toBe("수수료 + 부가세가 총 수수료와 다릅니다(차이 1,500원)");
  });

  it("합이 맞거나 칸이 비어 있으면 경고하지 않는다", () => {
    expect(feeMismatchDiff(applyFeeInputEdit(blank(), FEE_KEY, 3000000))).toBeNull();
    expect(feeMismatchDiff(blank())).toBeNull();
  });

  it("출처별 글: 기존 계산값만 정해진 문구이고, 저장된 사유가 있으면 그 글이 먼저다", () => {
    expect(feeFieldHint(legacy(), FEE_KEY)).toBe("안내문 없음 - 기존 계산값");
    expect(feeFieldHint({ ...legacy(), [`_nt_${FEE_KEY}`]: "자동 입력 실패" }, FEE_KEY)).toBe("자동 입력 실패");
    expect(feeFieldHint(applyFeeInputEdit(blank(), FEE_KEY, 1000), FEE_KEY)).toBeNull();
    expect(feeFieldHint(blank(), FEE_KEY)).toBeNull();
    expect(feeFieldHint(legacy(), "19계약서작성일")).toBeNull();
  });
});

describe("칸 정의 판정·원문 되살리기", () => {
  const num = (key: string) => ({ key, type: "number" as const });
  it("세 칸이 모두 숫자 입력 칸일 때만 규칙을 쓴다(옛 수식 정의는 그대로)", () => {
    expect(isFeeInputCard([num(FEE_KEY), num(VAT_KEY), num(TOTAL_KEY)])).toBe(true);
    expect(isFeeInputCard([{ key: FEE_KEY, type: "formula" }, num(VAT_KEY), num(TOTAL_KEY)])).toBe(false);
    expect(isFeeInputCard([num(FEE_KEY), num(TOTAL_KEY)])).toBe(false);
  });

  it("공용 파서가 버린 _src_·_nt_ 를 같은 순서로 되살린다", () => {
    const raw = JSON.stringify([{ id: "a", [FEE_KEY]: 1, [`_src_${FEE_KEY}`]: "notice", [`_nt_${FEE_KEY}`]: "x", _ovr_foo: 3 }, { id: "b" }]);
    const parsed: TierData[] = [{ id: "a", label: "1차", [FEE_KEY]: 1 }, { id: "b", label: "2차" }];
    const out = carryFeeInputMeta(raw, parsed);
    expect(out[0][`_src_${FEE_KEY}`]).toBe("notice");
    expect(out[0][`_nt_${FEE_KEY}`]).toBe("x");
    expect(out[0]._ovr_foo).toBeUndefined();
    expect(out[1]).toBe(parsed[1]);
  });

  it("차수 개수가 다르거나 깨진 글이면 그대로 둔다", () => {
    const parsed: TierData[] = [{ id: "a", label: "1차" }];
    expect(carryFeeInputMeta("깨진", parsed)).toBe(parsed);
    expect(carryFeeInputMeta("[]", parsed)).toBe(parsed);
    expect(carryFeeInputMeta(null, parsed)).toBe(parsed);
  });
});
