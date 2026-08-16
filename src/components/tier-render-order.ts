// 차수 카드 표시 순서: 최신(배열 뒤)이 맨 위. 번호 라벨은 원래 배열 위치(idx)로 유지 → 1차=가장 오래된 계약.
// 표시만 뒤집고 idx(번호)는 원래대로 전달하므로 배열 자체(번호 기준)는 안 건드린다.
export function displayOrderNewestFirst<T>(tiers: ReadonlyArray<T>): Array<{ tier: T; idx: number }> {
  return tiers.map((tier, idx) => ({ tier, idx })).reverse();
}
