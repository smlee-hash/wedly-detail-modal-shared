"use client";

// 노션 동기화 파일(임시 보관함 링크) 의 만료에 대응한 안전한 열기 함수. (공용판)
// 흐름:
//   1. 만료 안 됐으면 그대로 새 창으로 열기
//   2. 만료됐으면 행을 다시 받아옴 → 같은 파일의 최신 링크가 있으면 그걸로 열기
//   3. 그래도 만료라면 노션에서 실시간으로 새 링크 받기
//   4. 그래도 안 되면 사용자 안내
//
// 하이브 원본과 동작 동일. 단, 1·2번 회복에 쓰는 "서버 주소 2개"를 앱이 넘겨줄 수 있게
// 입력값(refetchEntryUrl·notionRefreshUrl)으로 빼냈다. 안 넘기면 하이브/ERP 기본 경로를 쓴다
// → 하이브가 아무 주소도 안 넘기고 호출하면 예전과 100% 동일하게 동작.
// 주소 생성기가 빈 값/null 을 돌려주면 그 회복 단계는 건너뛴다(노션이 없는 앱 대응).

import { isPresignedExpired } from "./expired-url";

type RawFile = { fileName?: unknown; name?: unknown; url?: unknown; category?: unknown };

/**
 * URL 에서 호스트·query 제거한 path 부분만 추출 — 같은 파일이면 새 URL 도 같은 path.
 * 예: "https://...amazonaws.com/abc/def/file.pdf?X-Amz-..." → "/abc/def/file.pdf"
 * 옛 URL 과 새 URL 의 path 가 같으면 정확히 같은 파일.
 */
function urlPath(url: string): string {
  try { return new URL(url).pathname; } catch { return ""; }
}

/**
 * 행 안에서 같은 파일 찾기.
 * 1순위: 옛 URL 의 path 와 동일 → 같은 파일 보장 (동명 파일 두 개여도 정확 구분)
 * 2순위: fileName + category 일치 (path 정보 없을 때 fallback)
 */
function pickFileMatch(
  row: Record<string, unknown>,
  fileName: string,
  category?: string,
  oldUrl?: string,
): string | null {
  const oldPath = oldUrl ? urlPath(oldUrl) : "";

  // 후보 수집기
  type Cand = { url: string; fileName: string; category: string };
  const cands: Cand[] = [];
  const filesArr = row._files;
  if (Array.isArray(filesArr)) {
    for (const f of filesArr) {
      if (!f || typeof f !== "object") continue;
      const ff = f as RawFile;
      const u = String(ff.url ?? "");
      if (!u) continue;
      cands.push({
        url: u,
        fileName: String(ff.fileName ?? ff.name ?? ""),
        category: String(ff.category ?? ""),
      });
    }
  }
  if (category) {
    const direct = row[category];
    let arr: unknown[] | null = null;
    if (typeof direct === "string") {
      try { const p = JSON.parse(direct); if (Array.isArray(p)) arr = p; } catch { /* ignore */ }
    } else if (Array.isArray(direct)) {
      arr = direct;
    }
    if (arr) {
      for (const f of arr) {
        if (!f || typeof f !== "object") continue;
        const ff = f as RawFile;
        const u = String(ff.url ?? "");
        if (!u) continue;
        cands.push({
          url: u,
          fileName: String(ff.fileName ?? ff.name ?? ""),
          category: category,
        });
      }
    }
  }

  // 1순위 — path 정확 일치
  if (oldPath) {
    for (const c of cands) {
      if (urlPath(c.url) === oldPath) return c.url;
    }
  }
  // 2순위 — fileName + (선택) category
  for (const c of cands) {
    if (c.fileName === fileName && (!category || c.category === category)) return c.url;
  }
  return null;
}

