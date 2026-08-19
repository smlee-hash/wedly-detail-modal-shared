import { describe, it, expect } from "vitest";
import type { FieldDef } from "@wedly/ui-shared";
import { appendFieldOption } from "./field-option-append";

function selectField(extra: Partial<FieldDef> & Record<string, unknown> = {}): FieldDef {
  return {
    key: "담당",
    label: "담당 컨설턴트",
    type: "select",
    options: ["일루아", "하이브"],
    optionColors: { 일루아: { bg: "#eee", text: "#111" } },
    ...extra,
  } as FieldDef;
}

const amount: FieldDef = { key: "금액", label: "금액", type: "number" };

describe("appendFieldOption — 선택 칸 보기 목록에 영구 추가", () => {
  it("새 보기를 그 칸 options 끝에 붙인 새 배열을 준다", () => {
    const fields = [selectField(), amount];
    const next = appendFieldOption(fields, "담당", "ERP");
    expect(next).not.toBeNull();
    expect(next!.find((f) => f.key === "담당")!.options).toEqual(["일루아", "하이브", "ERP"]);
  });

  it("원본 배열과 원본 칸 객체는 바꾸지 않는다", () => {
    const fields = [selectField(), amount];
    const snapshot = JSON.parse(JSON.stringify(fields));
    appendFieldOption(fields, "담당", "ERP");
    expect(fields).toEqual(snapshot);
  });

  it("앞뒤 공백은 잘라서 넣는다", () => {
    const next = appendFieldOption([selectField()], "담당", "  ERP  ");
    expect(next!.find((f) => f.key === "담당")!.options).toEqual(["일루아", "하이브", "ERP"]);
  });

  it("빈 글자·공백만이면 변경 없음(null)", () => {
    const fields = [selectField()];
    expect(appendFieldOption(fields, "담당", "")).toBeNull();
    expect(appendFieldOption(fields, "담당", "   ")).toBeNull();
  });

  it("칸이 없으면 null", () => {
    expect(appendFieldOption([selectField()], "없는칸", "ERP")).toBeNull();
  });

  it("선택 칸이 아니면 null", () => {
    expect(appendFieldOption([selectField(), amount], "금액", "ERP")).toBeNull();
  });

  it("이미 같은 보기가 있으면 null", () => {
    const fields = [selectField()];
    expect(appendFieldOption(fields, "담당", "일루아")).toBeNull();
    expect(appendFieldOption(fields, "담당", "  하이브  ")).toBeNull();
  });

  it("options 가 없던 선택 칸이면 새 배열로 시작한다", () => {
    const next = appendFieldOption(
      [{ key: "담당", label: "담당", type: "select" }],
      "담당",
      "일루아",
    );
    expect(next!.find((f) => f.key === "담당")!.options).toEqual(["일루아"]);
  });

  it("다른 칸은 같은 객체를 유지하고, scope·tableExposed·description·optionColors·잠금 표시를 잃지 않는다", () => {
    const locked = selectField({
      tableExposed: true,
      description: "담당자를 고른다",
      scope: "common",
      readOnly: true,
      readOnlyNote: "ERP에서 관리",
    });
    const fields = [locked, amount];
    const next = appendFieldOption(fields, "담당", "ERP");
    expect(next).not.toBeNull();
    expect(next!.find((f) => f.key === "금액")).toBe(amount);
    const f = next!.find((x) => x.key === "담당") as FieldDef & {
      scope?: string;
      readOnly?: boolean;
      readOnlyNote?: string;
    };
    expect(f.options).toEqual(["일루아", "하이브", "ERP"]);
    expect(f.scope).toBe("common");
    expect(f.tableExposed).toBe(true);
    expect(f.description).toBe("담당자를 고른다");
    expect(f.optionColors).toEqual({ 일루아: { bg: "#eee", text: "#111" } });
    expect(f.readOnly).toBe(true);
    expect(f.readOnlyNote).toBe("ERP에서 관리");
    expect(f.label).toBe("담당 컨설턴트");
  });
});
