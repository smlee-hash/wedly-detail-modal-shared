// 칸 종류 바꾸기 모달에서 "확인"을 눌렀을 때 저장할지 판정.
// 수식(formula)·선택(select)은 종류가 같아도 식 내용·보기 목록이 바뀌었을 수 있어 항상 저장한다.

export function typeChangeNeedsSave(prevType: string, newType: string): boolean {
  if (newType === "formula" || newType === "select") return true;
  return prevType !== newType;
}
