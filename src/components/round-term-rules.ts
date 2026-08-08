import { isStepOp } from "@wedly/ui-shared";
import type { FieldDef, FormulaTerm } from "@wedly/ui-shared";

// 이 파일은 "반올림·내림 항이 실제로 계산되는 자리에 있는지"를 판정하는 순수 함수 모음이다.
// 엔진은 잘못 놓인 반올림을 조용히 무시하거나 값을 0 으로 만들어 버리므로, 저장 전에
// 사람에게 말해 주지 않으면 "반올림을 걸어 놨는데 금액이 이상하다"를 아무도 못 잡는다.
//
// SettlementInfoTab.tsx(화면 부품 파일)에서 분리한 이유: 그 파일을 시험에서 불러오면
// 시험 도구가 화면 문법을 못 읽어 실패한다. 로직 자체는 화면과 무관한 순수 계산이다.

// 항 하나를 고칠 때의 규칙(순수 함수 — 시험 대상).
//
// **반올림 항은 '반올림 단위'만 고칠 수 있다.** 연산·단위·참조 칸을 바꾸는 길을 열어 두면
// 아래 "숫자로 바꾸면 참조 칸을 지운다" 규칙에 걸려 그 항의 금액이 통째로 사라진다
// (실제로 300만원이 0원이 되던 길이었다). 화면에서 그런 조작을 안 그리지만,
// 나중에 누가 다시 그려도 여기서 막힌다.
//
// firstNumericKey = '다른 칸'으로 바꿨는데 고른 칸이 없을 때 기본으로 넣을 칸.
export function applyTermPatch(
  t: FormulaTerm,
  patch: Partial<FormulaTerm>,
  firstNumericKey?: string,
): FormulaTerm {
  if (isStepOp(t.op)) {
    return typeof patch.value === "number"
      ? { ...t, op: t.op, unit: "number", value: patch.value }
      : t;
  }
  const merged: FormulaTerm = { ...t, ...patch };
  if (patch.unit === "column" && !merged.columnKey) merged.columnKey = firstNumericKey;
  if (patch.unit === "number" || patch.unit === "percent") {
    delete merged.columnKey;
    if (typeof merged.value !== "number") merged.value = 0;
  }
  return merged;
}

// 항의 '단위 성격'. 엔진은 퍼센트를 0~1 비율로 바꿔 계산하므로,
// 어느 지점의 누적값이 '금액(원)'인지 '비율'인지가 갈린다.
type Kind = "money" | "ratio";

function termKind(t: FormulaTerm, fields: FieldDef[]): Kind {
  if (!t) return "money";
  if (t.unit === "percent") return "ratio";
  if (t.unit === "group") return chainKind(t.terms ?? [], fields);
  if (t.unit === "column") {
    const ref = fields.find((f) => f.key === t.columnKey);
    if (!ref) return "money"; // 모르는 칸은 금액으로 본다(공연히 막지 않는다)
    if (ref.type === "percent") return "ratio";
    if (ref.type === "formula" && ref.formulaResult === "percent") return "ratio";
    return "money";
  }
  return "money"; // unit === "number"
}

// 항 사슬을 왼쪽부터 훑어 누적값의 성격을 따진다(엔진과 같은 순서, 연산 우선순위 없음).
//   더하기·빼기·곱하기: 한쪽이라도 금액이면 금액
//   나누기: 왼쪽 성격을 유지한다(금액 ÷ 1.1 은 여전히 금액)
//   반올림: 성격을 바꾸지 않는다
export function chainKind(terms: FormulaTerm[] | undefined, fields: FieldDef[]): Kind {
  if (!Array.isArray(terms)) return "money";
  let cur: Kind = "money";
  let started = false;
  for (const t of terms) {
    if (!t) continue;
    if (isStepOp(t.op)) continue;
    const k = termKind(t, fields);
    if (!started) { cur = k; started = true; continue; }
    if (t.op === "/") continue;
    cur = cur === "money" || k === "money" ? "money" : "ratio";
  }
  return cur;
}

// resultFormat = 이 수식이 무엇으로 나오는지("percent" | 그 외). 퍼센트로 나오는 수식은
//   자연값이 비율이라(30% → 0.3) 1,000원 단위로 반올림하면 통째로 0 이 된다. 추가 버튼은
//   숨겨 두지만, 원 단위로 만들어 둔 수식의 결과 형식을 나중에 퍼센트로 바꾸면 반올림 항이
//   그대로 남아 값이 조용히 0% 가 된다 — 그 길을 저장 단계에서 막는다.
// fields = 칸 목록. '다른 칸' 항이 퍼센트 칸인지 알아야 비율 여부를 판정할 수 있다.
export function roundTermIssue(
  terms: FormulaTerm[] | undefined,
  fields: FieldDef[] = [],
  resultFormat?: string,
): string | null {
  if (!Array.isArray(terms)) return null;
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (!t) continue;
    if (t.unit === "group") {
      const inner = roundTermIssue(t.terms, fields, resultFormat);
      if (inner) return `묶음(괄호) 안: ${inner}`;
      continue;
    }
    if (!isStepOp(t.op)) continue;
    const 이름 = t.op === "floor" ? "내림" : "반올림";
    if (resultFormat === "percent") {
      return `결과가 퍼센트(%)로 나오는 수식에는 ${이름}을 쓸 수 없습니다. 비율이 통째로 0 이 됩니다.`;
    }
    // 맨 위 항목은 반올림할 앞선 값이 없어 엔진이 그냥 지나친다.
    // 항목 추가는 늘 맨 아래에 붙으므로 "위에 항목을 두라"고 하면 할 수 없는 일을 시키는 셈이다.
    if (i === 0) return `맨 위 항목은 ${이름}이 될 수 없습니다. 이 항목을 지우고, 계산할 항목을 먼저 넣은 뒤 ${이름}을 다시 추가하세요.`;
    if (typeof t.value !== "number" || !Number.isFinite(t.value) || t.value < 1 || !Number.isInteger(t.value)) {
      return `${이름} 단위는 1 이상의 정수(원)여야 합니다. 예: ${t.op === "floor" ? "10000" : "1000"}`;
    }
    // 반올림은 '원 단위'를 전제한다. 반올림 직전 누적값이 비율(퍼센트)이면
    // 1,000원 단위로 반올림하는 순간 0 이 되고, 그 뒤 곱셈까지 전부 0 이 된다.
    // 화면은 멀쩡해 보이는데 금액만 0원이 되므로 반드시 저장 단계에서 막는다.
    if (chainKind(terms.slice(0, i), fields) === "ratio") {
      return `${이름} 앞의 값이 금액(원)이 아니라 비율(%)입니다. 원 단위로 ${이름}하면 0 이 됩니다. 금액 칸을 먼저 놓고 비율을 곱한 뒤에 ${이름}하세요.`;
    }
  }
  return null;
}
