import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { AddRoundButton } from "./AddRoundButton";
import { BulkAddRoundsButton } from "./BulkAddRoundsButton";
import { BulkEditRoundsButton } from "./BulkEditRoundsButton";
import { BulkSaveRoundsButton } from "./BulkSaveRoundsButton";
import { DeleteRoundButton } from "./DeleteRoundButton";
import { EditAllRoundsProvider } from "./EditAllRoundsProvider";
import { EditableCourseNameItem } from "./EditableCourseNameItem";
import { EditableInfoItem } from "./EditableInfoItem";
import { EditableOnsiteOmCell } from "./EditableOnsiteOmCell";
import { EditableResourceRow } from "./EditableResourceRow";
import { EditableRoundResourceCell } from "./EditableRoundResourceCell";
import { EditableSessionRow } from "./EditableSessionRow";
import { IssueReviewEditor } from "./IssueReviewEditor";
import { LectureManagementNoteRow } from "./LectureManagementNoteRow";
import { OperationDiscussionPanel } from "./OperationDiscussionPanel";
import { ResultReportConditionSelect } from "./ResultReportConditionSelect";
import { ResultReportRequirementCell } from "./ResultReportRequirementCell";
import type {
  OperationSession,
  OperationStatus,
  OnsiteRequired
} from "@/lib/data/operationTypes";
import type {
  OperationCollaboration,
  OperationDiscussionItem
} from "@/lib/data/operationCollaboration";
import { isSameCourse } from "@/lib/data/operationCalculations";
import type { PersonOptions } from "@/lib/data/personOptions";
import { displayRoleAssigneeText } from "@/lib/data/roleAssignees";
import { isNavigableHref, toHref } from "@/lib/links";
import { satisfactionNumber } from "@/lib/data/satisfaction";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

const SHOW_OPERATION_DISCUSSION = false;
const SHOW_LECTURE_REPORTS = false;
const SHOW_READINESS_SUMMARY = false;

const STATUS_CLASS: Record<OperationStatus, string> = {
  "배정필요": "needs-assignment",
  "배정예정": "planned-assignment",
  "진행중": "active",
  "완료": "done",
  "회고완료": "retrospective-done",
  "아카이빙필요": "archive-needed"
};

const ONSITE_LABEL: Record<OnsiteRequired, string> = {
  Y: "Y",
  N: "N",
  PARTIAL: "일부 필요",
  UNKNOWN: "확인 필요"
};

interface OperationDetailProps {
  collaboration: OperationCollaboration;
  operation: OperationSession;
  personOptions?: PersonOptions;
  relatedOperations?: OperationSession[];
  sameCourseIdOperations?: OperationSession[];
  teamScope: TeamScope;
}

