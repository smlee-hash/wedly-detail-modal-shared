// 사람 항목 식별자 유틸 — 공용(@wedly/detail-modal-shared). 서버·클라이언트 양쪽에서 사용.
// prisma 등 외부 의존 없는 순수 함수만. 각 앱(하이브·ERP·일루아)이 사람 선택 칸에서 공용으로 쓴다.
//
// 식별자 형식 (모두 인식, 새 저장은 파이프 형식):
//   "이정민"                        — 옛 형식(이름만). 옛 데이터 또는 동명이인 없는 사용자.
//   "이정민 <asdd81@naver.com>"     — 꺽쇠 형식. 동명이인 구분이 필요한 경우.
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
 * 표시용 통일 — 한 사람 항목을 "이름 | 이메일" 형식으로 맞춘다.
 * 값에 이메일이 없으면(옛 "이름만" 데이터) 명단(directory: "이름 | 이메일" 목록)에서
 * 같은 이름을 찾아 이메일을 보완한다. 끝내 못 찾으면 이름만 반환(없는 이메일을 지어내지 않음).
 */
export function unifyPersonDisplay(item: string, directory: string[] = []): string {
  const { name, email } = parsePersonItem(item);
  if (email) return `${name} | ${email}`;
  // 옛 "이름만" 값 — 명단에서 같은 이름의 첫 매칭 이메일을 붙인다(진짜 동명이인이면 첫 사람 기준).
  for (const d of directory) {
    const p = parsePersonItem(d);
    if (p.name === name && p.email) return `${p.name} | ${p.email}`;
  }
  return name;
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
