"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTransition } from "react";
import type { SourceReadIssue, SourceReadStatus } from "@/lib/sourceReads";

interface SourceReadActionsProps {
  emailCount: number;
  emailEnabled: boolean;
  issues: SourceReadIssue[];
  operationId: string;
  slackCount: number;
  slackEnabled: boolean;
  status: SourceReadStatus;
}

type RefreshSource = "email" | "slack";

export function SourceReadActions({
  emailCount,
  emailEnabled,
  issues,
  operationId,
  slackCount,
  slackEnabled,
  status
}: SourceReadActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshingSource, setRefreshingSource] = useState<RefreshSource | null>(null);
  const isRefreshing = isPending || refreshingSource !== null;
  const slackDisabled = isRefreshing || !slackEnabled;
  const emailDisabled = isRefreshing || !emailEnabled;

  async function refreshSourceReads(source: RefreshSource) {
    setRefreshingSource(source);

    try {
      await fetch(`/api/operations/${encodeURIComponent(operationId)}/source-reads/refresh`, {
        body: JSON.stringify({ source }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });

      startTransition(() => {
        router.refresh();
      });
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
        {issues.length > 0 ? <small>확인 필요 {issues.length}건</small> : null}
      </div>
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

function sourceReadStatusLabel(status: SourceReadStatus) {
  if (status === "ok") return "연동 정상";
  if (status === "partial") return "일부 확인";
  if (status === "failed") return "읽기 실패";
  return "연동 꺼짐";
}
