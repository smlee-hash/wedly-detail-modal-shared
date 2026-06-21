import type { CustomSelectOption } from "./CustomSelect";

type FieldLite = { key: string; label: string };

// 조건 "기준 칸" 목록을 [정산 정보 그룹 + 기본정보 그룹]으로(CustomSelect isHeader 헤더 포함).
//   settle = 이 차수카드의 칸(편집 중 칸 제외), basic = ERP 주입 기본정보 칸.
export function buildCondTargets(
  fields: FieldLite[],
  editingFieldKey: string | null,
  conditionFieldOptions: Array<{ key: string; label: string }> | undefined,
): CustomSelectOption[] {
  const settle = fields.filter((f) => f.key !== editingFieldKey).map((f) => ({ value: f.key, label: f.label }));
  const basic = (conditionFieldOptions ?? []).map((o) => ({ value: o.key, label: o.label }));
  const out: CustomSelectOption[] = [];
  if (settle.length) out.push({ value: "__hdr_settle", label: "정산 정보", isHeader: true }, ...settle);
  if (basic.length) out.push({ value: "__hdr_basic", label: "기본정보", isHeader: true }, ...basic);
  return out;
}
