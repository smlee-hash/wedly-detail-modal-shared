/**
 * 정부지원금 탭의 하위 탭(히스토리/계약정보/정산정보/환불정보/미팅정보) 고르기 — 순수 판정.
 *
 * 왜 화면 파일 밖으로 뺐나(NO.190): 이 계산이 어긋나 ERP 3분할에서 「정산정보」·「환불정보」·
 * 「미팅정보」를 눌러도 계약 카드만 나오는 상태가 배포본까지 새어 나갔다(사용자 신고로 발견).
 * 화면 안에 인라인으로 두면 시험이 못 붙어 같은 방식으로 조용히 되돌아간다 — 적대적 리뷰 지적.
 */
export type GovSubTab = "history" | "contract" | "settlement" | "refund" | "meetings";

export const GOV_SUB_TABS: { key: GovSubTab; label: string }[] = [
  { key: "history", label: "히스토리" },
  { key: "contract", label: "계약정보" },
  { key: "settlement", label: "정산정보" },
  { key: "refund", label: "환불정보" },
  { key: "meetings", label: "미팅정보" },
];

/** 바깥이 준 탭 키가 이 패널 하위 탭인지. 'files' 같은 바깥 전용 키는 폴백으로 넘긴다.
 *  ★ 목록에서 파생시킨다 — 손으로 다섯 개를 또 적으면 탭이 하나 늘 때 그 탭만 조용히
 *  「눌러도 안 열림」이 된다(NO.190 과 같은 모양이고 타입검사도 못 잡는다). */
export function isGovSubTab(value: string | undefined): value is GovSubTab {
  return GOV_SUB_TABS.some((t) => t.key === value);
}

/**
 * 지금 그릴 하위 탭.
 *
 * 제어 모드는 **콜백이 있고 + 바깥이 탭 줄을 그릴 때(hideSubTabBar)** 만이다.
 * 콜백만으로 판정하면, 자기 탭 줄을 그리는 배치(compact — 하이브·일루아 기본)에서 바깥의
 * 공유 subTab 이 패널 초기값을 이겨 「항목 없어도 히스토리로 먼저 연다」(재작업 2026-07-15)가
 * 되돌아간다(적대적 리뷰 지적). 그 배치에서는 내부 상태가 진실이고, 클릭 때 바깥에 알려 주기만 한다.
 */
export function resolveGovSubTab(opt: {
  subTabProp?: string;
  internal: GovSubTab;
  controlled: boolean;
  hiddenSubTabs?: string[];
  historyOnly?: boolean;
}): GovSubTab {
  const { subTabProp, internal, controlled, hiddenSubTabs, historyOnly } = opt;
  if (historyOnly) return "history";
  const requested: GovSubTab = controlled && isGovSubTab(subTabProp) ? subTabProp : internal;
  if (!hiddenSubTabs?.length) return requested;
  const shown = GOV_SUB_TABS.filter((t) => !hiddenSubTabs.includes(t.key));
  if (shown.some((t) => t.key === requested)) return requested;
  return shown[0]?.key ?? requested;
}
