// 정부지원금 섹션 패널의 "칸 편집" 게이트 — 앱 설정(config)과 실제 관리자 여부를
// SettlementInfoTab 이 아는 prop 으로 옮긴다. 화면 코드에서 조건식을 흩뿌리지 않기 위해 분리했고,
// 진리표 시험(gov-field-edit-gate.test.ts)이 이 표를 지킨다.
//
// 세 갈래:
//   ERP        : allowStructureEdit=true  → 지금까지와 100% 동일(칸·카드·줄배치 전부 ERP 권한)
//   일루아      : 둘 다 false            → 지금까지와 100% 동일(칸 편집 잠김)
//   하이브      : allowPartnerFieldEdit=true → 자기 앱 전용 커스텀 칸만 편집(공통 칸은 못 건드림).
//                카드(합계)·줄배치는 3앱 공용 설정이라 하이브에서는 잠근다.

export type GovFieldEditConfig = {
  allowStructureEdit: boolean;
  allowPartnerFieldEdit?: boolean;
};

export type GovFieldEditProps = {
  /** 스코어카드(합계) 편집. undefined = 부품 기본(allowStructureEdit 폴백) */
  allowCardEdit: boolean | undefined;
  /** 칸 목록 편집. undefined = 부품 기본(allowStructureEdit 폴백) */
  allowColumnEdit: boolean | undefined;
  columnScopeMode: "off" | "erp" | "partner-custom";
  /** 「줄별 칸 수」 편집 허용 */
  allowRowLayoutEdit: boolean;
  /** 칸 삭제 허용 — 파트너 앱은 「입력·수정」까지만 연다(사장님 지시 2026-08-27) */
  allowColumnDelete: boolean;
  /** 칸 순서 드래그 허용 — 파트너 앱은 저장이 안 되는 거짓 동작이라 잠근다 */
  allowColumnReorder: boolean;
};

export function resolveGovFieldEditProps(
  config: GovFieldEditConfig,
  isAdmin: boolean,
): GovFieldEditProps {
  // ERP(구조 편집)가 켜져 있으면 파트너 모드는 아예 보지 않는다 — 기존 동작 보존이 최우선.
  const partnerMode = config.allowStructureEdit !== true && config.allowPartnerFieldEdit === true;
  if (!partnerMode) {
    return {
      allowCardEdit: undefined,
      allowColumnEdit: undefined,
      columnScopeMode: config.allowStructureEdit ? "erp" : "off",
      allowRowLayoutEdit: true,
      allowColumnDelete: true,
      allowColumnReorder: true,
    };
  }
  return {
    allowCardEdit: false,
    allowColumnEdit: isAdmin,
    columnScopeMode: "partner-custom",
    allowRowLayoutEdit: false,
    allowColumnDelete: false,
    allowColumnReorder: false,
  };
}
