// 끌고 있는 데이터가 "파일"인지 판별한다.
// 화면 안의 글자·요소를 끄는(드래그) 경우엔 반응하지 않도록, DataTransfer.types 에
// "Files" 가 들어있을 때만 true. string[] / readonly string[] / DOMStringList 모두 받는다.
export function isFileDrag(types: ArrayLike<string> | null | undefined): boolean {
  if (!types || types.length === 0) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === "Files") return true;
  }
  return false;
}
