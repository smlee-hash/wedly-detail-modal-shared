// 사람 항목 식별자 유틸 — 서버·클라이언트 양쪽에서 사용.
// prisma 의존 없이 순수 함수만. load-entries.ts 가 이 모듈을 import 하고,
// 클라이언트 화면도 표시 정규화를 위해 import 한다.
//
// 식별자 형식 (모두 인식, 새 저장은 파이프 형식):
//   "이정민"                        — 옛 형식(이름만). 옛 데이터 또는 동명이인 없는 사용자.
//   "이정민 <asdd81@naver.com>"     — 옛 새 형식(꺽쇠). 동명이인 구분이 필요한 경우.
//   "이정민 | asdd81@naver.com"     — 새 표준 형식(파이프). 사용자 가독성을 위해.

/**
 * 풀 형식 파싱 — 꺽쇠/파이프/이름만 모두 인식.
 * "이정민 | asdd81@naver.com" / "이정민 <asdd81@naver.com>" / "이정민" 모두 지원.
 *
 * 이름 부분은 파이프(|) 와 꺽쇠(<,>) 모두 제외 → 이름에 그 글자가 들어간 비정상
 * 입력도 첫 구분자에서 깨끗하게 분리.
 */
export function parsePersonItem(s: string): { name: string; email: string } {
  const t = (s || "").trim();
  // 파이프 구분 "이름 | 이메일" — 이름엔 | 없음, 이메일은 @ 포함
  const mPipe = t.match(/^([^|<>]+?)\s*\|\s*([^\s|]+@[^\s|]+)\s*$/);
  if (mPipe) return { name: mPipe[1].trim(), email: mPipe[2].trim() };
  // 꺽쇠 구분 "이름 <이메일>" — 이름엔 <> 없음, 옛 호환
  const mBracket = t.match(/^([^<>|]+?)\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  if (mBracket) return { name: mBracket[1].trim(), email: mBracket[2].trim() };
  return { name: t, email: "" };
}

/** 표시용 — 풀 형식이어도 이름만 추출 */
export function personDisplayName(s: string): string {
  return parsePersonItem(s).name;
}

/** 풀 형식 만들기 — 이메일이 있으면 "이름 | 이메일", 없으면 이름만 */
export function formatPersonItem(name: string, email: string): string {
  const n = (name || "").trim();
  const e = (email || "").trim();
  return e ? `${n} | ${e}` : n;
}

/**
 * 콤마 구분 문자열을 항목 배열로 분리 — 꺽쇠 안의 콤마는 보호.
 * "이정민 <asdd81@naver.com>, 김혜나" → ["이정민 <asdd81@naver.com>", "김혜나"]
 * 파이프 형식 "이정민 | asdd81@naver.com" 도 콤마로 안 깨짐 (이메일에 콤마 없음).
 */
export function splitPersonListSafe(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "<") depth++;
    else if (ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