export function OperationDetail({
  collaboration,
  operation,
  personOptions = { ld: [], om: [] },
  relatedOperations = [operation],
  sameCourseIdOperations = [],
  teamScope
}: OperationDetailProps) {
  const courseOperations = getCourseOperations(operation, relatedOperations);
  const courseGroups = getCourseGroups(operation, sameCourseIdOperations);
  const showOperationStatus = !(operation.operationStatus === "배정필요" && Boolean(operation.om));
  const requiredArchiveItems = getRequiredArchiveItems(operation);
  const completedArchiveItems = requiredArchiveItems.filter((archiveItem) => archiveItem.done);
  const referenceResourceLinks = getReferenceResourceLinks(operation);
  const registeredReferenceLinks = referenceResourceLinks.filter((resourceLink) => isNavigableHref(resourceLink.href));
  const satisfactionSummary = getSatisfactionSummary(courseOperations);
  const teamQuery = teamScopeSearchParam(teamScope);
  const nextRoundNo = String(Math.max(0, ...courseOperations.map((candidate) => Number(candidate.roundNo) || 0)) + 1);
  const fallbackOperationId =
    courseOperations.find((candidate) => candidate.operationId !== operation.operationId)?.operationId ?? null;
  const sameCourseIdOperationIds =
    sameCourseIdOperations.length > 0
      ? sameCourseIdOperations.map((candidate) => candidate.operationId)
      : [operation.operationId];

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Course detail" teamScope={teamScope} />

      <section className="content operation-detail-content">
        <header className="page-header detail-header">
          <div className="title-row">
            <span className="title-company">{operation.companyName}</span>
            <h1>{operation.courseName}</h1>
            {showOperationStatus ? <StatusBadge status={operation.operationStatus} /> : null}
            {operation.courseId ? null : <span className="title-course-id">코스ID 검토 필요</span>}
          </div>
          <div className="detail-header-actions">
            {SHOW_READINESS_SUMMARY ? (
              <span>준비도 {completedArchiveItems.length}/{requiredArchiveItems.length}</span>
            ) : null}
            <button aria-label="상세 메뉴" type="button">•••</button>
          </div>
        </header>

        {SHOW_LECTURE_REPORTS && collaboration.lectureReports.length > 0 ? (
          <LectureReportsByRound
            courseOperations={courseOperations}
            currentOperation={operation}
            reports={collaboration.lectureReports}
            teamQuery={teamQuery}
          />
        ) : null}

        <section className="operation-detail-layout">
          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>일정 / 운영 조건</h2>
            </div>
            <div className="info-grid">
              <InfoItem label="과정ID" value={operation.processId || "-"} />
              <EditableInfoItem
                displayValue={operation.courseId || "미정"}
                fields={[{ name: "courseId", placeholder: "예: 261326", value: operation.courseId }]}
                label="코스ID"
                operationId={operation.operationId}
              />
              <EditableCourseNameItem
                displayValue={operation.courseName || "미정"}
                operationIds={sameCourseIdOperationIds}
                value={operation.courseName}
              />
              <InfoItem
                label="교육 형태"
                value={aggregateUniqueValues(courseOperations, (candidate) => candidate.educationFormat)}
              />
              <InfoItem label="기간" value={formatCourseDateRange(courseOperations)} />
              <InfoItem label="회차" value={`총 ${courseOperations.length}회차`} />
              <InfoItem label="교육일수" value={formatTotalEducationDays(courseOperations)} />
              <InfoItem label="교육장" value={operation.region || "미정"} />
              <ResultReportConditionSelect
                rounds={courseOperations.map((candidate) => ({
                  hasResultReport: candidate.hasResultReport,
                  operationId: candidate.operationId
                }))}
              />
            </div>
          </section>

          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>담당 / 투입</h2>
            </div>
            <div className="info-grid">
              <EditableInfoItem
                displayValue={operation.om || "미정"}
                fields={[{ name: "om", options: personOptions.om, type: "name-select", value: operation.om }]}
                label="OM"
                operationId={operation.operationId}
              />
              <EditableInfoItem
                displayValue={operation.ld || "미정"}
                fields={[{ name: "ld", options: personOptions.ld, type: "name-select", value: operation.ld }]}
                label="LD"
                operationId={operation.operationId}
              />
              <InfoItem label="강사" value={operation.instructors || "미정"} />
              <InfoItem label="실습코치" value={operation.coach || "미정"} />
              <InfoItem
                label="현장 투입"
                value={aggregateUniqueValues(courseOperations, (candidate) => ONSITE_LABEL[candidate.onsiteRequired])}
              />
              <InfoItem label="남은 회차" value={remainingRoundText(operation)} />
              <InfoItem label="매출" value={formatMoney(operation.revenue)} />
              <InfoItem label="만족도(평균)" value={satisfactionSummary.totalAverage ?? "미입력"} />
            </div>
          </section>

          <section className="detail-section resource-status-section required-items-section" id="links">
            <div className="resource-card-grid">
              <div className="resource-summary-card">
                <div className="resource-row-head">
                  <strong>필수 항목</strong>
                  <span>{completedArchiveItems.length}/{requiredArchiveItems.length}</span>
                </div>
                <div className="archive-item-list" aria-label="아카이브 필수 항목">
                  {requiredArchiveItems.map((archiveItem) => (
                    <EditableResourceRow
                      done={archiveItem.done}
                      doneText={archiveItem.doneText}
                      field={archiveItem.field}
                      isLink
                      key={archiveItem.label}
                      label={archiveItem.label}
                      missingText={archiveItem.missingText}
                      operationId={operation.operationId}
                      placeholder="https://"
                      value={archiveItem.value}
                    />
                  ))}
                </div>
              </div>

              <div className="resource-summary-card">
                <div className="resource-row-head">
                  <strong>참고 자료</strong>
                  <span>{registeredReferenceLinks.length}/{referenceResourceLinks.length}</span>
                </div>
                <div className="archive-item-list" aria-label="아카이브 참고 자료">
                  {referenceResourceLinks.map((resourceLink) => {
                    const hasHref = isNavigableHref(resourceLink.href);

                    return (
                      <div className={`archive-item-row ${hasHref ? "done" : "missing"}`} key={resourceLink.label}>
                        <strong>{resourceLink.label}</strong>
                        <div className="archive-item-actions">
                          {hasHref ? (
                            <a
                              className="archive-item-state"
                              href={toHref(resourceLink.href) ?? resourceLink.href}
                              rel="noreferrer"
                              target="_blank"
                            >
                              바로가기
                            </a>
                          ) : (
                            <span className="archive-item-state">링크 없음</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="detail-section course-sessions-section">
            <EditAllRoundsProvider>
            <div className="section-title">
              <h2>동일 과정 운영 차수</h2>
              <div className="course-sessions-header-actions">
                <span>코스ID {operation.courseId} · {operation.courseName} 기준 · {courseOperations.length}건</span>
                <AddRoundButton
                  baseCoach={operation.coach}
                  baseInstructors={operation.instructors}
                  baseOperationId={operation.operationId}
                  baseTimeText={operation.timeText}
                  nextRoundNo={nextRoundNo}
                />
                <BulkAddRoundsButton baseOperationId={operation.operationId} />
                {courseOperations.length > 1 ? <BulkEditRoundsButton /> : null}
              </div>
            </div>
            <div className="session-table-wrap">
              <table className="session-table">
                <thead>
                  <tr>
                    <th>회차</th>
                    <th>OM</th>
                    <th>현장운영</th>
                    <th>일정 / 시간</th>
                    <th>강사</th>
                    <th>실습코치</th>
                    <th>만족도</th>
                    <th>결과보고서 여부</th>
                    <th>결과보고서</th>
                    <th>패들렛</th>
                    <th>강의관리</th>
                    <th>관리</th>
                    <th>삭제</th>
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
                      <td>{displayRoleAssigneeText(courseOperation.om, "배정필요")}</td>
                      <EditableOnsiteOmCell
                        om={courseOperation.om}
                        onsiteOm={courseOperation.onsiteOm}
                        onsiteRequired={courseOperation.onsiteRequired}
                        operationId={courseOperation.operationId}
                        options={personOptions.om}
                      />
                      <EditableSessionRow
                        coach={courseOperation.coach}
                        endDate={courseOperation.endDate}
                        instructors={courseOperation.instructors}
                        operationId={courseOperation.operationId}
                        startDate={courseOperation.startDate}
                        timeText={courseOperation.timeText}
                      >
                        <td>
                          <SessionMetricPill
                            doneText={courseOperation.avgSatisfaction}
                            missingText="미입력"
                          />
                        </td>
                        <ResultReportRequirementCell
                          hasResultReport={courseOperation.hasResultReport}
                          operationId={courseOperation.operationId}
                        />
                        {courseOperation.hasResultReport === "불필요" ? (
                          <td className="round-resource-cell" />
                        ) : (
                          <EditableRoundResourceCell
                            companionDoneValue="유"
                            companionField="hasResultReport"
                            companionMissingValue="무"
                            done={courseOperation.hasResultReport === "유"}
                            field="resultReportLink"
                            operationId={courseOperation.operationId}
                            value={courseOperation.resultReportLink}
                          />
                        )}
                        <EditableRoundResourceCell
                          done={isNavigableHref(courseOperation.padletLink)}
                          field="padletLink"
                          operationId={courseOperation.operationId}
                          value={courseOperation.padletLink}
                        />
                        <td>
                          <LectureManagementNoteRow
                            done={Boolean(courseOperation.lectureManagementNote.trim())}
                            operationId={courseOperation.operationId}
                            startDate={courseOperation.startDate}
                            value={courseOperation.lectureManagementNote}
                          />
                        </td>
                      </EditableSessionRow>
                      <td>
                        <DeleteRoundButton
                          fallbackOperationId={fallbackOperationId}
                          isCurrent={courseOperation.operationId === operation.operationId}
                          isLastRound={courseOperations.length === 1}
                          operationId={courseOperation.operationId}
                          roundLabel={roundLabel(courseOperation, index)}
                          teamQuery={teamQuery}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <BulkSaveRoundsButton />
            </EditAllRoundsProvider>
          </section>

          {courseGroups.length > 0 ? (
            <section className="detail-section course-groups-section">
              <div className="section-title">
                <h2>코스ID {operation.courseId} 내 과정</h2>
                <span>{courseGroups.length}개 과정</span>
              </div>
              <div className="course-group-list">
                {courseGroups.map((group) => (
                  <details
                    className={group.isCurrent ? "course-group-item current-course-group" : "course-group-item"}
                    key={group.key}
                    open={group.isCurrent}
                  >
                    <summary>
                      <span>
                        {group.courseName}
                        {group.isCurrent ? <span className="current-course-tag">현재 보고 있는 과정</span> : null}
                      </span>
                      <span>{group.operations.length}개 회차</span>
                    </summary>
                    <ul className="course-group-rounds">
                      {group.operations.map((groupOperation, index) => (
                        <li
                          className={groupOperation.operationId === operation.operationId ? "current-session" : undefined}
                          key={groupOperation.operationId}
                        >
                          <Link href={`/operations/${groupOperation.operationId}${teamQuery}`}>
                            <span>{roundLabel(groupOperation, index)}</span>
                            <span>{groupOperation.startDate || "일정 미정"}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <section className="detail-section wide-detail-section">
            <div className="section-title">
              <h2>이슈 / 회고</h2>
              <span>기록하고 저장</span>
            </div>
            <IssueReviewEditor key={operation.operationId} operation={operation} />
          </section>

          {SHOW_OPERATION_DISCUSSION && (
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
          )}
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

interface ArchiveReadinessItem {
  done: boolean;
  doneText: string;
  field: "driveLink" | "operationDetail";
  href?: string;
  label: string;
  missingText: string;
  value: string;
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

function getReferenceResourceLinks(operation: OperationSession) {
  return [
    { label: "기업위키", href: operation.companyWikiLink, field: "companyWikiLink" as const },
    { label: "강사위키", href: operation.instructorWikiLink, field: "instructorWikiLink" as const }
  ];
}

function getRequiredArchiveItems(operation: OperationSession): ArchiveReadinessItem[] {
  return [
    {
      done: Boolean(operation.driveLink),
      doneText: "등록됨",
      field: "driveLink",
      href: operation.driveLink,
      label: "드라이브",
      missingText: "링크 없음",
      value: operation.driveLink
    },
    {
      done: Boolean(operation.operationDetail),
      doneText: "등록됨",
      field: "operationDetail",
      href: operation.operationDetail,
      label: "싱크업",
      missingText: "링크 없음",
      value: operation.operationDetail
    }
  ];
}

function StatusBadge({ status }: { status: OperationStatus }) {
  return <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>;
}

function SessionMetricPill({ doneText, missingText }: { doneText: string; missingText: string }) {
  const isDone = Boolean(doneText.trim());

  return <span className={`archive-pill ${isDone ? "done" : "needed"}`}>{isDone ? doneText : missingText}</span>;
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

function formatCourseDateRange(courseOperations: OperationSession[]): string {
  const startDates = courseOperations.map((candidate) => candidate.startDate).filter(Boolean).sort();
  const endDates = courseOperations.map((candidate) => candidate.endDate).filter(Boolean).sort();
  const start = startDates[0];
  const end = endDates[endDates.length - 1];

  if (!start || !end) return "확인 필요";

  return start === end ? start : `${start} ~ ${end}`;
}

function aggregateUniqueValues(
  operations: OperationSession[],
  mapper: (operation: OperationSession) => string
): string {
  const uniqueValues = [...new Set(operations.map(mapper).map((value) => value.trim()).filter(Boolean))];

  if (uniqueValues.length === 0) return "확인 필요";

  return uniqueValues.join(", ");
}

function formatTotalEducationDays(operations: OperationSession[]): string {
  const totalDays = operations.reduce((sum, candidate) => sum + (candidate.sessionDurationDays ?? 0), 0);

  return totalDays > 0 ? `총 ${totalDays}일` : "확인 필요";
}

function getCourseOperations(operation: OperationSession, relatedOperations: OperationSession[]): OperationSession[] {
  const baseOperations = relatedOperations.filter((candidate) => isSameCourse(candidate, operation));

  const uniqueOperations = new Map<string, OperationSession>();

  for (const candidate of baseOperations) {
    uniqueOperations.set(candidate.operationId, candidate);
  }

  if (!uniqueOperations.has(operation.operationId)) {
    uniqueOperations.set(operation.operationId, operation);
  }

  return [...uniqueOperations.values()].sort(compareCourseOperation);
}

interface CourseGroup {
  courseName: string;
  isCurrent: boolean;
  key: string;
  operations: OperationSession[];
}

function getCourseGroups(operation: OperationSession, sameCourseIdOperations: OperationSession[]): CourseGroup[] {
  const currentGroupKey = courseGroupKey(operation);
  const groups = new Map<string, CourseGroup>();

  for (const candidate of sameCourseIdOperations) {
    const key = courseGroupKey(candidate);
    const group = groups.get(key) ?? { courseName: candidate.courseName, isCurrent: key === currentGroupKey, key, operations: [] };
    group.operations.push(candidate);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.operations.sort(compareCourseOperation);
  }

  return [...groups.values()].sort((a, b) => a.courseName.localeCompare(b.courseName));
}

function courseGroupKey(operation: OperationSession): string {
  return `${operation.companyName}__${operation.courseId}__${operation.courseName}`;
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
