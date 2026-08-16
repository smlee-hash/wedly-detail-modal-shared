import type { CustomSelectOption } from "./CustomSelect";

// 헤더(isHeader) 제외한 실제 선택 가능 옵션. selected 찾기·빈 목록 판정용.
export function selectableOptions(options: CustomSelectOption[]): CustomSelectOption[] {
  return options.filter((o) => !o.isHeader);
}
