import { describe, expect, it } from "vitest";
import { overrideKeyOf, type FieldDef, type TierData } from "@wedly/ui-shared";
import { createFeeTierContext, type FeeTargetForTier } from "./fee-tier-display";

const marker = { version: 1, scope: "gov-contract", policyVersion: "test", definitionSetVersion: "test" };
const fee = { key: "fee", label: "fee", type: "formula", feeStandard: marker, formula: [{ op: "+", unit: "number", value: 999 }] } as FieldDef;
const row: TierData = { id: "one", label: "1", fee: 777777, base: 1000000 };
const current = (value: number | null | string): FeeTargetForTier => () => ({ mode: "standard", target: {
  scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: "one" },
  status: "calculated", fields: { fee: { value, source: "automatic", automaticValue: null } }, edits: {},
} });
const num = (value: number) => ({ op: "+" as const, unit: "number" as const, value });
const times = (key: string): FieldDef => ({ key: key === "fee" ? "double" : "quad", label: "result", type: "formula", formula: [
  { op: "+", unit: "column", columnKey: key }, { op: "*", unit: "number", value: 2 },
] });

describe("independent display review regressions", () => {
  it.each(["target-blocked", "view-blocked", "view-invalid"] as const)("a sanitized public field remains managed for %s", mode => {
    const publicFee = { key: "fee", label: "fee", type: "number", readOnly: true, feeServerManaged: true } as FieldDef;
    const resolver: FeeTargetForTier = mode === "target-blocked"
      ? () => ({ mode: "standard", target: { scope: "gov-contract", target: { area: "contract", containerKey: "계약정보_차수", tierId: "one" }, status: "blocked", fields: {}, edits: {} } })
      : mode === "view-blocked" ? () => ({ mode: "blocked", message: "unavailable" }) : () => ({} as ReturnType<FeeTargetForTier>);
    const ctx = createFeeTierContext(row, [publicFee], resolver, {});
    expect(ctx.serverManaged).toBe(true);
    expect(ctx.select(publicFee).state).toBe("unresolved");
  });
  it.each([null, ""])("authoritative blank %j cannot fall back to stale row condition", value => {
    const dependent: FieldDef = { key: "dependent", label: "dependent", type: "formula", formula: [num(7)], conditional: {
      rules: [{ clauses: [{ leftKey: "fee", op: "eq", right: { kind: "text", value: "777777" } }], formula: [num(99)] }],
    } };
    const ctx = createFeeTierContext(row, [fee, dependent], current(value), { fee: 777777 });
    expect(ctx.select(dependent)).toMatchObject({ state: "selected", value: 7 });
    expect(row.fee).toBe(777777);
  });
  it("an intermediate manual value cuts off unresolved transitive dependencies", () => {
    const double = times("fee"), quad = times("double");
    const ctx = createFeeTierContext({ ...row, [overrideKeyOf("double")]: 25 }, [fee, double, quad], () => ({ mode: "blocked", message: "missing basis" }), {});
    expect(ctx.select(double)).toMatchObject({ state: "selected", value: 25 });
    expect(ctx.select(quad)).toMatchObject({ state: "selected", value: 50 });
  });
  it("a formula percentage keeps its ratio semantics in a dependent calculation", () => {
    const percent: FieldDef = { ...fee, formulaResult: "percent" };
    const base: FieldDef = { key: "base", label: "base", type: "number" };
    const result: FieldDef = { key: "result", label: "result", type: "formula", formula: [
      { op: "+", unit: "column", columnKey: "base" }, { op: "*", unit: "column", columnKey: "fee" },
    ] };
    const ctx = createFeeTierContext(row, [percent, base, result], current(0.1), {});
    expect(ctx.select(percent)).toMatchObject({ state: "selected", value: 0.1 });
    expect(ctx.select(result)).toMatchObject({ state: "selected", value: 100000 });
  });
});


it.each([undefined, "all"] as const)("only the selected conditional formula needs its managed dependency (%s)", match => {
  const base: FieldDef = { key: "base", label: "base", type: "number" };
  const dependent: FieldDef = { key: "dependent", label: "dependent", type: "formula", formula: [num(7)], conditional: {
    ...(match ? { match } : {}), rules: [{ clauses: [{ leftKey: "base", op: "gte", right: { kind: "text", value: "1000000" } }], formula: [{ op: "+", unit: "column", columnKey: "fee" }] }],
  } };
  const resolver: FeeTargetForTier = () => ({ mode: "blocked", message: "missing basis" });
  expect(createFeeTierContext({ ...row, base: 500000 }, [fee, base, dependent], resolver, {}).select(dependent)).toMatchObject({ state: "selected", value: 7 });
  expect(createFeeTierContext({ ...row, base: 2000000 }, [fee, base, dependent], resolver, {}).select(dependent).state).toBe("unresolved");
});
