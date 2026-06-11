import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import type {
  ArchiveStatus,
  OperationChannel,
  OperationSession,
  OperationStatus,
  OnsiteRequired
} from "@/lib/data/operationTypes";
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
  operation: OperationSession;
  relatedOperations?: OperationSession[];
  teamScope: TeamScope;
}

export function OperationDetail({ operation, relatedOperations = [operation], teamScope }: OperationDetailProps) {
  const courseOperations = getCourseOperations(operation, relatedOperations);
  const teamQuery = teamScopeSearchParam(teamScope);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Course detail" teamScope={teamScope} />

      <section className="content">
        <header className="page-header detail-header">
          <div>
            <Link className="back-link" href={`/operations${teamQuery}`}>
              운영 현황으로
            </Link>
            <div className="title-row">
              <h1>{operation.courseName}</h1>
              <StatusBadge status={operation.operationStatus} />
            </div>
            <p className="lede">
              강의관리 시트를 대체하지 않고, 과정 판단에 필요한 핵심 정보와 관련 자료로 이동하는 허브입니다.
            </p>
          </div>
          <div className="header-panel">
            <span>동일 코스 차수</span>
            <strong>{courseOperations.length}건</strong>
          </div>
        </header>

        <section className="detail-summary" aria-label="과정 기본 정보">
          <SummaryItem label="기업" value={operation.companyName} />
          <SummaryItem label="코스ID" value={operation.courseId || "검토필요"} />
          <SummaryItem label="OM" value={operation.om || "배정필요"} />
          <SummaryItem label="LD" value={operation.ld || "미정"} />
          <SummaryItem label="기간" value={`${operation.startDate} ~ ${operation.endDate}`} />
        </section>

        <section className="detail-layout">
          <section className="detail-section course-sessions-section">
            <div className="section-title">
              <h2>동일 코스ID 운영 차수</h2>
              <span>{operation.courseId || "코스ID 없음"} 기준</span>
            </div>
            <div className="session-table-wrap">
              <table className="session-table">
                <thead>
                  <tr>
                    <th>회차</th>
                    <th>상태</th>
                    <th>일정</th>
                    <th>시간</th>
                    <th>과정명</th>
                    <th>OM</th>
                    <th>LD</th>
                    <th>강사</th>
                    <th>아카이빙</th>
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
                      <td>{courseOperation.startDate} ~ {courseOperation.endDate}</td>
                      <td>{courseOperation.timeText || "시간 미정"}</td>
                      <td className="session-course-name">{courseOperation.courseName}</td>
                      <td>{courseOperation.om || "배정필요"}</td>
                      <td>{courseOperation.ld || "미정"}</td>
                      <td>{courseOperation.instructors || "미정"}</td>
                      <td><ArchiveBadge status={courseOperation.archiveStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="detail-section compact-info-section">
            <div className="section-title">
              <h2>일정 / 회차</h2>
              <span>리소스 판단 핵심</span>
            </div>
            <div className="info-grid">
              <InfoItem label="시작일" value={operation.startDate} />
              <InfoItem label="종료일" value={operation.endDate} />
              <InfoItem label="회차" value={operation.roundNo ? `${operation.roundNo}회차` : "확인 필요"} />
              <InfoItem label="교육일수" value={operation.educationDays || "확인 필요"} />
              <InfoItem label="시간" value={operation.timeText || "시간 미정"} />
              <InfoItem label="운영 유형" value={operation.operationType} />
              <InfoItem label="교육 형태" value={operation.educationFormat} />
              <InfoItem label="운영 채널" value={OPERATION_CHANNEL_LABEL[operation.operationChannel]} />
            </div>
            <div className="session-summary">
              <div>
                <span>세부 일정</span>
                <strong>{operation.startDate} ~ {operation.endDate}</strong>
                <p>{operation.timeText || "시간 미정"} · {operation.roundNo || "-"}회차 · {operation.educationDays || "교육일수 미정"}일</p>
              </div>
              <div>
                <span>남은 회차</span>
                <strong>{remainingRoundText(operation)}</strong>
                <p>실제 회차별 일정은 강의관리 시트에서 확인합니다.</p>
              </div>
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
              <InfoItem label="현장 투입" value={ONSITE_LABEL[operation.onsiteRequired]} />
            </div>
          </section>

          <section className="detail-section link-summary-section" id="links">
            <div className="section-title">
              <h2>자료 링크</h2>
              <span>흩어진 자료로 이동</span>
            </div>
            <div className="link-list">
              <ExternalLink label="드라이브" href={operation.driveLink} />
              <ExternalLink label="강의관리" href={operation.lectureManagementLink} />
              <ExternalLink label="패들렛" href={operation.padletLink} />
              <ExternalLink label="운영상세" href={operation.operationDetail} />
              <ExternalLink label="결과보고서" href={operation.resultReportLink} />
              <ExternalLink label="기업위키" href={operation.companyWikiLink} />
              <ExternalLink label="강사위키" href={operation.instructorWikiLink} />
            </div>
          </section>

          <section className="detail-section archive-summary-section" id="archive">
            <div className="section-title">
              <h2>아카이빙</h2>
              <span>종료 후 누락 확인</span>
            </div>
            <div className="archive-compact-body">
              <div className="archive-status-summary">
                <span>현재 상태</span>
                <ArchiveBadge status={operation.archiveStatus} />
              </div>
              <div className="archive-checklist">
                <ArchiveCheck label="드라이브" done={Boolean(operation.driveLink)} />
                <ArchiveCheck label="강의관리" done={Boolean(operation.lectureManagementLink)} />
                <ArchiveCheck label="결과보고서" done={operation.hasResultReport === "유" && Boolean(operation.resultReportLink)} />
                <ArchiveCheck label="만족도" done={Boolean(operation.avgSatisfaction)} />
                <ArchiveCheck label="이슈/회고" done={Boolean(operation.operationIssue || operation.omUpdate || operation.specialNotes)} />
                <ArchiveCheck label="아카이빙 완료" done={operation.archiveStatus === "완료"} />
              </div>
            </div>
            <div className="archive-toggle-row">
              <label className="toggle-filter">
                <input checked={operation.archiveStatus === "완료"} readOnly type="checkbox" />
                아카이빙 완료
              </label>
              <span>데모 화면에서는 읽기 전용입니다. 실제 쓰기 권한 연결 후 수정 가능합니다.</span>
            </div>
          </section>

          <section className="detail-section wide-detail-section">
            <div className="section-title">
              <h2>이슈 / 회고</h2>
              <span>다음 운영자가 볼 맥락</span>
            </div>
            <div className="note-stack">
              <NoteItem label="특이사항" value={operation.specialNotes} />
              <NoteItem label="운영 이슈" value={operation.operationIssue} />
              <NoteItem label="OM 업데이트" value={operation.omUpdate} />
              <NoteItem
                label="검토 필요"
                value={operation.validationErrors.length > 0 ? operation.validationErrors.join(", ") : "없음"}
              />
            </div>
          </section>

          <section className="detail-section">
            <div className="section-title">
              <h2>운영 논의 / 변경 이력</h2>
              <span>연동 예정 영역</span>
            </div>
            <div className="note-stack">
              <NoteItem label="Slack 논의" value="지정 채널 연동 후 과정명/기업명 기준 스레드와 링크를 표시합니다." />
              <NoteItem label="변경 이력" value="시작일, 종료일, 담당자, 아카이빙 상태 변경 이력을 저장할 영역입니다." />
              <NoteItem label="수정 권한" value="리더는 전체 수정 가능, OM/LD는 자기 담당 건 수정 가능으로 연결 예정입니다." />
            </div>
          </section>

          <section className="detail-section">
            <div className="section-title">
              <h2>만족도 / 비용</h2>
              <span>회고와 성과 판단</span>
            </div>
            <div className="info-grid">
              <InfoItem label="만족도 전체" value={operation.avgSatisfaction || "미입력"} />
              <InfoItem label="만족도 강사" value={operation.instructorSatisfaction || "미입력"} />
              <InfoItem label="결과보고서" value={operation.hasResultReport} />
              <InfoItem label="매출" value={formatMoney(operation.revenue)} />
              <InfoItem label="비용 합계" value={formatMoney(operation.totalCost)} />
              <InfoItem label="수익" value={formatMoney(operation.profit)} />
              <InfoItem label="강사비" value={formatMoney(operation.instructorCost)} />
              <InfoItem label="운영비" value={formatMoney(operation.operationCost)} />
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function NoteItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="note-item">
      <span>{label}</span>
      <p>{value || "기록 없음"}</p>
    </div>
  );
}

function ArchiveCheck({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={`archive-check ${done ? "done" : "missing"}`}>
      <span>{done ? "완료" : "미완료"}</span>
      <strong>{label}</strong>
    </div>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  if (!href) {
    return (
      <div className="external-link missing">
        <strong>{label}</strong>
        <span>미등록</span>
      </div>
    );
  }

  return (
    <a className="external-link" href={href} rel="noreferrer" target="_blank">
      <strong>{label}</strong>
      <span>열기</span>
    </a>
  );
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

function remainingRoundText(operation: OperationSession) {
  if (operation.operationStatus === "완료" || operation.operationStatus === "회고완료") return "0회차";
  if (!operation.roundNo) return "확인 필요";
  return `${operation.roundNo}회차 기준 확인`;
}
