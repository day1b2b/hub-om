import type { SourceReadIssue } from "../sourceReads/sourceReadTypes";

const publicMessages: Record<string, RegExp> = {
  salesmap_deal_missing_amount: /^금액이 없는 딜 [0-9]+건을 건너뛰었습니다\.$/u,
  salesmap_deal_non_positive_amount: /^합산 금액이 0 이하인 코스ID [0-9]+건을 제외했습니다\(환불 등 확인 필요\)\.$/u,
  salesmap_deal_pagination_truncated: /^딜이 많아 일부만 읽었습니다\(최대 [0-9]+페이지\)\. 전체가 반영되지 않을 수 있습니다\.$/u,
  salesmap_cursor_loop: /^세일즈맵 페이지 커서가 비정상 반복되어 중간에 멈췄습니다\. 전체가 반영되지 않을 수 있습니다\.$/u,
  salesmap_api_token_missing: /^Salesmap reader is not fully configured\.$/u
};
/** Source/network/JSON exceptions may contain payloads and credentials. */
export function safeSalesRevenueIssue(issue: SourceReadIssue): string {
  if (issue.code === "salesmap_read_failed") return "세일즈맵 딜을 읽지 못했습니다.";
  const pattern = Object.hasOwn(publicMessages, issue.code) ? publicMessages[issue.code] : undefined;
  return typeof issue.message === "string" && pattern?.test(issue.message) ? issue.message : "SALES_REVENUE_SOURCE_ISSUE";
}
