import type { FieldDef } from "@wedly/ui-shared";

// 선택 칸의 보기 목록 끝에 항목을 붙인 새 칸 정의 배열을 만든다(원본 불변).
// 빈 글자·칸 없음·선택이 아님·이미 같은 보기가 있으면 null(변경 없음).
export function appendFieldOption(fields: FieldDef[], fieldKey: string, opt: string): FieldDef[] | null {
  const trimmed = opt.trim();
  if (!trimmed) return null;
  const idx = fields.findIndex((f) => f.key === fieldKey);
  if (idx < 0) return null;
  const field = fields[idx];
  if (field.type !== "select") return null;
  const prev = field.options ?? [];
  if (prev.includes(trimmed)) return null;
  const next = fields.slice();
  next[idx] = { ...field, options: [...prev, trimmed] };
  return next;
}

// 선택 칸의 보기 하나에 색({bg, text})을 붙인 새 칸 정의 배열을 만든다(원본 불변).
// 칸 없음·선택이 아님·options 에 그 보기가 없으면 null(변경 없음).
export function setFieldOptionColorDef(
  fields: FieldDef[],
  fieldKey: string,
  opt: string,
  color: { bg: string; text: string },
): FieldDef[] | null {
  const idx = fields.findIndex((f) => f.key === fieldKey);
  if (idx < 0) return null;
  const field = fields[idx];
  if (field.type !== "select") return null;
  const prev = field.options ?? [];
  if (!prev.includes(opt)) return null;
  const next = fields.slice();
  next[idx] = { ...field, optionColors: { ...(field.optionColors ?? {}), [opt]: color } };
  return next;
}
