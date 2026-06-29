// 차수 칸 목록 두 개가 "표시상 동일"한지 비교 — 자동 갱신 시 변화 없으면 재렌더 생략용.
// 비교 기준: 개수·순서 + 각 칸의 모든 직렬화 가능한 속성(key/label/type/options/scope/formula 등).
export function tierFieldsEqual(
  a: ReadonlyArray<Record<string, unknown>>,
  b: ReadonlyArray<Record<string, unknown>>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // 순서 포함 1:1 비교. 객체 전체를 안정 직렬화(키 정렬)해 비교.
    if (stableStringify(a[i]) !== stableStringify(b[i])) return false;
  }
  return true;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
