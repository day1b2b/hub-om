import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { requireWorkspaceSession } from "@/lib/auth/requireWorkspaceSession";
import {
  readLatestDriveImportRun,
  type StoredDriveImportCandidate,
  type StoredDriveImportRunResult
} from "@/lib/driveImports/driveImportResults";
import { getStoredTeamMemberRepository } from "@/lib/data/teamMemberRepositoryFactory";
import { resolveTeamScope, teamScopeSearchParam } from "@/lib/teamScope";

export const dynamic = "force-dynamic";

interface DriveImportRunsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DriveImportRunsPage({ searchParams }: DriveImportRunsPageProps) {
  const session = await requireWorkspaceSession();
  const teamMemberRepository = getStoredTeamMemberRepository();
  const [ownerRoster, params, latestRun] = await Promise.all([
    teamMemberRepository.listResourceOwners(),
    searchParams,
    readLatestDriveImportRun()
  ]);
  const teamScope = resolveTeamScope(params, session, ownerRoster);
  const teamQuery = teamScopeSearchParam(teamScope);

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Drive import" teamScope={teamScope} />

      <section className="content drive-import-runs-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">읽기 전용</p>
            <h1>Drive 조회 결과</h1>
            <p className="lede">
              최근 실행한 Drive 조회 결과를 확인합니다. 이 화면은 후보를 보여주기만 하며 운영 데이터는 수정하지 않습니다.
            </p>
          </div>
          {latestRun ? (
            <div className="header-panel">
              <span>최근 run</span>
              <strong>{formatDateTime(latestRun.startedAt)}</strong>
            </div>
          ) : null}
        </header>

