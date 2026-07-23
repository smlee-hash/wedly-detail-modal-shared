import { describe, it, expect } from "vitest";
import { buildGovEvalBase, fillCommonSpecSiblings } from "./gov-eval-context";

// ui-shared COMMON_BASIC_FIELD_SPECS 의 실제 후보 순서를 그대로 반영한 시험용 스펙
// (사업장주소지: unified/sections.ts:219, DB 분류: :213 — 2026-07-23 실측).
const SPECS = [
  { keys: ["52사업장주소지", "27주소지", "사업장주소지", "주소지", "주소"] },
  { keys: ["custom_1779774393414_b1wc", "59DB담당"] },
];

// 대웅글로벌 실측 재현(2026-07-23 반려 케이스): 정책 행엔 조건 키가 전혀 없고 경정청구 행에만 있다.
const TAX = {
  "02상호명": "대웅글로벌",
  "52사업장주소지": "서울특별시 금천구 가산디지털2로 101",
  custom_1779774393414_b1wc: "하이브",
  영업담당: "하이브",
};

describe("buildGovEvalBase — 카드 평가 문맥(전체 탭 동등)", () => {
  it("정책 행만 있는 화면: 경정청구 행의 조건 키가 바탕에 깔리고 27주소지가 52로 채워진다", () => {
    const rows = [
      { domain: "tax-amendment", row: TAX },
      { domain: "policy-fund", row: { "01업체명": "대웅글로벌" } },
    ];
    const primary = { "01업체명": "대웅글로벌", "04사업자번호": "206-21-48723" };
    const base = buildGovEvalBase(rows, primary, SPECS);
    expect(base["custom_1779774393414_b1wc"]).toBe("하이브");
    expect(base["영업담당"]).toBe("하이브");
    expect(base["27주소지"]).toBe(TAX["52사업장주소지"]);
  });

  it("primaryRow 값이 경정청구 값을 이긴다(전체 탭 병합 순서 보존)", () => {
    const base = buildGovEvalBase([{ domain: "tax-amendment", row: TAX }], { 영업담당: "위들리" }, SPECS);
    expect(base["영업담당"]).toBe("위들리");
  });

  it("경정청구 행이 없으면 primaryRow 후보 채움만 적용된다", () => {
    const base = buildGovEvalBase([{ domain: "policy-fund", row: {} }], { "52사업장주소지": "경기도 고양시" }, SPECS);
    expect(base["27주소지"]).toBe("경기도 고양시");
  });

  it("값이 있는 키는 절대 덮어쓰지 않는다", () => {
    const out = fillCommonSpecSiblings({ "52사업장주소지": "서울", "27주소지": "부산" }, SPECS);
    expect(out["27주소지"]).toBe("부산");
  });

  it("빈 문자열도 빈 값으로 보고 채운다(전체 탭 fillCommonKeys 와 동일)", () => {
    const out = fillCommonSpecSiblings({ "52사업장주소지": "서울", "27주소지": "  " }, SPECS);
    expect(out["27주소지"]).toBe("서울");
  });

  it("rows.row 가 객체가 아니어도 안전하다", () => {
    const base = buildGovEvalBase([{ domain: "tax-amendment", row: null }], { "01업체명": "테스트" }, SPECS);
    expect(base["01업체명"]).toBe("테스트");
  });
});
