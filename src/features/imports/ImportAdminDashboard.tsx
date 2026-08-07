import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { ImportPromoteButton } from "./ImportPromoteButton";
import { ImportReviewTable } from "./ImportReviewTable";
import { ImportUploadPanel } from "./ImportUploadPanel";
import type {
  ImportRunDetail,
  ImportRunSummary,
  ImportRunStatus
} from "@/lib/data/importTypes";

const STATUS_CLASS: Record<ImportRunStatus, string> = {
  "대기": "planned-assignment",
  "완료": "active",
  "오류있음": "archive-needed",
  "실패": "needs-assignment"
};

interface ImportAdminDashboardProps {
  runs: ImportRunSummary[];
}

export function ImportAdminDashboard({ runs }: ImportAdminDashboardProps) {
  const totalRows = runs.reduce((sum, run) => sum + run.rowCount, 0);
  const totalErrors = runs.reduce((sum, run) => sum + run.errorCount, 0);
  const completedRuns = runs.filter((run) => run.status === "완료").length;
  const reviewRuns = runs.filter((run) => run.status === "오류있음" || run.status === "실패").length;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 일괄 등록" teamScope="both" />
      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">데이터 일괄 등록</p>
            <h1>운영 현황 엑셀 일괄 등록</h1>
            <p className="lede">엑셀 파일을 올려 먼저 확인한 뒤, 필요한 값만 운영 현황에 반영합니다.</p>
          </div>
          <Link className="primary-link" href="/">
            운영 목록
          </Link>
        </header>

        <section className="metrics import-compact-metrics" aria-label="일괄 등록 요약">
          <Metric label="가져온 묶음" value={runs.length} />
          <Metric label="완료" value={completedRuns} />
          <Metric label="검토 필요" value={reviewRuns} />
          <Metric label="전체 행" value={totalRows} />
          <Metric label="확인할 행" value={totalErrors} />
          <Metric label="최근 가져오기" value={runs[0]?.startedAt ?? "-"} compact />
        </section>

        <ImportUploadPanel />

        <section className="table-section">
          <div className="table-header">
            <h2>가져오기 내역</h2>
            <span>{runs.length}건</span>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              title="아직 등록한 데이터가 없습니다"
              description="엑셀 파일을 올리면 이곳에 검토할 묶음이 생깁니다."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>가져온 데이터</th>
                    <th>가져온 시각</th>
                    <th>행 수</th>
                    <th>확인 결과</th>
                    <th>검토</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td>
                        <strong>{getSourceTypeLabel(run.sourceType)}</strong>
                        <span>
                          {run.sourceTeam} · {run.sourceType}
                        </span>
                        <span>{run.notes || "검토 후 운영 데이터에 반영"}</span>
                      </td>
                      <td>
                        <strong>{run.startedAt}</strong>
                        <span>{run.finishedAt || "종료 전"}</span>
                      </td>
                      <td>
                        <strong>{run.rowCount.toLocaleString("ko-KR")}</strong>
                        <span>보관된 행 {run.sourceRecordCount.toLocaleString("ko-KR")}건</span>
                      </td>
                      <td>
                        <strong>바로 확인 가능 {run.successCount.toLocaleString("ko-KR")}</strong>
                        <span>확인 필요 {run.errorCount.toLocaleString("ko-KR")}</span>
                        <span>검토 메모 {run.validationLogCount.toLocaleString("ko-KR")}</span>
                      </td>
                      <td>
                        <Link className="text-link" href={`/admin/imports/${run.id}`}>
                          열기
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

interface ImportRunDetailViewProps {
  run: ImportRunDetail;
}

export function ImportRunDetailView({ run }: ImportRunDetailViewProps) {
  const isNotionRun = isNotionImport(run.sourceType);
  const readyRecords = isNotionRun ? 0 : run.records.filter((record) => record.reviewStatus === "적용 준비").length;
  const needsFixRecords = run.records.filter((record) => record.reviewStatus === "확인 필요").length;
  const matchingRecords = isNotionRun
    ? run.records.filter((record) => record.reviewStatus === "적용 준비" || record.reviewStatus === "매칭 필요").length
    : run.records.filter((record) => record.reviewStatus === "매칭 필요").length;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 일괄 등록" teamScope="both" />
      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">검토 화면</p>
            <h1>{getSourceTypeLabel(run.sourceType)} 확인하기</h1>
            <p className="lede">읽어낸 값이 어느 과정과 연결될지 확인합니다. 아직 운영 데이터는 바뀌지 않습니다.</p>
          </div>
          <Link className="primary-link" href="/admin/imports">
            목록으로
          </Link>
        </header>

        <section className="import-review-toolbar" aria-label="검수 작업 요약">
          <div className="import-review-title">
            <span>검수 대상</span>
            <strong>{run.records.length.toLocaleString("ko-KR")}행</strong>
            <small>
              {getSourceTypeLabel(run.sourceType)} · {run.startedAt} · {run.importedBy || "올린 사람 기록 없음"}
            </small>
          </div>
          <div className="import-review-counts" aria-label="행 상태별 개수">
            <span className="review-count ready">
              맞음 <strong>{readyRecords.toLocaleString("ko-KR")}</strong>
            </span>
            <span className="review-count fix">
              수정 필요 <strong>{needsFixRecords.toLocaleString("ko-KR")}</strong>
            </span>
            <span className="review-count match">
              매칭 필요 <strong>{matchingRecords.toLocaleString("ko-KR")}</strong>
            </span>
          </div>
          {isNotionRun ? (
            <div className="import-promote-action readonly">
              <span>Notion 데이터는 가져오기와 검수까지만 저장합니다. 운영 DB 반영은 막혀 있습니다.</span>
            </div>
          ) : (
            <ImportPromoteButton importRunId={run.id} />
          )}
        </section>

        <section className="table-section import-review-workspace">
          <div className="table-header">
            <div>
              <h2>행별 확인</h2>
              <p>행 번호와 판정을 기준으로 빠르게 훑고, 필요한 행만 열어 원본을 확인합니다.</p>
            </div>
            <span>최대 200건 표시</span>
          </div>
          {run.records.length === 0 ? (
            <EmptyState title="저장된 행이 없습니다" description="파일을 다시 올리거나 가져오기 설정을 확인해 주세요." />
          ) : (
            <ImportReviewTable canPromoteRecords={!isNotionRun} records={run.records} />
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ compact, label, value }: { compact?: boolean; label: string; value: number | string }) {
  return (
    <div className={`metric${compact ? " compact" : ""}`}>
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toLocaleString("ko-KR") : value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: ImportRunStatus }) {
  return <span className={`status ${STATUS_CLASS[status]}`}>{status}</span>;
}

function getSourceTypeLabel(sourceType: string) {
  const normalizedType = sourceType.toLowerCase();

  if (normalizedType.includes("sheet") || normalizedType.includes("spreadsheet") || normalizedType.includes("csv")) {
    return "스프레드시트 파일";
  }

  if (normalizedType.includes("mail") || normalizedType.includes("gmail") || normalizedType.includes("email")) {
    return "메일 데이터";
  }

  if (normalizedType.includes("notion")) {
    return "Notion 데이터";
  }

  if (normalizedType.includes("slack")) {
    return "Slack 데이터";
  }

  if (normalizedType.includes("json")) {
    return "JSON 파일";
  }

  return "가져온 데이터";
}

function isNotionImport(sourceType: string) {
  return sourceType.toLowerCase().includes("notion");
}

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