        {latestRun ? (
          <>
            <section className="metrics drive-import-run-metrics" aria-label="Drive 조회 요약">
              <Metric label="대상 운영" value={latestRun.operationCount} caption={statusLabel(latestRun.status)} />
              <Metric label="링크/폴더 스캔" value={latestRun.scannedRefCount} caption={`${latestRun.scanFoundFolderCount}건 폴더 확인`} />
              <Metric label="폴더명 검색" value={latestRun.folderSearchCount} caption={`${latestRun.folderSearchWithCandidatesCount}건 후보 있음`} />
              <Metric label="전체 만족도 후보" value={latestRun.avgSatisfactionCandidateCount} caption="전체/전반/종합/평균 근거만" />
              <Metric label="강사 만족도 후보" value={latestRun.instructorSatisfactionCandidateCount} caption="강사 만족도 근거" />
              <Metric label="오류" value={latestRun.errorCount} caption={`${latestRun.scanIssueCount}건 이슈 기록`} />
            </section>

            <section className="table-section drive-import-run-section">
              <div className="table-header">
                <div>
                  <strong>최근 조회 결과</strong>
                  <span>{latestRun.results.length}건 표시 · run {shortId(latestRun.id)}</span>
                </div>
                <span>{latestRun.finishedAt ? `완료 ${formatDateTime(latestRun.finishedAt)}` : "진행 기록"}</span>
              </div>
              <div className="table-wrap">
                <table className="drive-import-run-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>운영</th>
                      <th>입력</th>
                      <th>조회 결과</th>
                      <th>후보</th>
                      <th>이슈</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestRun.results.map((result, index) => (
                      <tr key={`${result.operationId}-${index}`}>
                        <td>{index + 1}</td>
                        <td>
                          <Link className="course-link" href={`/operations/${result.operationId}${teamQuery}`}>
                            <strong>{result.companyName}</strong>
                            <span>{result.courseName}</span>
                          </Link>
                          <span>{dateRange(result)}</span>
                        </td>
                        <td>
                          <strong>{inputKindLabel(result.inputKind)}</strong>
                          <span>{result.inputValue || "검색어 자동 구성"}</span>
                        </td>
                        <td>
                          <ResultKind result={result} />
                        </td>
                        <td>
                          <CandidatePreview result={result} />
                        </td>
                        <td>
                          <IssuePreview result={result} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="table-section">
            <div className="empty-state">
              <strong>저장된 Drive 조회 결과가 없습니다.</strong>
              <span>먼저 dry-run을 실행하면 이 화면에 결과가 표시됩니다.</span>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function Metric({ caption, label, value }: { caption: string; label: string; value: number | string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </div>
  );
}

function ResultKind({ result }: { result: StoredDriveImportRunResult }) {
  if (result.error) {
    return (
      <div className="drive-import-run-result">
        <strong>{resultKindLabel(result.resultKind)}</strong>
        <span>{result.error}</span>
      </div>
    );
  }

  if (result.folderTitle || result.folderUrl) {
    return (
      <div className="drive-import-run-result">
        <strong>{resultKindLabel(result.resultKind)}</strong>
        {result.folderUrl ? (
          <a href={result.folderUrl} rel="noreferrer" target="_blank">{result.folderTitle || "Drive 폴더 열기"}</a>
        ) : (
          <span>{result.folderTitle}</span>
        )}
        <small>{result.fileCount}개 파일 · {result.candidateCount}개 후보</small>
      </div>
    );
  }

  return (
    <div className="drive-import-run-result">
      <strong>{resultKindLabel(result.resultKind)}</strong>
      <span>{result.candidateCount}개 후보</span>
    </div>
  );
}

function CandidatePreview({ result }: { result: StoredDriveImportRunResult }) {
  const candidates = result.keyCandidates.length > 0
    ? result.keyCandidates.slice(0, 6)
    : result.folderCandidates.slice(0, 4);

  if (candidates.length === 0) {
    return <span className="drive-import-run-empty">후보 없음</span>;
  }

  return (
    <div className="drive-import-run-candidates">
      {candidates.map((candidate, index) => (
        <CandidateItem candidate={candidate} key={`${candidate.field ?? candidate.title ?? "candidate"}-${index}`} />
      ))}
    </div>
  );
}

function CandidateItem({ candidate }: { candidate: StoredDriveImportCandidate }) {
  const label = candidate.field ? candidateFieldLabel(candidate.field) : "폴더";
  const value = displayCandidateValue(candidate);
  const meta = candidate.sourceTitle ?? confidenceText(candidate);

  return (
    <div className="drive-import-run-candidate">
      <b>{label}</b>
      {candidate.url ? (
        <a href={candidate.url} rel="noreferrer" target="_blank">{value || "Drive 열기"}</a>
      ) : (
        <strong>{value || "-"}</strong>
      )}
      {meta ? <span>{meta}</span> : null}
      {candidate.evidence ? <small>{candidate.evidence}</small> : null}
    </div>
  );
}

function displayCandidateValue(candidate: StoredDriveImportCandidate) {
  if (candidate.field === "instructors" && candidate.value === "사내") {
    return "사내강사";
  }

  return candidate.value ?? candidate.title ?? "";
}

function IssuePreview({ result }: { result: StoredDriveImportRunResult }) {
  if (result.error) return <span className="drive-import-run-error">{result.error}</span>;
  if (result.issues.length === 0) return <span className="drive-import-run-empty">없음</span>;

  return (
    <ul className="drive-import-run-issues">
      {result.issues.slice(0, 3).map((issue, index) => (
        <li key={`${issue}-${index}`}>{issue}</li>
      ))}
    </ul>
  );
}

function candidateFieldLabel(field: string) {
  const labels: Record<string, string> = {
    avgSatisfaction: "전체 만족도",
    driveLink: "Drive 링크",
    instructorSatisfaction: "강사 만족도",
    instructors: "강사",
    lectureManagementLink: "강의관리",
    resultReportLink: "결과보고서"
  };

  return labels[field] ?? field;
}

function confidenceText(candidate: StoredDriveImportCandidate) {
  const parts = [
    candidate.confidence ? `신뢰도 ${candidate.confidence}` : "",
    typeof candidate.score === "number" ? `점수 ${candidate.score}` : ""
  ].filter(Boolean);

  return parts.join(" · ");
}

function dateRange(result: StoredDriveImportRunResult) {
  if (!result.startDate && !result.endDate) return "일정 없음";
  if (result.startDate === result.endDate) return result.startDate;
  return `${result.startDate || "시작일 없음"} ~ ${result.endDate || "종료일 없음"}`;
}

function formatDateTime(value: string) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}

function inputKindLabel(inputKind: string) {
  const labels: Record<string, string> = {
    driveLink: "Drive 값",
    folderSearch: "폴더 검색",
    lectureManagementLink: "강의관리 링크"
  };

  return labels[inputKind] ?? inputKind;
}

function resultKindLabel(resultKind: string) {
  const labels: Record<string, string> = {
    error: "오류",
    folder_search_candidates: "폴더 후보",
    folder_search_empty: "후보 없음",
    scan_found_folder: "폴더 확인",
    scan_no_folder: "폴더 미확인"
  };

  return labels[resultKind] ?? resultKind;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: "완료",
    completed_with_errors: "오류 포함 완료",
    failed: "실패",
    pending: "진행중"
  };

  return labels[status] ?? status;
}
