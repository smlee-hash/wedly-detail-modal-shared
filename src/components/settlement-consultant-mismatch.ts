// 정산 차수의 담당 컨설턴트가 계약 차수의 담당과 다를 때 카드에 띄울 한 줄 경고를 정한다.
// ─────────────────────────────────────────────────────────────────────────────
// 화면에 보여 주는 판단일 뿐이다 — 수수료 계산·저장·집계에는 쓰지 않는다(계산은 서버가 한다).
// 계약 차수가 0개이거나 2개 이상이면 어느 차수와 비교할지 알 수 없으므로 아무것도 띄우지 않는다
// (그때는 서버 계산이 「계약 차수 확인 필요」를 따로 보여 준다).
// ─────────────────────────────────────────────────────────────────────────────
import { parsePersonItem, splitPersonListSafe } from "../lib/person-helpers";
import { parseTierArray } from "./gov-merged-tiers";

/** 차수 카드의 담당 컨설턴트 칸 키 */
export const CONSULTANT_FIELD_KEY = "담당컨설턴트";

/** 담당 컨설턴트 칸의 화면 글자 — 「이름 | 이메일」 꼴은 이름만, 여러 명이면 「이름1, 이름2」(저장 순서 그대로). 글자가 아니면 빈 글자. */
export function consultantDisplayText(value: unknown): string {
  if (typeof value !== "string") return "";
  return splitPersonListSafe(value)
    .map((item) => parsePersonItem(item).name)
    .filter((name) => name !== "")
    .join(", ");
}

/**
 * 정산 차수 카드에 띄울 경고 한 줄. 경고가 없으면 null.
 * @param settlementTier 지금 그리는 정산 차수
 * @param contractTiers 같은 회사의 계약 차수 전체(배열 또는 JSON 글자)
 */
export function settlementConsultantNotice(
  settlementTier: Record<string, unknown> | null | undefined,
  contractTiers: unknown,
): string | null {
  const tiers = parseTierArray(contractTiers);
  if (tiers.length !== 1) return null;
  const settlementName = consultantDisplayText(settlementTier?.[CONSULTANT_FIELD_KEY]);
  const contractName = consultantDisplayText(tiers[0]?.[CONSULTANT_FIELD_KEY]);
  if (settlementName === "" || contractName === "") return null;
  if (settlementName === contractName) return null;
  return `계약 차수 담당 컨설턴트(${contractName})와 다릅니다`;
}
