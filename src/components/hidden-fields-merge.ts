import type { FieldDef } from "@wedly/ui-shared";

export type HiddenFieldSlot = { field: FieldDef; index: number };

export function splitHiddenFields(
  all: FieldDef[],
  isHidden: (f: FieldDef) => boolean,
): { visible: FieldDef[]; hidden: HiddenFieldSlot[] } {
  const visible: FieldDef[] = [];
  const hidden: HiddenFieldSlot[] = [];
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    if (isHidden(f)) hidden.push({ field: f, index: i });
    else visible.push(f);
  }
  return { visible, hidden };
}

export function mergeHiddenFields(
  visible: FieldDef[],
  hidden: HiddenFieldSlot[],
): FieldDef[] {
  if (hidden.length === 0) return visible;
  const result = visible.slice();
  const ordered = hidden.slice().sort((a, b) => a.index - b.index);
  for (const { field, index } of ordered) {
    const at = index > result.length ? result.length : index;
    result.splice(at, 0, field);
  }
  return result;
}
