import { describe, expect, it } from "vitest";
import { hasSavedTierMutation, refundReadProjectionOf, type RefundReadProjection, type SavedTierFieldSelection } from "./gov-save-observation";

type Tier = Record<string, unknown>;

const serverRead = { 계약일: "2026-10-12", 컨설팅담당: "담당", _refundContractState: "resolved" };
const sole: RefundReadProjection = { soleContractTierId: "contract-one" };
const persisted: Tier = { id: "r1", label: "1차 정산", 환불금액: 100, _contractTierId: "contract-one" };
const added: Tier = { id: "r2", label: "2차 정산", 환불금액: 200 };

function saved(before: Tier[] | undefined, submitted: Tier[], observed: Tier[], context?: RefundReadProjection, selection?: SavedTierFieldSelection) {
  return hasSavedTierMutation(before && JSON.stringify(before), JSON.stringify(submitted), JSON.stringify(observed), selection, context);
}

describe("환불 읽기 투영이 켜진 소유자의 저장 확인", () => {
  it("변경 없는 미연결 환불도 서버의 유일 계약 연결을 포함해 저장 확인한다", () => {
    const tier = { id: "r1", label: "1차 정산", 환불금액: 100 };
    const before = [{ ...tier, ...serverRead }];
    const selection = { tierId: "r1", index: 0, fieldKey: "환불금액" };
    const observed = [{ ...tier, ...serverRead, _contractTierId: "contract-one" }];
    expect(saved(before, [tier], observed, sole, selection)).toBe(true);
    expect(saved(before, [tier], [{ ...observed[0], _contractTierId: "wrong-contract" }], sole, selection)).toBe(false);
  });

  it("id 없는 유일 계약은 서버와 같은 안정 id로 연결된 새 환불을 확인한다", () => {
    const context = refundReadProjectionOf({ row: {
      _governmentRefundContextEnabled: true, 계약정보_차수: JSON.stringify([{ 계약일: "2026-10-12" }]),
    } }, "환불정보_차수");
    expect(saved([], [added], [{ ...added, ...serverRead, _contractTierId: "tier-1-0" }], context)).toBe(true);
    expect(saved([], [added], [{ ...added, ...serverRead, _contractTierId: "tier-2-1" }], context)).toBe(false);
  });

  it("같은 값을 명시해 저장해도 표시 문맥만 갱신됐다면 실제 선택값을 확인한다", () => {
    const before = [{ ...persisted, ...serverRead }];
    const observed = [{ ...persisted, ...serverRead, 컨설팅담당: "새 계약 담당" }];
    expect(saved(before, before, observed, sole, { tierId: "r1", index: 0, fieldKey: "환불금액" })).toBe(true);
  });

  it("빈 계약 연결은 서버처럼 이전 연결을 유지하고 명시된 다른 연결은 그대로 대조한다", () => {
    const before = [{ ...persisted, ...serverRead }];
    const submitted = [{ ...persisted, 환불금액: 150, _contractTierId: "", ...serverRead }];
    const observed = [{ ...persisted, 환불금액: 150, ...serverRead }];
    expect(saved(before, submitted, observed, sole)).toBe(true);
    expect(saved(before, submitted, [{ ...observed[0], _contractTierId: "wrong-contract" }], sole)).toBe(false);
  });

  it("0→1: 서버가 붙인 읽기 칸과 유일한 계약 연결만 더해진 새 차수를 확인한다", () => {
    const observed = [{ ...added, ...serverRead, _contractTierId: "contract-one" }];
    for (const before of [undefined, [] as Tier[]]) {
      expect(saved(before, [added], observed, sole)).toBe(true);
      expect(saved(before, [added], observed)).toBe(false);
    }
  });

  it("1→2: 원본·제출·관측에 읽기 칸이 있어도 새 차수를 확인한다", () => {
    const before = [{ ...persisted, ...serverRead }];
    const observed = [{ ...persisted, ...serverRead, 컨설팅담당: "바뀐 담당" }, { ...added, ...serverRead, _contractTierId: "contract-one" }];
    expect(saved(before, [{ ...persisted, ...serverRead }, added], observed, sole)).toBe(true);
    expect(saved(before, [{ ...persisted, ...serverRead }, added], observed)).toBe(false);
  });

  it("제출에 있던 읽기 칸은 서버가 지우므로 값이 달라도 비교하지 않는다", () => {
    const observed = [{ ...added, ...serverRead, _contractTierId: "contract-one" }];
    expect(saved([], [{ ...added, 계약일: "2020-01-01" }], observed, sole)).toBe(true);
  });

  it("사용자가 고친 칸·차수 id·서버가 붙이지 않는 칸은 계속 엄격하다", () => {
    const base = { ...added, ...serverRead, _contractTierId: "contract-one" };
    expect(saved([], [added], [{ ...base, 환불금액: 201 }], sole)).toBe(false);
    expect(saved([], [added], [{ ...base, label: "다른 이름" }], sole)).toBe(false);
    expect(saved([], [added], [{ ...base, id: "r3" }], sole)).toBe(false);
    expect(saved([], [added], [{ ...base, 메모: "서버가 붙이지 않는 칸" }], sole)).toBe(false);
  });

  it("차수 수·순서·중복·삭제는 제출한 구조 그대로일 때만 확인한다", () => {
    const before = [{ ...persisted, ...serverRead }];
    const sent = [{ ...persisted, ...serverRead }, added];
    const old = { ...persisted, ...serverRead };
    const next = { ...added, ...serverRead, _contractTierId: "contract-one" };
    expect(saved(before, sent, [old], sole)).toBe(false);
    expect(saved(before, sent, [next, old], sole)).toBe(false);
    expect(saved(before, sent, [old, next, next], sole)).toBe(false);
    expect(saved(before, sent, [old, { ...next, id: "r1" }], sole)).toBe(false);
    // 삭제는 반영됐을 때만 확인하고, 그대로 남아 있으면 확인하지 않는다.
    expect(saved([persisted, added], [persisted], [{ ...old }], sole)).toBe(true);
    expect(saved([persisted, added], [persisted], [old, { ...added, ...serverRead }], sole)).toBe(false);
  });

  it("제출한 계약 연결은 그대로 남아야 하고 다르면 확인하지 않는다", () => {
    const explicit = { ...added, _contractTierId: "contract-two" };
    expect(saved([], [explicit], [{ ...explicit, ...serverRead }], sole)).toBe(true);
    expect(saved([], [explicit], [{ ...explicit, ...serverRead, _contractTierId: "contract-one" }], sole)).toBe(false);
    expect(saved([], [explicit], [{ ...added, ...serverRead }], sole)).toBe(false);
  });

  it("묵시적 계약 연결은 같은 소유자의 유일한 계약 id 하나만 인정한다", () => {
    const withId = (id: string) => [{ ...added, ...serverRead, _contractTierId: id }];
    expect(saved([], [added], withId("contract-two"), sole)).toBe(false);
    expect(saved([], [added], [{ ...added, ...serverRead }], sole)).toBe(false);
    // 계약이 없거나 둘 이상이면 서버는 연결을 붙이지 않는다.
    expect(saved([], [added], [{ ...added, ...serverRead }], {})).toBe(true);
    expect(saved([], [added], withId("contract-one"), {})).toBe(false);
  });

  it("고친 기존 차수는 이전 계약 연결을 유지한 채로 확인한다", () => {
    const before = [{ ...persisted, _contractTierId: "contract-two", ...serverRead }];
    // 화면이 모르는 칸을 돌려주지 않아 제출에 계약 연결이 빠진 경우.
    const changed = { id: "r1", label: "1차 정산", 환불금액: 150, ...serverRead };
    const observed = [{ ...changed, _contractTierId: "contract-two" }];
    expect(saved(before, [changed], observed, sole)).toBe(true);
    expect(saved(before, [changed], [{ ...observed[0], 환불금액: 151 }], sole)).toBe(false);
  });

  it("명시한 칸은 읽기 칸 제외 후에도 값·존재가 일치해야 한다", () => {
    const selection: SavedTierFieldSelection = { tierId: "r2", index: 1, fieldKey: "환불금액" };
    const before = [{ ...persisted, ...serverRead }];
    const sent = [{ ...persisted, ...serverRead }, added];
    const observed = (amount: number) => [{ ...persisted, ...serverRead }, { ...added, 환불금액: amount, ...serverRead, _contractTierId: "contract-one" }];
    expect(saved(before, sent, observed(200), sole, selection)).toBe(true);
    expect(saved(before, sent, observed(201), sole, selection)).toBe(false);
  });
});

