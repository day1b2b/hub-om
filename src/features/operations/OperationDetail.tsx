import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { IssueReviewEditor } from "./IssueReviewEditor";
import { OperationDiscussionPanel } from "./OperationDiscussionPanel";
import type {
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
import { satisfactionNumber } from "@/lib/data/satisfaction";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

const STATUS_CLASS: Record<OperationStatus, string> = {
  "배정필요": "needs-assignment",
  "배정예정": "planned-assignment",
  "진행중": "active",
  "완료": "done",
  "회고완료": "retrospective-done",
  "아카이빙필요": "archive-needed"
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

      <section className="content operation-detail-content">
        <header className="page-header detail-header">
          <div className="title-row">
            <span className="title-company">{operation.companyName}</span>
            <h1>{operation.courseName}</h1>
            <StatusBadge status={operation.operationStatus} />
            <span className="title-course-id">
              {operation.courseId ? "코스ID 검토 필요" : "코스ID 없음"}
            </span>
          </div>
          <div className="detail-header-actions">
            <span>준비도 {completedArchiveItems.length}/{requiredArchiveItems.length}</span>
            <button aria-label="상세 메뉴" type="button">•••</button>
          </div>
        </header>

        {collaboration.lectureReports.length > 0 ? (
          <LectureReportsByRound
            courseOperations={courseOperations}
            currentOperation={operation}
            reports={collaboration.lectureReports}
            teamQuery={teamQuery}
          />
        ) : null}

        <section className="detail-layout">
          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>일정 / 운영 조건</h2>
            </div>
            <div className="info-grid">
              <InfoItem label="기간" value={`${operation.startDate} ~ ${operation.endDate}`} />
              <InfoItem label="시간" value={operation.timeText || "시간 미정"} />
              <InfoItem label="운영 유형" value={operation.operationType} />
              <InfoItem label="교육 형태" value={operation.educationFormat} />
              <InfoItem label="운영 채널" value={OPERATION_CHANNEL_LABEL[operation.operationChannel]} />
              <InfoItem label="회차" value={operation.roundNo ? `${operation.roundNo}회차` : "확인 필요"} />
              <InfoItem label="교육일수" value={operation.educationDays || "확인 필요"} />
              <InfoItem label="현장 투입" value={ONSITE_LABEL[operation.onsiteRequired]} />
            </div>
          </section>

          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>담당 / 투입</h2>
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
            <div className="resource-card-grid">
              <div className="resource-summary-card">
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

              <div className="resource-summary-card">
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

              <div className="resource-summary-card">
                <div className="resource-row-head">
                  <strong>만족도</strong>
                  <span>{satisfactionSummary.totalCount}개 회차</span>
                </div>
                <div className="resource-metric-grid">
                  <CompactValue label="전체 평균" value={satisfactionSummary.totalAverage ?? "미입력"} />
                  <CompactValue label="강사 평균" value={satisfactionSummary.instructorAverage ?? "미입력"} />
                </div>
              </div>

              <div className="resource-summary-card">
                <div className="resource-row-head">
                  <strong>비용</strong>
                  <span>선택 입력</span>
                </div>
                <div className="resource-metric-grid">
                  <CompactValue label="매출" value={formatMoney(operation.revenue)} />
                  <CompactValue label="비용 합계" value={formatMoney(operation.totalCost)} />
                  <CompactValue label="수익" value={formatMoney(operation.profit)} />
                  <CompactValue label="강사비" value={formatMoney(operation.instructorCost)} />
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

          <section className="detail-section wide-detail-section slack-discussion-section" id="discussions">
            <OperationDiscussionPanel
              availability={collaboration.discussionSourceAvailability}
              companyName={operation.companyName}
              diagnostics={collaboration.discussionDiagnostics}
              emailCandidates={collaboration.discussionEmailCandidates}
              initialItems={collaboration.discussionReferences}
              issues={collaboration.discussionIssues}
              key={operation.operationId}
              operationId={operation.operationId}
              status={collaboration.discussionStatus}
            />
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
      <strong>{item.label}</strong>
      {hasHref ? (
        <a className="archive-item-state" href={href} rel="noreferrer" target="_blank">
          열기
        </a>
      ) : (
        <span className="archive-item-state">{item.done ? item.doneText : item.missingText}</span>
      )}
    </div>
  );
}

