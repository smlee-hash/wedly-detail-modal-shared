import { describe, it, expect } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import { splitHiddenFields, mergeHiddenFields } from "./hidden-fields-merge";

function field(key: string, extra: Partial<FieldDef> = {}): FieldDef {
  return { key, label: key, type: "text", ...extra };
}

const A = field("A");
const B = field("B");
const C = field("C");
const H1 = field("매출VAT포함", { label: "WEDLY 매출(VAT포함)", type: "number" });
const H2 = field("매출VAT제외", { label: "WEDLY 매출(VAT제외)", type: "number" });

function isHidden(f: FieldDef): boolean {
  return f.key === "매출VAT포함" || f.key === "매출VAT제외" || /WEDLY\s*매출/i.test(f.label);
}

describe("splitHiddenFields", () => {
  it("숨김 칸을 빼고, 원래 배열 위치를 index 로 남긴다", () => {
    const all = [A, H1, B, H2, C];
    const { visible, hidden } = splitHiddenFields(all, isHidden);
    expect(visible).toEqual([A, B, C]);
    expect(hidden).toEqual([
      { field: H1, index: 1 },
      { field: H2, index: 3 },
    ]);
    expect(hidden[0].field).toBe(H1);
    expect(hidden[1].field).toBe(H2);
  });

  it("숨김이 없으면 visible 은 전체, hidden 은 빈 배열", () => {
    const all = [A, B, C];
    const { visible, hidden } = splitHiddenFields(all, isHidden);
    expect(visible).toEqual([A, B, C]);
    expect(hidden).toEqual([]);
  });

  it("전부가 숨김이면 visible 은 빈 배열, hidden 은 전부+위치", () => {
    const all = [H1, H2];
    const { visible, hidden } = splitHiddenFields(all, isHidden);
    expect(visible).toEqual([]);
    expect(hidden).toEqual([
      { field: H1, index: 0 },
      { field: H2, index: 1 },
    ]);
  });

  it("원본 배열은 바꾸지 않는다", () => {
    const all = [A, H1, B];
    const snapshot = [...all];
    splitHiddenFields(all, isHidden);
    expect(all).toEqual(snapshot);
    expect(all[0]).toBe(A);
    expect(all[1]).toBe(H1);
  });
});

describe("mergeHiddenFields", () => {
  it("숨김 칸을 원래 위치에 되끼운다", () => {
    const visible = [A, B, C];
    const hidden = [
      { field: H1, index: 1 },
      { field: H2, index: 3 },
    ];
    expect(mergeHiddenFields(visible, hidden)).toEqual([A, H1, B, H2, C]);
  });

  it("index 가 배열 길이를 넘으면 끝에 붙인다", () => {
    const visible = [A, B];
    const hidden = [{ field: H1, index: 10 }];
    expect(mergeHiddenFields(visible, hidden)).toEqual([A, B, H1]);
  });

  it("hidden 이 비면 visible 을 그대로(같은 참조) 돌려준다", () => {
    const visible = [A, B, C];
    const result = mergeHiddenFields(visible, []);
    expect(result).toBe(visible);
  });

  it("보이는 칸 순서는 그대로 두고 숨김만 끼워 넣는다", () => {
    const visible = [A, B, C];
    const hidden = [{ field: H1, index: 0 }];
    expect(mergeHiddenFields(visible, hidden)).toEqual([H1, A, B, C]);
  });

  it("연속된 숨김 칸도 원래 순서로 복원한다", () => {
    const visible = [A, B];
    const hidden = [
      { field: H1, index: 1 },
      { field: H2, index: 2 },
    ];
    expect(mergeHiddenFields(visible, hidden)).toEqual([A, H1, H2, B]);
  });

  it("hidden 이 위치 역순으로 와도 원래 위치에 맞춘다", () => {
    const visible = [A, B, C];
    const hidden = [
      { field: H2, index: 3 },
      { field: H1, index: 1 },
    ];
    expect(mergeHiddenFields(visible, hidden)).toEqual([A, H1, B, H2, C]);
  });

  it("원본 visible·hidden 배열은 바꾸지 않는다", () => {
    const visible = [A, B, C];
    const hidden = [
      { field: H1, index: 1 },
      { field: H2, index: 3 },
    ];
    const visibleSnap = [...visible];
    const hiddenSnap = hidden.map((h) => ({ ...h }));
    mergeHiddenFields(visible, hidden);
    expect(visible).toEqual(visibleSnap);
    expect(hidden).toEqual(hiddenSnap);
  });

  it("보이는 칸이 늘어난 뒤에도 숨김은 원래 index 에 끼우고 나머지는 뒤로 민다", () => {
    const extra = field("D");
    const visible = [A, B, C, extra];
    const hidden = [
      { field: H1, index: 1 },
      { field: H2, index: 3 },
    ];
    expect(mergeHiddenFields(visible, hidden)).toEqual([A, H1, B, H2, C, extra]);
  });
});

describe("splitHiddenFields + mergeHiddenFields 왕복", () => {
  it("가르고 다시 합치면 원래 배열과 같다", () => {
    const all = [A, H1, B, H2, C];
    const { visible, hidden } = splitHiddenFields(all, isHidden);
    expect(mergeHiddenFields(visible, hidden)).toEqual(all);
  });

  it("맨 앞·맨 끝 숨김도 왕복한다", () => {
    const all = [H1, A, B, H2];
    const { visible, hidden } = splitHiddenFields(all, isHidden);
    expect(visible).toEqual([A, B]);
    expect(hidden).toEqual([
      { field: H1, index: 0 },
      { field: H2, index: 3 },
    ]);
    expect(mergeHiddenFields(visible, hidden)).toEqual(all);
  });
});