describe("refundReadProjectionOf", () => {
  const owner = (row: Tier) => ({ row });

  it("환불 컨테이너이고 소유자 줄의 플래그가 정확히 true일 때만 유일한 계약 id를 돌려준다", () => {
    const row = { _governmentRefundContextEnabled: true, 계약정보_차수: JSON.stringify([{ id: "contract-one" }]) };
    expect(refundReadProjectionOf(owner(row), "환불정보_차수")).toEqual({ soleContractTierId: "contract-one" });
    expect(refundReadProjectionOf(owner({ ...row, 계약정보_차수: [{ id: "contract-one" }] }), "환불정보_차수")).toEqual({ soleContractTierId: "contract-one" });
    for (const flag of [false, "true", 1, undefined]) {
      expect(refundReadProjectionOf(owner({ ...row, _governmentRefundContextEnabled: flag }), "환불정보_차수")).toBeUndefined();
    }
    for (const key of ["계약정보_차수", "정산정보"]) expect(refundReadProjectionOf(owner(row), key)).toBeUndefined();
    expect(refundReadProjectionOf(null, "환불정보_차수")).toBeUndefined();
    expect(refundReadProjectionOf({}, "환불정보_차수")).toBeUndefined();
  });

  it("계약이 하나일 때만 서버의 유일 계약 식별자를 돌려준다", () => {
    const flagged = (contracts: unknown) => owner({ _governmentRefundContextEnabled: true, 계약정보_차수: contracts });
    expect(refundReadProjectionOf(flagged(JSON.stringify([{ id: "a" }, { id: "b" }])), "환불정보_차수")).toEqual({});
    expect(refundReadProjectionOf(flagged(JSON.stringify([{ id: "a" }, {}])), "환불정보_차수")).toEqual({});
    expect(refundReadProjectionOf(flagged(JSON.stringify([{}])), "환불정보_차수")).toEqual({ soleContractTierId: "tier-1-0" });
    expect(refundReadProjectionOf(flagged(undefined), "환불정보_차수")).toEqual({});
  });
});

