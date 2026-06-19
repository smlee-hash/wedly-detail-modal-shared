// 파일 용량 표기·검사 순수 함수 — 화면 부품(FilesTab)에서 사용. 앱 의존 없음(공용 부품 규칙).

/** 기본 업로드 한도 100MB — 3앱 서버 /api/upload 의 MAX_SIZE 와 일치. */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** 바이트 → 사람이 읽는 용량. 정수면 소수점 생략. 예: 1536→"1.5KB", 1048576→"1MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : kb.toFixed(1)}KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

/** 파일 묶음을 한도로 분리. 정확히 한도=통과, 한도 초과=제외. */
export function partitionFilesBySize<T extends { name: string; size: number }>(
  files: T[],
  maxBytes: number,
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const f of files) {
    if (f.size > maxBytes) rejected.push(f);
    else accepted.push(f);
  }
  return { accepted, rejected };
}

/** 초과 파일 안내 문구. 예: "'big.pdf'(120.5MB)은(는) 최대 100MB를 초과하여 업로드할 수 없습니다." */
export function oversizeMessage(
  rejected: Array<{ name: string; size: number }>,
  maxBytes: number,
): string {
  if (rejected.length === 0) return "";
  const first = rejected[0];
  const head = `'${first.name}'(${formatFileSize(first.size)})`;
  const subject = rejected.length > 1 ? `${head} 외 ${rejected.length - 1}개는` : `${head}은(는)`;
  return `${subject} 최대 ${formatFileSize(maxBytes)}를 초과하여 업로드할 수 없습니다.`;
}

/** 파일 한 건을 용량 조회·색인에 쓸 키 — url 우선, 없으면 objectKey, 둘 다 없으면 "". */
export function fileSizeKey(f: { url?: string; objectKey?: string }): string {
  if (typeof f.url === "string" && f.url) return f.url;
  if (typeof f.objectKey === "string" && f.objectKey) return f.objectKey;
  return "";
}

/**
 * 용량(byte)이 아직 기록되지 않은 파일만(키가 있는 것만) 골라낸다 — 옛 파일 용량 보강 대상.
 * size가 0인 빈 파일은 "기록값 있음"으로 보고 제외(저장소 재조회 불필요).
 */
export function filesMissingSize<T extends { url?: string; objectKey?: string; size?: number }>(
  files: T[],
): T[] {
  return files.filter((f) => typeof f.size !== "number" && fileSizeKey(f) !== "");
}
