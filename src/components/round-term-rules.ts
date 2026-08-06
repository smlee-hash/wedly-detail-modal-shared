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
// resultFormat = 이 수식이 무엇으로 나오는지("percent" | 그 외). 퍼센트로 나오는 수식은
//   자연값이 비율이라(30% → 0.3) 1,000원 단위로 반올림하면 통째로 0 이 된다. 추가 버튼은
//   숨겨 두지만, 원 단위로 만들어 둔 수식의 결과 형식을 나중에 퍼센트로 바꾸면 반올림 항이
//   그대로 남아 값이 조용히 0% 가 된다 — 그 길을 저장 단계에서 막는다.
export function roundTermIssue(terms: FormulaTerm[] | undefined, resultFormat?: string): string | null {
  if (!Array.isArray(terms)) return null;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (!t) continue;
    if (t.unit === "group") {
      const inner = roundTermIssue(t.terms, resultFormat);
      if (inner) return `묶음(괄호) 안: ${inner}`;
      continue;
    }
    if (t.op !== "round") continue;
    if (resultFormat === "percent") {
      return "결과가 퍼센트(%)로 나오는 수식에는 반올림을 쓸 수 없습니다. 비율이 통째로 0 이 됩니다.";
    }
    // 맨 위 항목은 반올림할 앞선 값이 없어 엔진이 그냥 지나친다.
    // 항목 추가는 늘 맨 아래에 붙으므로 "위에 항목을 두라"고 하면 할 수 없는 일을 시키는 셈이다.
    if (i === 0) return "맨 위 항목은 반올림이 될 수 없습니다. 이 항목을 지우고, 계산할 항목을 먼저 넣은 뒤 반올림을 다시 추가하세요.";
    if (typeof t.value !== "number" || !Number.isFinite(t.value) || t.value < 1 || !Number.isInteger(t.value)) {
      return "반올림 단위는 1 이상의 정수(원)여야 합니다. 예: 1000";
    }
  }
  return null;
}
