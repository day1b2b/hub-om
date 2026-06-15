import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { ArchiveCompleteButton } from "./ArchiveCompleteButton";
import { DriveImportPanel } from "./DriveImportPanel";
import { IssueReviewEditor } from "./IssueReviewEditor";
import type {
  ArchiveStatus,
  OperationChannel,
  OperationSession,
  OperationStatus,
  OnsiteRequired
} from "@/lib/data/operationTypes";
import type {
  OperationCollaboration,
  OperationDiscussionItem
} from "@/lib/data/operationCollaboration";
import { displayRoleAssigneeText } from "@/lib/data/roleAssignees";
import { satisfactionNumber, summarizeSatisfactionValue } from "@/lib/data/satisfaction";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

const STATUS_CLASS: Record<OperationStatus, string> = {
  "배정필요": "needs-assignment",
  "배정예정": "planned-assignment",
  "진행중": "active",
  "완료": "done",
  "회고완료": "retrospective-done",
  "아카이빙필요": "archive-needed"
};

const ARCHIVE_CLASS: Record<ArchiveStatus, string> = {
  "아카이빙전": "planned-assignment",
  "아카이빙필요": "archive-needed",
  "완료": "done"
};

const OPERATION_CHANNEL_LABEL: Record<OperationChannel, string> = {
  onsite: "현장",
  live_online: "실시간 온라인",
  online_platform: "온라인 플랫폼",
  blended: "혼합",
  needs_review: "확인 필요"
};

const ONSITE_LABEL: Record<OnsiteRequired, string> = {
  Y: "필요",
  N: "불필요",
  PARTIAL: "일부 필요",
  UNKNOWN: "확인 필요"
};

interface OperationDetailProps {
  collaboration: OperationCollaboration;
  operation: OperationSession;
  relatedOperations?: OperationSession[];
  teamScope: TeamScope;
}