export async function openFileWithRefresh(opts: {
  url: string;
  entryId: string;
  fileName: string;
  category?: string;
  onWarn?: (message: string) => void;
  /** 만료 시 행 1건을 다시 받아올 주소 생성기. 미지정 시 하이브/ERP 기본 경로.
   *  빈 값/null 을 돌려주면 1차 회복(행 다시 받기)을 건너뛴다. */
  refetchEntryUrl?: (entryId: string) => string | null | undefined;
  /** 노션에서 새 링크를 받을 주소 생성기. 미지정 시 하이브/ERP 기본 경로.
   *  빈 값/null 을 돌려주면 2차 회복(노션 새 링크)을 건너뛴다. */
  notionRefreshUrl?: (entryId: string, fileName: string) => string | null | undefined;
  /** 만료 안내 문구 (앱별 조정용). */
  expiredMessage?: string;
}): Promise<void> {
  const {
    url, entryId, fileName, category, onWarn,
    refetchEntryUrl = (id) => `/api/entries/${encodeURIComponent(id)}`,
    notionRefreshUrl = (id, name) =>
      `/api/files/notion-refresh?entryId=${encodeURIComponent(id)}&fileName=${encodeURIComponent(name)}`,
    expiredMessage = "이 파일 링크가 만료됐어요. 잠시 후 (노션 동기화 다음 주기) 다시 시도해주세요.",
  } = opts;

  // 만료 안 됐으면 즉시 열기 — 가장 흔한 경로. 클릭 컨텍스트 안이라 팝업 차단 없음.
  if (!isPresignedExpired(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  // 만료된 경우 — 비동기 회복 작업이 필요. 비동기 작업(await) 후 window.open 을 호출하면
  // 브라우저가 "사용자 클릭과 무관한 팝업" 으로 보고 차단함. 따라서 클릭 순간 빈 새 창을
  // 먼저 열어두고(사용자 제스처 컨텍스트 유지), 회복 작업 끝나면 그 창의 주소만 바꾼다.
  const win = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  if (win) {
    try { win.opener = null; } catch { /* noopener 효과 — 새 창이 원래 창 접근 못하게 */ }
  }
  const navigate = (target: string): boolean => {
    if (win && !win.closed) { win.location.href = target; return true; }
    // 빈 창을 못 열었으면(팝업 차단) 직접 새 창 시도 — 그래도 막히면 false
    const w2 = window.open(target, "_blank", "noopener,noreferrer");
    return !!w2;
  };
  const giveUp = (msg: string) => {
    if (win && !win.closed) win.close();
    if (onWarn) onWarn(msg);
    else if (typeof console !== "undefined") console.warn("[openFileWithRefresh] " + msg);
  };

  // 1차 회복 — 행 한 개만 새로 받기 (전체 명단 새로고침 부담 피함).
  // ERP 가 그 사이 노션 동기화로 새 링크를 받아뒀다면 여기서 회복됨.
  const entryUrl = refetchEntryUrl(entryId);
  if (entryUrl) {
    try {
      const r = await fetch(entryUrl, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        const row = j?.data && typeof j.data === "object" ? (j.data as Record<string, unknown>) : null;
        if (row) {
          // 옛 URL 의 path 를 같이 넘겨 동명 파일 두 개여도 정확히 같은 파일을 찾음
          const fresh = pickFileMatch(row, fileName, category, url);
          if (fresh && !isPresignedExpired(fresh)) {
            navigate(fresh);
            return;
          }
        }
      }
    } catch { /* 다음 단계로 */ }
  }

  // 2차 회복 — 노션에서 실시간으로 새 링크 받기.
  // DB 가 한참 갱신 안 됐어도 노션 통합 토큰이 있으면 즉시 새 링크 발급받아 회복.
  // 통로가 새 주소를 JSON 으로 알려주면 미리 열어둔 창을 그 주소로 이동 (노션 1회 호출).
  const notionApi = notionRefreshUrl(entryId, fileName);
  if (notionApi) {
    try {
      const r = await fetch(notionApi, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && typeof j.url === "string" && j.url) {
          navigate(j.url);
          return;
        }
      }
    } catch { /* 노션 통로 실패 — 아래 안내로 */ }
  }

  giveUp(expiredMessage);
}
