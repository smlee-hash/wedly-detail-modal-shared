import { describe, expect, it } from "vitest";
import { isGovSubTab, resolveGovSubTab } from "./gov-subtab";

// NO.190 — ERP 통합 DB 관리 상세창 3분할에서 「정산정보」·「환불정보」·「미팅정보」 탭을 눌러도
// 계약 카드만 나오던 결함의 판정 로직. 배포본까지 새어 나가 사용자 신고((주)제러스·올드페리도넛)로
// 발견됐고, 고친 뒤에도 이 계산을 지키는 시험이 없어 조용히 되돌아갈 수 있었다(적대적 리뷰 지적).
//
// 지키는 것 두 가지:
//  ① 3분할(바깥이 탭 줄을 그림 = hideSubTabBar) 에서는 바깥이 고른 탭이 그대로 나온다.
//  ② 자기 탭 줄을 그리는 배치(하이브·일루아 compact)에서는 예전처럼 내부 상태가 진실이다
//     — 특히 「항목 없어도 히스토리로 먼저 연다」(재작업 2026-07-15)가 안 되돌아가게.
describe("resolveGovSubTab", () => {
  const H3 = ["history", "files"]; // 3분할이 넘기는 hiddenSubTabs

  it("① 3분할에서 바깥이 고른 탭이 그대로 나온다 — 이 결함의 본체", () => {
    expect(resolveGovSubTab({ subTabProp: "settlement", internal: "history", controlled: true, hiddenSubTabs: H3 })).toBe("settlement");
    expect(resolveGovSubTab({ subTabProp: "refund", internal: "history", controlled: true, hiddenSubTabs: H3 })).toBe("refund");
    expect(resolveGovSubTab({ subTabProp: "meetings", internal: "history", controlled: true, hiddenSubTabs: H3 })).toBe("meetings");
  });

  it("① 바깥이 아직 아무것도 안 골랐으면(history) 첫 탭 = 계약정보 — 처음 열 때 화면", () => {
    expect(resolveGovSubTab({ subTabProp: "history", internal: "history", controlled: true, hiddenSubTabs: H3 })).toBe("contract");
  });

  it("① 바깥 키가 이 패널 탭이 아니면(files) 폴백 — 빈 화면이 되지 않게", () => {
    expect(resolveGovSubTab({ subTabProp: "files", internal: "history", controlled: true, hiddenSubTabs: H3 })).toBe("contract");
    expect(resolveGovSubTab({ subTabProp: undefined, internal: "settlement", controlled: true, hiddenSubTabs: H3 })).toBe("settlement");
  });

  it("② 제어가 아니면 바깥 값을 무시하고 내부 상태 — 하이브·일루아 불변", () => {
    // 바깥 공유 탭이 'contract' 여도, 자기 탭 줄을 그리는 배치에서는 히스토리로 먼저 열려야 한다.
    expect(resolveGovSubTab({ subTabProp: "contract", internal: "history", controlled: false })).toBe("history");
    expect(resolveGovSubTab({ subTabProp: "settlement", internal: "meetings", controlled: false })).toBe("meetings");
  });

  it("historyOnly 는 무엇이 오든 히스토리(3분할 오른쪽 히스토리 칸)", () => {
    expect(resolveGovSubTab({ subTabProp: "settlement", internal: "contract", controlled: true, hiddenSubTabs: H3, historyOnly: true })).toBe("history");
  });

  it("hiddenSubTabs 가 없으면 폴백을 돌리지 않는다 — 옛 앱 렌더 그대로", () => {
    expect(resolveGovSubTab({ subTabProp: "history", internal: "history", controlled: true })).toBe("history");
  });
});

describe("isGovSubTab", () => {
  it("이 패널 탭만 참 — SUB_TABS 에서 파생되므로 탭이 늘어도 손댈 곳이 없다", () => {
    for (const k of ["history", "contract", "settlement", "refund", "meetings"]) expect(isGovSubTab(k)).toBe(true);
    for (const k of ["files", "docs", "", undefined]) expect(isGovSubTab(k as string | undefined)).toBe(false);
  });
});
