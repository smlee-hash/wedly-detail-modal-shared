// NO.771 요청 3 §3 — 차수 카드 칸 이름 끝의 「(VAT 제외)」를 이름에서 떼어 작은 회색 「VAT 제외」로 보이게 하는 판정.
// 화면 표시용일 뿐이라 저장된 칸 이름은 건드리지 않는다. ERP(settlement-mgmt/vat-label.ts)와 같은 규칙이다.
// 끝(뒤 공백 허용)의 「(VAT 제외)」·「(VAT제외)」만 뗀다. 「(VAT 포함)」·가운데 글자·표시 없는 이름은 그대로다.

const VAT_EXCLUDED_SUFFIX = /\s*\(VAT\s*제외\)\s*$/;

export function splitVatLabel(label: string): { name: string; vatExcluded: boolean } {
  if (!VAT_EXCLUDED_SUFFIX.test(label)) return { name: label, vatExcluded: false };
  const name = label.replace(VAT_EXCLUDED_SUFFIX, "");
  return name ? { name, vatExcluded: true } : { name: label, vatExcluded: false }; // 떼면 이름이 비면 그대로 둔다
}
