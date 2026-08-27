import { describe, it, expect, vi } from "vitest";

// 이 작업 사본에는 앱이 공급하는 짝(clsx·tailwind-merge)이 없다 — 시험에서만 가짜로 채운다.
vi.mock("clsx", () => ({ clsx: (...a: unknown[]) => a.filter(Boolean).join(" "), default: (...a: unknown[]) => a.filter(Boolean).join(" ") }));
vi.mock("tailwind-merge", () => ({ twMerge: (...a: unknown[]) => a.filter(Boolean).join(" ") }));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import SettlementInfoTab from "./SettlementInfoTab";

// ⚠️ 왜 「그려서 재는」 시험만으로는 이 문지기를 못 재는가 (2026-08-27 실측)
//   「줄별 칸 수」 블록은 편집 패널을 **연 뒤에만**(editFields 상태가 켜진 뒤에만) 그려진다.
//   서버 정적 렌더(renderToStaticMarkup)는 그 상태를 켤 방법이 없어, 문지기를 통째로 없애도
//   마크업엔 어차피 그 글자가 없다 → 시험이 늘 통과하는 껍데기가 된다(실제로 확인함).
//   그래서 여기서는 ① 부품이 새 prop 을 받아도 안 깨지는지는 렌더로, ② 문지기가 실제로
//   그 블록을 감싸고 있는지는 **소스 구조**로 잰다. 화면에서의 최종 확인은 배포본 브라우저 QA 가 맡는다.

const SRC = readFileSync(join(__dirname, "SettlementInfoTab.tsx"), "utf8");

describe("allowRowLayoutEdit — 소스 구조", () => {
  it("「줄별 칸 수」 블록이 allowRowLayoutEdit 문지기 안에 있다", () => {
    const guardIdx = SRC.indexOf("{allowRowLayoutEdit && (");
    const blockIdx = SRC.indexOf("줄별 칸 수 — 줄마다 가로 칸 수");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(blockIdx).toBeGreaterThan(-1);
    // 문지기가 블록보다 앞에 있고, 사이에 다른 문지기가 끼어 있지 않다(200자 이내).
    expect(guardIdx).toBeLessThan(blockIdx);
    expect(blockIdx - guardIdx).toBeLessThan(200);
  });

  it("prop 기본값이 true 라 기존 호출부(ERP·경정청구·일루아)는 그대로다", () => {
    expect(SRC).toContain("allowRowLayoutEdit = true,");
  });
});

describe("allowRowLayoutEdit — 렌더", () => {
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      // @ts-expect-error 시험에서는 도메인 prop 만 최소로 넘긴다
      <SettlementInfoTab
        rawValue={JSON.stringify([{ id: "t1", label: "1차" }])}
        row={{}}
        onSave={() => {}}
        isAdmin
        storagePrefix="contract"
        fieldsApiPath="/api/test/fields"
        configApiPath="/api/test/config"
        sectionTitle="계약정보"
        ratioBaseKey="a"
        ratioFeeKey="b"
        ratioBaseLabel="a"
        ratioFeeLabel="b"
        defaultScoreCards={[]}
        allowColumnEdit
        {...extra}
      />,
    );

  it("새 prop 을 줘도 부품이 정상적으로 그려진다(false)", () => {
    const html = render({ allowRowLayoutEdit: false });
    expect(html).toContain("전체 합계");
    expect(html).toContain("1차");
  });
  it("새 prop 을 줘도 부품이 정상적으로 그려진다(true)", () => {
    expect(render({ allowRowLayoutEdit: true })).toContain("전체 합계");
  });
  // 계약 탭인데 차수 추가 단추가 "정산 추가"로 뜨던 것(꼬리표 고정값) 수정 — 카드 제목("1차 계약")과 맞춘다.
  it("계약 탭의 차수 추가 단추는 「계약」 꼬리표를 쓴다", () => {
    expect(render({})).toContain("+ 2차 계약 추가");
  });
  it("환불 탭이면 「환불」 꼬리표를 쓴다", () => {
    expect(render({ storagePrefix: "refund", rawValue: JSON.stringify([{ id: "r1", label: "1차" }]) })).toContain("+ 2차 환불 추가");
  });
});
