// NO.125 반려 재작업(2026-07-23): 차수 카드 수식 평가 문맥을 "ERP 통합협업 전체 탭"과 동일하게 만든다.
// 전체 탭 문맥 = 경정청구 행(공통 칸 후보 채움) 위에 정책 행을 얹은 것. 다른 화면(ERP 일루아 탭·
// 일루아 앱·하이브)은 정책 행만으로 평가해 조건 기준 칸(27주소지·DB분류·영업담당)이 비어
// 조건부 수수료가 늘 기본식으로 떨어졌다(대웅글로벌: 전체 탭 220,000 vs 다른 화면 330,000).
// rows 에는 고객 통합보기 규약상 경정청구(tax-amendment) 행이 이미 함께 오므로, 그 행을 바탕에
// 깔고 공통 칸 후보 키(52사업장주소지↔27주소지 등)의 빈 짝을 서로 채운다. 표시용이 아니라
// 수식 평가(conditionValues) 전용 — 저장 데이터는 바꾸지 않는다.
// 스펙(COMMON_BASIC_FIELD_SPECS)은 호출부(GovSubsidyPanel)가 @wedly/ui-shared 에서 받아 주입한다 —
// dms 단독 시험이 ui-shared 설치 없이 돌게 하기 위한 분리.

type Row = Record<string, unknown>;

export type CommonFieldSpecLike = { keys: readonly string[] };

function isEmptyVal(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

// ERP fill-common-keys.ts 와 같은 규칙(값 있는 키 보호·빈 짝 모두 채움) — 단, 카드 문맥은 표가
// 아니므로 columnKeySet 게이트 없이 전 스펙을 채운다(전체 탭 표의 게이트는 표 표시용 최적화일 뿐).
export function fillCommonSpecSiblings(row: Row, specs: readonly CommonFieldSpecLike[]): Row {
  let out: Row | null = null;
  for (const spec of specs) {
    const src = out ?? row;
    let val: unknown;
    for (const k of spec.keys) {
      if (!isEmptyVal(src[k])) { val = src[k]; break; }
    }
    if (isEmptyVal(val)) continue;
    for (const k of spec.keys) {
      if (isEmptyVal((out ?? row)[k])) {
        if (!out) out = { ...row };
        out[k] = val;
      }
    }
  }
  return out ?? row;
}

// 카드 평가의 바탕 행: 같은 회사 경정청구 행 위에 primaryRow(화면별 대표 행)를 얹고 공통 칸을 채운다.
// - 전체 탭: primaryRow가 이미 (공통 칸 채워진) 경정청구 행이라 결과 불변(회귀 없음).
// - ERP 일루아 탭·일루아 앱: primaryRow=정책 계열 행 → 경정청구 행의 DB분류·영업담당·52주소지가 바탕에 깔림.
// - 하이브: primaryRow가 경정청구 계열 행이라 후보 채움(52→27)만 추가로 적용된다.
export function buildGovEvalBase(
  rows: ReadonlyArray<{ domain?: string; row?: unknown }>,
  primaryRow: Row,
  specs: readonly CommonFieldSpecLike[],
): Row {
  const tax = rows.find((r) => r?.domain === "tax-amendment");
  const taxRow = (tax && typeof tax.row === "object" && tax.row !== null ? tax.row : {}) as Row;
  return fillCommonSpecSiblings({ ...taxRow, ...primaryRow }, specs);
}
