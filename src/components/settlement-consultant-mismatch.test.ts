import { describe, expect, it } from "vitest";
import {
  consultantDisplayText,
  settlementConsultantNotice,
} from "./settlement-consultant-mismatch";

// 시험용 가짜 이름만 쓴다(실제 고객·직원 자료 아님).
const contract = (name: unknown) => ({ id: "c1", label: "1차", 계약금: 1000000, 담당컨설턴트: name });
const settlement = (name: unknown) => ({ id: "s1", label: "1차", 담당컨설턴트: name });

describe("담당 컨설턴트 화면 글자", () => {
  it.each([
    ["김민경", "김민경"],
    ["  김민경  ", "김민경"],
    ["김민경 | min@example.com", "김민경"],
    ["김민경 <min@example.com>", "김민경"],
    ["김민경, 이충훈", "김민경, 이충훈"],
    ["김민경 | min@example.com, 이충훈", "김민경, 이충훈"],
    ["", ""],
    [null, ""],
    [undefined, ""],
    [12, ""],
    [{ name: "김민경" }, ""],
  ])("값 %j → 화면 글자 %j", (value, text) => {
    expect(consultantDisplayText(value)).toBe(text);
  });
});

describe("정산 차수 담당 컨설턴트 경고", () => {
  it("계약 차수 하나와 담당이 다르면 한 줄 경고를 돌려준다", () => {
    expect(settlementConsultantNotice(settlement("시험김"), [contract("시험이")]))
      .toBe("계약 차수 담당 컨설턴트(시험이)와 다릅니다");
  });

  it("담당이 같으면 경고가 없다", () => {
    expect(settlementConsultantNotice(settlement("시험이"), [contract("시험이")])).toBeNull();
  });

  it("이메일이 붙은 저장 형식이어도 화면 글자가 같으면 경고가 없다", () => {
    expect(settlementConsultantNotice(settlement("시험이"), [contract("시험이 | test@example.com")])).toBeNull();
  });

  it("여러 명 선택은 순서까지 같아야 같다(맨 앞 사람이 정산을 받는다)", () => {
    expect(settlementConsultantNotice(settlement("시험이, 시험김"), [contract("시험이, 시험김")])).toBeNull();
    expect(settlementConsultantNotice(settlement("시험김, 시험이"), [contract("시험이, 시험김")]))
      .toBe("계약 차수 담당 컨설턴트(시험이, 시험김)와 다릅니다");
  });

  it("계약 차수가 두 개 이상이면 경고를 내지 않는다(「계약 차수 확인 필요」가 대신 뜬다)", () => {
    expect(settlementConsultantNotice(settlement("시험김"), [contract("시험이"), contract("시험박")])).toBeNull();
  });

  it("계약 차수가 없으면 경고를 내지 않는다", () => {
    expect(settlementConsultantNotice(settlement("시험김"), [])).toBeNull();
  });

  it("어느 한쪽 담당이 비어 있으면 다르다고 말하지 않는다", () => {
    expect(settlementConsultantNotice(settlement(""), [contract("시험이")])).toBeNull();
    expect(settlementConsultantNotice(settlement("시험김"), [contract("")])).toBeNull();
    expect(settlementConsultantNotice(settlement(undefined), [contract(undefined)])).toBeNull();
  });

  it("계약 차수 목록은 JSON 글자로 받아도 같게 읽는다", () => {
    expect(settlementConsultantNotice(settlement("시험김"), JSON.stringify([contract("시험이")])))
      .toBe("계약 차수 담당 컨설턴트(시험이)와 다릅니다");
    expect(settlementConsultantNotice(settlement("시험김"), "깨진 글자")).toBeNull();
    expect(settlementConsultantNotice(settlement("시험김"), null)).toBeNull();
  });

  it("정산 차수 값이 없는 입력에도 오류 없이 경고가 없다", () => {
    expect(settlementConsultantNotice(null, [contract("시험이")])).toBeNull();
    expect(settlementConsultantNotice(undefined, [contract("시험이")])).toBeNull();
  });
});
