// 상세 모달 공용 타입 — DetailModalShell 과 FieldEditors 가 함께 쓰는 타입을 한 곳에 모음.
// (순환 의존 방지 — 두 파일이 서로를 import 하지 않고 이 중립 파일에서 가져옴)

/** 한 업체(행) 데이터 — 컬럼 키 → 값. */
export type RowData = Record<string, string | number | boolean | null>;

/** 첨부 파일 한 개의 메타 정보. */
export interface FileMeta {
  id?: number | string;
  fileName?: string;
  objectKey?: string;
  contentType?: string;
  // ERP에서 업로드한 파일은 url 필드로 직접 링크 (proxy 미사용)
  url?: string;
  category?: string;
}

/** 상세 모달의 한 필드(컬럼) 정의. */
export interface DetailField {
  key: string;
  label: string;
  type: string;
  format?: string;
}