function ResourceReferenceRow({ href, label }: { href: string; label: string }) {
  const hasHref = isNavigableHref(href);

  return (
    <div className={`archive-item-row ${hasHref ? "done" : "missing"}`}>
      <strong>{label}</strong>
      {hasHref ? (
        <a className="archive-item-state" href={href} rel="noreferrer" target="_blank">
          열기
        </a>
      ) : (
        <span className="archive-item-state">링크 없음</span>
      )}
    </div>
  );
}

function LectureReportsByRound({
  courseOperations,
  currentOperation,
  reports,
  teamQuery
}: {
  courseOperations: OperationSession[];
  currentOperation: OperationSession;
  reports: OperationDiscussionItem[];
  teamQuery: string;
}) {
  if (reports.length === 0) {
    return null;
  }

  const groupedReports = groupLectureReportsByRound(reports, currentOperation);

  return (
    <section className="detail-section course-report-section">
      <div className="course-report-list">
        {groupedReports.map((group) => {
          const courseOperation = findCourseOperationByRound(courseOperations, group.roundNo);
          const courseOperationIndex = courseOperation
            ? courseOperations.findIndex((candidate) => candidate.operationId === courseOperation.operationId)
            : -1;

          return (
            <div className="course-report-row" key={group.roundNo}>
              <div className="course-report-title">
                <strong>회차별 운영보고</strong>
              </div>
              <div className="course-report-items">
                {group.items.map((report) => (
                  <a className="course-report-link" href={report.sourceUrl} key={report.id} rel="noreferrer" target="_blank">
                    <span>{formatShortDateTime(report.occurredAt)}</span>
                    <strong>{discussionTitleWithoutCompany(report.title, currentOperation.companyName)}</strong>
                  </a>
                ))}
              </div>
              <div className="course-report-round">
                {courseOperation ? (
                  <Link href={`/operations/${courseOperation.operationId}${teamQuery}`}>
                    {roundLabel(courseOperation, courseOperationIndex >= 0 ? courseOperationIndex : 0)}
                  </Link>
                ) : (
                  <strong>{group.label}</strong>
                )}
                <span>{group.items.length}건</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
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

function formatMoney(value: number | null): string {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function groupLectureReportsByRound(reports: OperationDiscussionItem[], currentOperation: OperationSession) {
  const fallbackRoundNo = normalizeRoundNo(currentOperation.roundNo) || "current";
  const groups = new Map<string, { items: OperationDiscussionItem[]; label: string; roundNo: string }>();

  for (const report of reports) {
    const roundNo = extractReportRoundNo(report) || fallbackRoundNo;
    const label = roundNo === "current"
      ? (currentOperation.roundNo ? `${currentOperation.roundNo}회차` : "현재 회차")
      : `${roundNo}회차`;
    const group = groups.get(roundNo) ?? { items: [], label, roundNo };

    group.items.push(report);
    groups.set(roundNo, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    }))
    .sort((a, b) => compareRoundGroup(a.roundNo, b.roundNo));
}

function extractReportRoundNo(report: OperationDiscussionItem) {
  return normalizeRoundNo(`${report.title} ${report.summary ?? ""}`);
}

function normalizeRoundNo(value: string) {
  return value.match(/(\d{1,2})\s*(회차|차수|주차|차)/)?.[1] ?? "";
}

function compareRoundGroup(a: string, b: string) {
  const aNumber = Number(a);
  const bNumber = Number(b);

  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }

  return a.localeCompare(b);
}

function findCourseOperationByRound(operations: OperationSession[], roundNo: string) {
  const normalizedRoundNo = Number(roundNo);

  if (!Number.isFinite(normalizedRoundNo)) {
    return null;
  }

  return operations.find((operation) => Number(operation.roundNo) === normalizedRoundNo) ?? null;
}

function formatShortDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
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

function isNumber(value: number | null): value is number {
  return value !== null;
}

function remainingRoundText(operation: OperationSession) {
  if (operation.operationStatus === "완료" || operation.operationStatus === "회고완료") return "0회차";
  if (!operation.roundNo) return "확인 필요";
  return `${operation.roundNo}회차 기준 확인`;
}
