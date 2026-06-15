"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTransition } from "react";
import type {
  OperationDiscussionItem,
  OperationEmailCandidateItem
} from "@/lib/data/operationCollaboration";
import type { SourceReadIssue, SourceReadStatus } from "@/lib/sourceReads";

interface SourceReadActionsProps {
  emailCandidateCount: number;
  emailCount: number;
  emailEnabled: boolean;
  issues: SourceReadIssue[];
  onRefreshResult?: (result: RefreshResult) => void;
  operationId: string;
  slackCount: number;
  slackEnabled: boolean;
  status: SourceReadStatus;
}

type RefreshSource = "email" | "slack";
export type RefreshResult = {
  discussionReferences?: OperationDiscussionItem[];
  emailCandidateReferences?: OperationEmailCandidateItem[];
  emailCandidateCount?: number | null;
  emailMatchedCount?: number | null;
  issueCodes?: string[];
  lectureReports?: OperationDiscussionItem[];
  lectureReportStatus?: SourceReadStatus;
  ok?: boolean;
  skippedCount?: number;
  source?: RefreshSource | "all";
  status?: SourceReadStatus;
  storedCount?: number;
};

export function SourceReadActions({
  emailCandidateCount,
  emailCount,
  emailEnabled,
  issues,
  onRefreshResult,
  operationId,
  slackCount,
  slackEnabled,
  status
}: SourceReadActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefreshResult, setLastRefreshResult] = useState<RefreshResult | null>(null);
  const [refreshingSource, setRefreshingSource] = useState<RefreshSource | null>(null);
  const isRefreshing = isPending || refreshingSource !== null;
  const slackDisabled = isRefreshing || !slackEnabled;
  const emailDisabled = isRefreshing || !emailEnabled;

  async function refreshSourceReads(source: RefreshSource) {
    setRefreshingSource(source);

    try {
      const response = await fetch(`/api/operations/${encodeURIComponent(operationId)}/source-reads/refresh`, {
        body: JSON.stringify({ source }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as RefreshResult;
      setLastRefreshResult({
        ...payload,
        ok: response.ok && payload.ok !== false,
        source
      });
      onRefreshResult?.({
        ...payload,
        ok: response.ok && payload.ok !== false,
        source
      });

      startTransition(() => {
        router.refresh();
      });
    } catch {
      const failedResult: RefreshResult = {
        ok: false,
        source,
        status: "failed",
        issueCodes: [`${source}_refresh_request_failed`]
      };
      setLastRefreshResult(failedResult);
      onRefreshResult?.(failedResult);
    } finally {
      setRefreshingSource(null);
    }
  }

  return (
    <div className="source-read-actions" aria-label="운영 논의 원천 읽기">
      <div className="source-read-summary">
        <span className={`source-read-status ${status}`}>{sourceReadStatusLabel(status)}</span>
        <strong>Slack {slackCount}건</strong>
        <strong>메일 {emailCount}건</strong>
        {emailEnabled && emailCandidateCount > emailCount ? <small>메일 후보 {emailCandidateCount}건</small> : null}
        {issues.length > 0 ? <small>확인 필요 {issues.length}건</small> : null}
      </div>
      {lastRefreshResult ? <p className="source-read-refresh-result">{refreshResultLabel(lastRefreshResult)}</p> : null}
      <div className="source-read-buttons">
        <button disabled={slackDisabled} onClick={() => void refreshSourceReads("slack")} type="button">
          {refreshingSource === "slack" ? "가져오는 중" : slackEnabled ? "Slack 다시 가져오기" : "Slack 설정 필요"}
        </button>
        <button disabled={emailDisabled} onClick={() => void refreshSourceReads("email")} type="button">
          {refreshingSource === "email" ? "가져오는 중" : emailEnabled ? "메일 다시 가져오기" : "메일 설정 필요"}
        </button>
      </div>
    </div>
  );
}

function refreshResultLabel(result: RefreshResult) {
  if (!result.ok) {
    return result.source === "email" ? "메일 읽기 요청 실패" : "Slack 읽기 요청 실패";
  }

  if (result.source === "email") {
    const matchedCount = result.emailMatchedCount ?? 0;
    const candidateCount = result.emailCandidateCount ?? matchedCount;
    const storeText = sourceStoreText(result);

    return candidateCount > matchedCount
      ? `방금 메일 후보 ${candidateCount}건 확인 · ${storeText}`
      : `방금 메일 ${matchedCount}건 확인 · ${storeText}`;
  }

  const reportCount = result.lectureReports?.length ?? 0;
  const storeText = sourceStoreText(result);

  return reportCount > 0
    ? `방금 Slack 논의/운영보고 ${reportCount}건 확인 · ${storeText}`
    : `방금 Slack 논의를 새로 확인 · ${storeText}`;
}

function sourceStoreText(result: RefreshResult) {
  const storedCount = result.storedCount ?? 0;
  const skippedCount = result.skippedCount ?? 0;

  if (storedCount > 0) {
    return `DB ${storedCount}건 저장`;
  }

  if (skippedCount > 0) {
    return "이미 저장됨";
  }

  return "저장할 새 항목 없음";
}

function sourceReadStatusLabel(status: SourceReadStatus) {
  if (status === "ok") return "연동 정상";
  if (status === "partial") return "일부 확인";
  if (status === "failed") return "읽기 실패";
  return "연동 꺼짐";
}
