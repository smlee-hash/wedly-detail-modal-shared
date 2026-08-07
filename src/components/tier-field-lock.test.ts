import { describe, it, expect } from "vitest";
import { tierFieldLock } from "./tier-field-lock";

describe("tierFieldLock — 차수 카드 칸 하나만 잠그기", () => {
  it("표시가 없으면 잠기지 않는다 (지금까지와 같은 동작)", () => {
    expect(tierFieldLock({ key: "계약금", label: "계약금", type: "number" })).toEqual({ locked: false });
  });

  it("readOnly:true 면 잠기고 꼬리표 글자를 함께 준다", () => {
    expect(
      tierFieldLock({ key: "컨설팅담당", label: "컨설팅 담당", type: "select", readOnly: true, readOnlyNote: "ERP에서 관리" }),
    ).toEqual({ locked: true, note: "ERP에서 관리" });
  });

  it("꼬리표 글자가 없으면 잠기기만 한다", () => {
    expect(tierFieldLock({ key: "x", readOnly: true })).toEqual({ locked: true, note: undefined });
  });

  it("빈 글자·공백뿐인 꼬리표는 없는 것으로 본다", () => {
    expect(tierFieldLock({ key: "x", readOnly: true, readOnlyNote: "   " })).toEqual({ locked: true, note: undefined });
  });

  it("readOnly 가 참 같은 값이어도 true 가 아니면 잠그지 않는다 (실수로 잠기는 것 방지)", () => {
    expect(tierFieldLock({ key: "x", readOnly: "true" })).toEqual({ locked: false });
    expect(tierFieldLock({ key: "x", readOnly: 1 })).toEqual({ locked: false });
  });

  it("칸 정의가 없거나 이상해도 터지지 않는다", () => {
    expect(tierFieldLock(null)).toEqual({ locked: false });
    expect(tierFieldLock(undefined)).toEqual({ locked: false });
    expect(tierFieldLock("계약금")).toEqual({ locked: false });
  });
});