export function OperationDetail({
  collaboration,
  operation,
  relatedOperations = [operation],
  teamScope
}: OperationDetailProps) {
  const courseOperations = getCourseOperations(operation, relatedOperations);
  const requiredArchiveItems = getRequiredArchiveItems(operation);
  const completedArchiveItems = requiredArchiveItems.filter((archiveItem) => archiveItem.done);
  const referenceResourceLinks = getReferenceResourceLinks(operation, collaboration);
  const registeredReferenceLinks = referenceResourceLinks.filter((resourceLink) => isNavigableHref(resourceLink.href));
  const satisfactionSummary = getSatisfactionSummary(courseOperations);
  const teamQuery = teamScopeSearchParam(teamScope);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Course detail" teamScope={teamScope} />

      <section className="content">
        <header className="page-header detail-header">
          <div>
            <div className="title-row">
              <span className="title-company">{operation.companyName}</span>
              <h1>{operation.courseName}</h1>
              <span className="title-course-id">
                {operation.courseId ? `코스ID ${operation.courseId}` : "코스ID 검토 필요"}
              </span>
              <StatusBadge status={operation.operationStatus} />
            </div>
          </div>
        </header>

        <section className="detail-layout">
          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>일정 / 운영 조건</h2>
              <span>리소스 판단 기준</span>
            </div>
            <div className="info-grid">
              <InfoItem label="기간" value={`${operation.startDate} ~ ${operation.endDate}`} />
              <InfoItem label="시간" value={operation.timeText || "시간 미정"} />
              <InfoItem label="회차" value={operation.roundNo ? `${operation.roundNo}회차` : "확인 필요"} />
              <InfoItem label="교육일수" value={operation.educationDays || "확인 필요"} />
              <InfoItem label="운영 유형" value={operation.operationType} />
              <InfoItem label="운영 채널" value={OPERATION_CHANNEL_LABEL[operation.operationChannel]} />
              <InfoItem label="교육 형태" value={operation.educationFormat} />
              <InfoItem label="현장 투입" value={ONSITE_LABEL[operation.onsiteRequired]} />
            </div>
          </section>

          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>담당 / 투입</h2>
              <span>누가 맡고 있는가</span>
            </div>
            <div className="info-grid">
              <InfoItem label="OM" value={operation.om || "배정필요"} />
              <InfoItem label="LD" value={operation.ld || "미정"} />
              <InfoItem label="강사" value={operation.instructors || "미정"} />
              <InfoItem label="실습코치" value={operation.coach || "미정"} />
              <InfoItem label="지역" value={operation.region || "미정"} />
              <InfoItem label="남은 회차" value={remainingRoundText(operation)} />
            </div>
          </section>

          {courseOperations.length > 1 ? (
            <section className="detail-section course-sessions-section">
              <div className="section-title">
                <h2>동일 코스ID 운영 차수</h2>
                <span>{operation.courseId} 기준 · {courseOperations.length}건</span>
              </div>
              <div className="session-table-wrap">
                <table className="session-table">
                  <thead>
                    <tr>
                      <th>회차</th>
                      <th>상태</th>
                      <th>일정 / 시간</th>
                      <th>OM</th>
                      <th>LD</th>
                      <th>강사</th>
                      <th>실습코치</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseOperations.map((courseOperation, index) => (
                      <tr
                        className={courseOperation.operationId === operation.operationId ? "current-session" : undefined}
                        key={courseOperation.operationId}
                      >
                        <td>
                          <Link className="session-link" href={`/operations/${courseOperation.operationId}${teamQuery}`}>
                            {roundLabel(courseOperation, index)}
                          </Link>
                        </td>
                        <td><StatusBadge status={courseOperation.operationStatus} /></td>
                        <td>
                          <span className="stacked-cell">
                            <strong>{courseOperation.startDate} ~ {courseOperation.endDate}</strong>
                            <small>{courseOperation.timeText || "시간 미정"}</small>
                          </span>
                        </td>
                        <td>{displayRoleAssigneeText(courseOperation.om, "배정필요")}</td>
                        <td>{displayRoleAssigneeText(courseOperation.ld, "미정")}</td>
                        <td>{courseOperation.instructors || "미정"}</td>
                        <td>{courseOperation.coach || "미정"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="detail-section resource-status-section" id="links">
            <div className="section-title">
              <h2>자료 준비도</h2>
              <span>{completedArchiveItems.length}/{requiredArchiveItems.length} 충족</span>
            </div>
            <div className="resource-archive-body">
              <div className="archive-status-body" id="archive">
                <div className="archive-readiness-columns">
                  <div className="archive-readiness-column">
                    <div className="resource-row-head">
                      <strong>필수 항목</strong>
                      <span>{completedArchiveItems.length}/{requiredArchiveItems.length}</span>
                    </div>
                    <div className="archive-item-list" aria-label="아카이브 필수 항목">
                      {requiredArchiveItems.map((archiveItem) => (
                        <ArchiveReadinessRow item={archiveItem} key={archiveItem.label} />
                      ))}
                    </div>
                  </div>

                  <div className="archive-readiness-column">
                    <div className="resource-row-head">
                      <strong>참고 자료</strong>
                      <span>{registeredReferenceLinks.length}/{referenceResourceLinks.length}</span>
                    </div>
                    <div className="archive-item-list" aria-label="아카이브 참고 자료">
                      {referenceResourceLinks.map((resourceLink) => (
                        <ResourceReferenceRow href={resourceLink.href} key={resourceLink.label} label={resourceLink.label} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="archive-completion-row">
                  <ArchiveBadge status={operation.archiveStatus} />
                  <ArchiveCompleteButton archiveStatus={operation.archiveStatus} operationId={operation.operationId} />
                </div>
              </div>
              <div className="resource-drive-panel">
                <div className="resource-row-head">
                  <strong>자료 등록</strong>
                  <span>Drive 폴더</span>
                </div>
                <DriveImportPanel operation={operation} />
                <div className="resource-side-metrics" aria-label="만족도 및 비용 요약">
                  <div className="resource-side-metric">
                    <div className="resource-row-head">
                      <strong>만족도</strong>
                      <span>{satisfactionSummary.totalCount}개 회차</span>
                    </div>
                    <div className="satisfaction-compact-row resource-metric-row">
                      <CompactValue label="전체 평균" value={satisfactionSummary.totalAverage ?? "미입력"} />
                      <CompactValue label="강사 평균" value={satisfactionSummary.instructorAverage ?? "미입력"} />
                    </div>
                    {courseOperations.length > 1 ? (
                      <div className="round-satisfaction-strip resource-round-strip">
                        {courseOperations.map((courseOperation, index) => (
                          <span
                            className={courseOperation.operationId === operation.operationId ? "current-round" : undefined}
                            key={courseOperation.operationId}
                          >
                            <b>{roundLabel(courseOperation, index)}</b>
                            <strong>{formatSatisfactionValue(courseOperation.avgSatisfaction)}</strong>
                            <small>강사 {formatSatisfactionValue(courseOperation.instructorSatisfaction)}</small>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="resource-side-metric">
                    <div className="resource-row-head">
                      <strong>비용</strong>
                      <span>선택 입력</span>
                    </div>
                    <div className="info-grid cost-current-grid cost-compact-grid resource-cost-grid">
                      <InfoItem label="매출" value={formatMoney(operation.revenue)} />
                      <InfoItem label="비용 합계" value={formatMoney(operation.totalCost)} />
                      <InfoItem label="수익" value={formatMoney(operation.profit)} />
                      <InfoItem label="강사비" value={formatMoney(operation.instructorCost)} />
                      <InfoItem label="운영비" value={formatMoney(operation.operationCost)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="detail-section wide-detail-section">
            <div className="section-title">
              <h2>이슈 / 회고</h2>
              <span>기록하고 저장</span>
            </div>
            <IssueReviewEditor key={operation.operationId} operation={operation} />
          </section>

          <section className="detail-section wide-detail-section slack-discussion-section">
            <div className="section-title">
              <h2>운영 논의</h2>
              <span>Slack / 메일 스레드</span>
            </div>
            <div className="note-stack">
              <DiscussionList
                companyName={operation.companyName}
                items={collaboration.discussionReferences}
                status={collaboration.discussionStatus}
              />
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="compact-value">
      <span>{label}</span>
      <strong>{value}</strong>
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

interface ArchiveReadinessItem {
  done: boolean;
  doneText: string;
  href?: string;
  label: string;
  missingText: string;
}

function ArchiveReadinessRow({ item }: { item: ArchiveReadinessItem }) {
  const href = item.href;
  const hasHref = href ? isNavigableHref(href) : false;

  return (
    <div className={`archive-item-row ${item.done ? "done" : "missing"}`}>
      <span className="archive-item-state">{item.done ? "완료" : "필요"}</span>
      <strong>{item.label}</strong>
      <span>{item.done ? item.doneText : item.missingText}</span>
      {hasHref ? (
        <a href={href} rel="noreferrer" target="_blank">
          열기
        </a>
      ) : null}
    </div>
  );
}

function ResourceReferenceRow({ href, label }: { href: string; label: string }) {
  const hasHref = isNavigableHref(href);

  return (
    <div className={`archive-item-row ${hasHref ? "done" : "missing"}`}>
      <span className="archive-item-state">{hasHref ? "등록" : "필요"}</span>
      <strong>{label}</strong>
      <span>{hasHref ? "등록됨" : "링크 없음"}</span>
      {hasHref ? (
        <a href={href} rel="noreferrer" target="_blank">
          열기
        </a>
      ) : null}
    </div>
  );
}

function isNavigableHref(value: string) {
  return /^(https?:\/\/|slack:\/\/)/.test(value.trim());
}

function getReferenceResourceLinks(operation: OperationSession, collaboration: OperationCollaboration) {
  return [
    { label: "강의보고", href: collaboration.lectureReports[0]?.sourceUrl ?? "" },
    { label: "패들렛", href: operation.padletLink },
    { label: "운영상세", href: operation.operationDetail },
    { label: "기업위키", href: operation.companyWikiLink },
    { label: "강사위키", href: operation.instructorWikiLink }
  ];
}

function getRequiredArchiveItems(operation: OperationSession): ArchiveReadinessItem[] {
  return [
    {
      done: Boolean(operation.driveLink),
      doneText: "등록됨",
      href: operation.driveLink,
      label: "드라이브",
      missingText: "링크 없음"
    },
    {
      done: Boolean(operation.lectureManagementLink),
      doneText: "등록됨",
      href: operation.lectureManagementLink,
      label: "강의관리",
      missingText: "링크 없음"
    },
    {
      done: operation.hasResultReport === "유" && Boolean(operation.resultReportLink),
      doneText: "등록됨",
      href: operation.resultReportLink,
      label: "결과보고서",
      missingText: "링크 없음"
    },
    {
      done: satisfactionNumber(operation.avgSatisfaction) !== null,
      doneText: "입력됨",
      label: "만족도",
      missingText: "미입력"
    },
    {
      done: Boolean(operation.operationIssue || operation.omUpdate || operation.specialNotes),
      doneText: "기록됨",
      label: "이슈/회고",
      missingText: "기록 없음"
    }
  ];
}

function StatusBadge({ status }: { status: OperationStatus }) {
  return <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>;
}

function ArchiveBadge({ status }: { status: ArchiveStatus }) {
  return <span className={`status ${ARCHIVE_CLASS[status]}`}>{status}</span>;
}

function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCourseOperations(operation: OperationSession, relatedOperations: OperationSession[]): OperationSession[] {
  const baseOperations = operation.courseId
    ? relatedOperations.filter((candidate) => candidate.courseId === operation.courseId)
    : [operation];

  const uniqueOperations = new Map<string, OperationSession>();

  for (const candidate of baseOperations) {
    uniqueOperations.set(candidate.operationId, candidate);
  }

  if (!uniqueOperations.has(operation.operationId)) {
    uniqueOperations.set(operation.operationId, operation);
  }

  return [...uniqueOperations.values()].sort(compareCourseOperation);
}

function compareCourseOperation(a: OperationSession, b: OperationSession): number {
  const aRound = Number(a.roundNo);
  const bRound = Number(b.roundNo);

  if (Number.isFinite(aRound) && Number.isFinite(bRound) && aRound !== bRound) {
    return aRound - bRound;
  }

  if (a.startDate !== b.startDate) {
    return a.startDate.localeCompare(b.startDate);
  }

  return a.operationId.localeCompare(b.operationId);
}

function roundLabel(operation: OperationSession, index: number): string {
  if (operation.roundNo) return `${operation.roundNo}회차`;
  return `${index + 1}번째`;
}

function getSatisfactionSummary(operations: OperationSession[]) {
  const totalValues = operations.map((operation) => satisfactionNumber(operation.avgSatisfaction)).filter(isNumber);
  const instructorValues = operations.map((operation) => satisfactionNumber(operation.instructorSatisfaction)).filter(isNumber);

  return {
    instructorAverage: averageSatisfaction(instructorValues),
    instructorCount: instructorValues.length,
    totalAverage: averageSatisfaction(totalValues),
    totalCount: totalValues.length
  };
}

function averageSatisfaction(values: number[]) {
  if (values.length === 0) return null;

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average.toFixed(2);
}

function formatSatisfactionValue(value: string) {
  return summarizeSatisfactionValue(value) || "미입력";
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function remainingRoundText(operation: OperationSession) {
  if (operation.operationStatus === "완료" || operation.operationStatus === "회고완료") return "0회차";
  if (!operation.roundNo) return "확인 필요";
  return `${operation.roundNo}회차 기준 확인`;
}
