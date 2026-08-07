// 차수 카드에서 "칸 하나만" 못 고치게 하는 판정 — 칸 정의가 실어 보낸 표시를 읽는다.
// ─────────────────────────────────────────────────────────────────────────────
// 지금 차수 카드의 잠금 수단은 (가) 탭 전체 잠금(readOnly prop) (나) 자동계산 칸(키가 코드에 박힘)
// (다) 계산식 칸(type:"formula") 뿐이라, "이 칸만" 잠글 방법이 없었다.
// 칸 정의는 서버가 JSON 으로 내려보내므로 앱마다 다른 칸을 잠글 수 있다(앱별 정책).
//   - readOnly: true      → 이 칸은 이 앱에서 못 고친다
//   - readOnlyNote: 문구  → 칸 이름 옆에 (문구) 로 붙는다. 글자는 앱이 정한다(여기 박지 않는다).
// 표시가 없으면 { locked: false } 라 기존 동작이 한 톨도 달라지지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

export type TierFieldLock = { locked: boolean; note?: string };

export function tierFieldLock(field: unknown): TierFieldLock {
  if (!field || typeof field !== "object") return { locked: false };
  const f = field as Record<string, unknown>;
  // 정확히 true 일 때만 잠근다 — "true" 문자열·1 같은 값으로 실수로 잠기지 않게.
  if (f.readOnly !== true) return { locked: false };
  const raw = typeof f.readOnlyNote === "string" ? f.readOnlyNote.trim() : "";
  return { locked: true, note: raw === "" ? undefined : raw };
}

/**
 * 칸 정의를 **처음부터 다시 만드는** 편집(타입 변경 등)에서 잠금 표시를 잃지 않게 옮긴다.
 * 타입 변경은 key·label·type·options·scope 만 새 객체로 옮기므로, 이걸 안 거치면
 * 잠긴 칸이 그 화면에서 다시 열려 "고를 수는 있는데 저장은 안 되는" 상태로 되돌아간다.
 * 잠기지 않은 칸에는 아무것도 붙이지 않는다(기존 동작 그대로).
 */
export function carryFieldLock<T extends object>(from: unknown, to: T): T {
  const lock = tierFieldLock(from);
  if (!lock.locked) return to;
  const out = to as Record<string, unknown>;
  out.readOnly = true;
  if (lock.note !== undefined) out.readOnlyNote = lock.note;
  return to;
}
