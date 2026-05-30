// 노션 동기화로 들어온 파일 링크(AWS S3 presigned URL) 의 만료 여부 판정.
// presigned URL 은 X-Amz-Date(시작 시각, ISO basic format) + X-Amz-Expires(유효 초) 를 쿼리에 포함.
// 만료 시점 = X-Amz-Date 시각 + X-Amz-Expires 초.
//
// 노션이 발급하는 URL 은 보통 1시간(3600초) 만료. 시간이 지나면 AccessDenied 응답.
// 클릭 직전 만료 여부를 검사해 사용자에게 자동 갱신 또는 안내를 보여주는 데 사용.

/**
 * URL 의 만료 시점(밀리초 epoch) 추정. presigned 가 아니거나 판정 불가하면 null.
 */
export function getPresignedExpiryMs(url: string): number | null {
  try {
    const u = new URL(url);
    const date = u.searchParams.get("X-Amz-Date"); // 예: "20260414T070338Z"
    const expires = u.searchParams.get("X-Amz-Expires"); // 예: "3600"
    if (!date || !expires) return null;
    // ISO basic → ISO extended 변환: 20260414T070338Z → 2026-04-14T07:03:38Z
    const m = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return null;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
    const startMs = Date.parse(iso);
    if (Number.isNaN(startMs)) return null;
    const expSec = parseInt(expires, 10);
    if (!Number.isFinite(expSec) || expSec <= 0) return null;
    return startMs + expSec * 1000;
  } catch {
    return null;
  }
}

/**
 * URL 이 현재 만료됐는지 여부. presigned 가 아니거나 판정 불가하면 false(만료 아님).
 * 약간 여유(60초)를 둬서 정확히 만료 직전인 경우도 만료로 간주 — 네트워크 지연 대비.
 */
export function isPresignedExpired(url: string, nowMs: number = Date.now()): boolean {
  const exp = getPresignedExpiryMs(url);
  if (exp === null) return false;
  return nowMs + 60_000 >= exp;
}