describe("malformed prior refund JSON requires an exact projected result", () => {
  const raw = (v: unknown) => JSON.stringify(v);
  const expected = [{ ...added, ...serverRead, _contractTierId: "contract-one" }];
  it("accepts only the exact requested replacement under the current refund projection", () => {
    expect(hasSavedTierMutation("{broken", raw([added]), raw(expected), undefined, sole)).toBe(true);
    for (const bad of [
      [{ ...expected[0], 환불금액: 999 }],
      [{ ...expected[0], id: "wrong-id" }],
      [{ ...expected[0], _contractTierId: "wrong-contract" }],
      [{ ...expected[0], unexpected: true }], [], [...expected, ...expected],
    ]) expect(hasSavedTierMutation("{broken", raw([added]), raw(bad), undefined, sole)).toBe(false);
    expect(hasSavedTierMutation("{broken", "{bad-submitted", raw(expected), undefined, sole)).toBe(false);
    expect(hasSavedTierMutation("{broken", raw([added]), "{bad-observed", undefined, sole)).toBe(false);
    expect(hasSavedTierMutation("{broken", raw([added]), raw(expected), { tierId: "r2", index: 0, fieldKey: "메모" }, sole)).toBe(true);
    expect(hasSavedTierMutation("{broken", raw([added]), raw([{ ...expected[0], 메모: "changed" }]), { tierId: "r2", index: 0, fieldKey: "메모" }, sole)).toBe(false);
    expect(hasSavedTierMutation("{broken", raw([added]), raw(expected))).toBe(false);
    expect(hasSavedTierMutation("{broken", raw([added]), raw([added]))).toBe(true);
  });
});
