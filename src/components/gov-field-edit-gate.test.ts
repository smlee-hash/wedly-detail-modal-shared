import { describe, it, expect } from "vitest";
import { resolveGovFieldEditProps, shouldShowAddContract } from "./gov-field-edit-gate";

describe("resolveGovFieldEditProps", () => {
  it("ERP(구조 편집 허용)는 지금 동작 그대로 — 모두 미지정(undefined)이라 allowStructureEdit 폴백", () => {
    const p = resolveGovFieldEditProps({ allowStructureEdit: true, allowPartnerFieldEdit: false }, true);
    expect(p.allowCardEdit).toBeUndefined();
    expect(p.allowColumnEdit).toBeUndefined();
    expect(p.columnScopeMode).toBe("erp");
    expect(p.allowRowLayoutEdit).toBe(true);
    expect(p.allowColumnDelete).toBe(true);
    expect(p.allowColumnReorder).toBe(true);
  });

  it("옵션을 안 켠 앱(일루아)은 예전 그대로 잠김", () => {
    const p = resolveGovFieldEditProps({ allowStructureEdit: false, allowPartnerFieldEdit: false }, true);
    expect(p.allowCardEdit).toBeUndefined();
    expect(p.allowColumnEdit).toBeUndefined();
    expect(p.columnScopeMode).toBe("off");
    expect(p.allowRowLayoutEdit).toBe(true);
  });

  it("하이브(파트너 칸 편집 켬 · 관리자)는 칸만 열리고 카드·줄배치는 잠긴다", () => {
    const p = resolveGovFieldEditProps({ allowStructureEdit: false, allowPartnerFieldEdit: true }, true);
    expect(p.allowCardEdit).toBe(false);
    expect(p.allowColumnEdit).toBe(true);
    expect(p.columnScopeMode).toBe("partner-custom");
    expect(p.allowRowLayoutEdit).toBe(false);
    // 사장님 지시는 "입력하고 수정" — 삭제와 순서 드래그는 열지 않는다.
    expect(p.allowColumnDelete).toBe(false);
    expect(p.allowColumnReorder).toBe(false);
  });

  it("하이브 비관리자는 칸 편집이 안 열린다(값 수정과 분리)", () => {
    const p = resolveGovFieldEditProps({ allowStructureEdit: false, allowPartnerFieldEdit: true }, false);
    expect(p.allowColumnEdit).toBe(false);
  });

  it("구조 편집이 켜져 있으면 파트너 옵션은 무시된다(ERP 우선)", () => {
    const p = resolveGovFieldEditProps({ allowStructureEdit: true, allowPartnerFieldEdit: true }, true);
    expect(p.columnScopeMode).toBe("erp");
    expect(p.allowColumnEdit).toBeUndefined();
    expect(p.allowRowLayoutEdit).toBe(true);
  });
});

describe("shouldShowAddContract", () => {
  const base = { rowCount: 0, canEditValues: true, hasCreateContract: true, isFallbackRows: false, rowsLoadFailed: false };
  it("계약이 0건이어도 편집 가능하고 생성기가 있으면 보인다(이번 수정의 핵심)", () => {
    expect(shouldShowAddContract({ ...base, rowCount: 0 })).toBe(true);
  });
  it("★계약이 이미 1건 있으면 감춘다 — 두 번째 계약은 상세창에 자리가 없어 안 보인다", () => {
    expect(shouldShowAddContract({ ...base, rowCount: 1 })).toBe(false);
    expect(shouldShowAddContract({ ...base, rowCount: 3 })).toBe(false);
  });
  it("보기 전용 앱에서는 안 보인다", () => {
    expect(shouldShowAddContract({ ...base, rowCount: 0, canEditValues: false })).toBe(false);
  });
  it("생성 통로가 없는 앱에서는 안 보인다", () => {
    expect(shouldShowAddContract({ ...base, rowCount: 0, hasCreateContract: false })).toBe(false);
  });
  it("★폴백 줄(정부지원금·무상지원금)을 띄운 상태면 감춘다 — 누르면 그 줄과 히스토리가 사라진다", () => {
    expect(shouldShowAddContract({ ...base, rowCount: 0, isFallbackRows: true })).toBe(false);
  });
  it("★분야 행을 못 불러온 상태면 감춘다 — 서버엔 이미 계약이 있을 수 있다", () => {
    expect(shouldShowAddContract({ ...base, rowsLoadFailed: true })).toBe(false);
  });
});
