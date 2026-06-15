"use client";

import { useMemo, useState } from "react";
import {
  type OperationDiscussionDiagnostics,
  type OperationDiscussionItem,
  type OperationDiscussionSourceAvailability,
  type OperationEmailCandidateItem
} from "@/lib/data/operationCollaboration";
import type { SourceReadIssue, SourceReadStatus } from "@/lib/sourceReads";
import { SourceReadActions, type RefreshResult } from "./SourceReadActions";

interface OperationDiscussionPanelProps {
  availability: OperationDiscussionSourceAvailability;
  companyName: string;
  diagnostics: OperationDiscussionDiagnostics;
  emailCandidates: OperationEmailCandidateItem[];
  initialItems: OperationDiscussionItem[];
  issues: SourceReadIssue[];
  operationId: string;
  status: SourceReadStatus;
}

export function OperationDiscussionPanel({
  availability,
  companyName,
  diagnostics: initialDiagnostics,
  emailCandidates: initialEmailCandidates,
  initialItems,
  issues: initialIssues,
  operationId,
  status: initialStatus
}: OperationDiscussionPanelProps) {
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics);
  const [emailCandidates, setEmailCandidates] = useState(initialEmailCandidates);
  const [issues, setIssues] = useState(initialIssues);
  const [items, setItems] = useState(initialItems);
  const [status, setStatus] = useState(initialStatus);
  const sourceCounts = useMemo(() => getDiscussionSourceCounts(items), [items]);

  return (
    <>
      <div className="section-title discussion-section-title">
        <div>
          <h2>운영 논의</h2>
          <span>Slack / 메일 스레드</span>
        </div>
        <SourceReadActions
          emailCandidateCount={diagnostics.emailCandidateCount}
          emailCount={sourceCounts.email}
          emailEnabled={availability.emailEnabled}
          issues={issues}
          onRefreshResult={handleRefreshResult}
          operationId={operationId}
          slackCount={sourceCounts.slack}
          slackEnabled={availability.slackEnabled}
          status={status}
        />
      </div>
      <div className="note-stack">
        <DiscussionList
          companyName={companyName}
          items={items}
          status={status}
        />
        <EmailCandidateList
          companyName={companyName}
          items={emailCandidates}
        />
      </div>
    </>
  );

  function handleRefreshResult(result: RefreshResult) {
    if (result.status) {
      setStatus(result.status);
    }

    if (result.emailCandidateCount !== undefined || result.emailMatchedCount !== undefined) {
      setDiagnostics({
        emailCandidateCount: result.emailCandidateCount ?? diagnostics.emailCandidateCount,
        emailMatchedCount: result.emailMatchedCount ?? diagnostics.emailMatchedCount
      });
    }

    if (result.issueCodes) {
      setIssues(result.issueCodes.map((code) => ({ code, message: "Source read issue.", recoverable: true })));
    }

    if (result.discussionReferences) {
      setItems(result.discussionReferences);
    }

    if (result.emailCandidateReferences) {
      setEmailCandidates(result.emailCandidateReferences);
    }

  }
}

function getDiscussionSourceCounts(items: OperationDiscussionItem[]) {
  return items.reduce(
    (counts, item) => {
      counts[item.sourceKind] += 1;
      return counts;
    },
    { email: 0, other: 0, slack: 0 }
  );
}

function EmailCandidateList({
  companyName,
  items
}: {
  companyName: string;
  items: OperationEmailCandidateItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="note-item email-candidate-review">
      <span>메일 후보 검토</span>
      <p>자동 매칭 전 후보 전체입니다. 원문을 열어 이 과정과 관련 있는지 확인하세요.</p>
      <div className="email-candidate-list">
        {items.map((item, index) => (
          <div className={`email-candidate-item ${item.matched ? "matched" : "review"}`} key={item.id}>
            <div className="email-candidate-topline">
              <div className="email-candidate-heading">
                <div className="activity-heading-line">
                  <span className={`email-candidate-state ${item.matched ? "matched" : "review"}`}>
                    {item.matched ? "확정 목록 반영됨" : "검토 필요"}
                  </span>
                  <strong>{index + 1}. {formatDateTime(item.occurredAt)}</strong>
                </div>
                <small>{discussionTitleWithoutCompany(item.title, companyName)}</small>
              </div>
              <a aria-label="메일 후보 원문 열기" className="activity-link email-candidate-link" href={item.sourceUrl} rel="noreferrer" target="_blank">
                원문
              </a>
            </div>
            {item.summary ? <p>{item.summary}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiscussionList({
  companyName,
  items,
  status
}: {
  companyName: string;
  items: OperationDiscussionItem[];
  status: string;
}) {
  if (items.length === 0) {
    return (
      <div className="note-item">
        <span>운영 스레드</span>
        <p>{status === "disabled" ? "운영 논의 연동이 꺼져 있습니다." : "조건에 맞는 운영 스레드가 아직 없습니다."}</p>
      </div>
    );
  }

  return (
    <div className="note-item">
      <span>운영 스레드</span>
      <div className="activity-list">
        {[...items].reverse().map((item, index) => (
          <div className="activity-item" key={item.id}>
            <div className="activity-heading">
              <div className="activity-heading-line">
                <span className={`activity-source-badge ${item.sourceKind}`}>{item.sourceLabel}</span>
                <strong>{index + 1}. {formatDateTime(item.occurredAt)}</strong>
              </div>
              <small>{discussionTitleWithoutCompany(item.title, companyName)}</small>
            </div>
            {item.summary ? <p>{item.summary}</p> : null}
            <a aria-label="원문 열기" className="activity-link" href={item.sourceUrl} rel="noreferrer" target="_blank">
              원문
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function discussionTitleWithoutCompany(title: string, companyName: string): string {
  const normalizedCompany = companyName.trim();

  if (!normalizedCompany) return title;

  return title
    .replace(new RegExp(`^${escapeRegExp(normalizedCompany)}\\s*[-_/|:]?\\s*`, "i"), "")
    .trim() || title;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
