// 차수 카드에서 "칸만 화면에서 감추기" — 칸 정의가 실어 보낸 표시를 읽는다.
// ─────────────────────────────────────────────────────────────────────────────
// 칸 정의에서 칸을 빼면 안 된다. parseTiers 가 정의에 있는 키만 옮겨 담아서,
// 정의에서 빼면 다음 저장 때 저장값이 통째로 사라지고 수식도 0 으로 틀어진다.
// 그래서 정의는 그대로 두고, 그릴 때만 걸러낸다.
//   - hidden: true  → 이 칸은 이 앱의 차수 카드에서 그리지 않는다
// 표시가 없으면 false 라 기존 동작이 한 톨도 달라지지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

export function tierFieldHidden(field: unknown): boolean {
  if (!field || typeof field !== "object") return false;
  // 정확히 true 일 때만 감춘다 — "true" 문자열·1 같은 값으로 실수로 감추지 않게.
  return (field as Record<string, unknown>).hidden === true;
}

/**
 * 칸 정의를 **처음부터 다시 만드는** 편집(타입 변경 등)에서 숨김 표시를 잃지 않게 옮긴다.
 * 타입 변경은 key·label·type·options·scope 만 새 객체로 옮기므로, 이걸 안 거치면
 * 숨긴 칸이 그 화면에서 다시 나타난다.
 * 숨기지 않은 칸에는 아무것도 붙이지 않는다(기존 동작 그대로).
 */
export function carryFieldHidden<T extends object>(from: unknown, to: T): T {
  if (!tierFieldHidden(from)) return to;
  (to as Record<string, unknown>).hidden = true;
  return to;
}

/**
 * 저장된 rowLayout 은 건드리지 않고, 화면에 그릴 목록과 배치를 새로 계산한다.
 * 줄 묶음을 유지한 채 그 줄의 칸 수만 줄인다 — 3칸씩 다시 채우지 않는다.
 * (그래야 「국세환급액 / 수수료율 / 수수료」 같은 뜻 묶음이 줄을 넘어 흩어지지 않는다.)
 */
export function visibleTierLayout<T>(
  fields: T[],
  rowLayout: number[],
  isHidden: (f: T) => boolean,
): { fields: T[]; rowLayout: number[] } {
  const shown: T[] = [];
  const layout: number[] = [];
  let i = 0;
  for (const raw of rowLayout) {
    if (i >= fields.length) break;
    const cols = raw === 3 ? 3 : raw === 2 ? 2 : 1;
    const row = fields.slice(i, i + cols);
    i += cols;
    const remaining = row.filter((f) => !isHidden(f));
    if (remaining.length === 0) continue;
    shown.push(...remaining);
    layout.push(remaining.length);
  }
  while (i < fields.length) {
    const f = fields[i];
    i += 1;
    if (isHidden(f)) continue;
    shown.push(f);
    layout.push(1);
  }
  return { fields: shown, rowLayout: layout };
}
