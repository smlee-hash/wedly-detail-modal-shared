import type { FormulaTerm } from "@wedly/ui-shared";

// 반올림 항이 계산되지 않는 자리에 있는지 검사한다(순수 함수 — 시험 대상).
// 엔진은 이런 항을 조용히 무시하므로, 저장 전에 사람에게 말해 주지 않으면
// "반올림을 걸어 놨는데 금액이 그대로"인 상태를 아무도 못 잡는다.
// 묶음(괄호) 안쪽도 같은 규칙이라 재귀로 본다.
//
// SettlementInfoTab.tsx(React 컴포넌트 파일)에서 분리한 이유: 그 파일을 vitest .test.ts 에서
// import 하면 vite 의 import-analysis 플러그인이 JSX 파싱에 실패한다(.ts 시험 파일이 .tsx 를
// import 할 때 발생하는 esbuild/vite 로더 문제). 로직 자체는 화면과 무관한 순수 함수라 별도
// 파일로 두면 시험이 화면 렌더링을 전혀 거치지 않고 돈다.
export function roundTermIssue(terms: FormulaTerm[] | undefined): string | null {
  if (!Array.isArray(terms)) return null;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (!t) continue;
    if (t.unit === "group") {
      const inner = roundTermIssue(t.terms);
      if (inner) return `묶음(괄호) 안: ${inner}`;
      continue;
    }
    if (t.op !== "round") continue;
    if (i === 0) return "맨 위 항목은 반올림이 될 수 없습니다. 반올림 위에 계산할 항목을 두세요.";
    if (typeof t.value !== "number" || !Number.isFinite(t.value) || t.value < 1 || !Number.isInteger(t.value)) {
      return "반올림 단위는 1 이상의 정수(원)여야 합니다. 예: 1000";
    }
  }
  return null;
}
