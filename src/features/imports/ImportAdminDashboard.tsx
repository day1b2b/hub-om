import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { ImportUploadPanel } from "./ImportUploadPanel";
import type { ImportRunDetail, ImportRunSummary, ImportRunStatus } from "@/lib/data/importTypes";

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
      <AppSidebar label="Import review" teamScope="both" />
      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Import review</p>
            <h1>데이터 적재 검수</h1>
            <p className="lede">
              외부 원천에서 들어온 데이터 적재 이력과 검증 결과를 확인합니다. 실제 원천 파일과 원문 예시는 Git에 저장하지 않습니다.
            </p>
          </div>
          <Link className="primary-link" href="/">
            운영 목록
          </Link>
        </header>

        <section className="metrics" aria-label="적재 요약">
          <Metric label="import 실행" value={runs.length} />
          <Metric label="완료" value={completedRuns} />
          <Metric label="검토 필요" value={reviewRuns} />
          <Metric label="원천 row" value={totalRows} />
          <Metric label="오류 row" value={totalErrors} />
          <Metric label="최근 실행" value={runs[0]?.startedAt ?? "-"} compact />
        </section>

        <ImportUploadPanel />

        <section className="table-section">
          <div className="table-header">
            <h2>Import run</h2>
            <span>{runs.length}건</span>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              title="아직 import 기록이 없습니다"
              description="다음 단계에서 Excel, Salesmap, Gmail adapter가 데이터를 넣으면 이곳에서 실행 결과를 검수합니다."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>원천</th>
                    <th>실행 시각</th>
                    <th>row</th>
                    <th>검증</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <StatusBadge status={run.status} />
                      </td>
                      <td>
                        <strong>{run.sourceTeam} 데이터 적재</strong>
                        <span>
                          {run.sourceTeam} · {run.sourceType}
                        </span>
                        <span>원천 식별 정보 비공개</span>
                      </td>
                      <td>
                        <strong>{run.startedAt}</strong>
                        <span>{run.finishedAt || "종료 전"}</span>
                      </td>
                      <td>
                        <strong>{run.rowCount.toLocaleString("ko-KR")}</strong>
                        <span>저장 snapshot {run.sourceRecordCount.toLocaleString("ko-KR")}건</span>
                      </td>
                      <td>
                        <strong>성공 {run.successCount.toLocaleString("ko-KR")}</strong>
                        <span>오류 {run.errorCount.toLocaleString("ko-KR")}</span>
                        <span>로그 {run.validationLogCount.toLocaleString("ko-KR")}</span>
                      </td>
                      <td>
                        <Link className="text-link" href={`/admin/imports/${run.id}`}>
                          검수 보기
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
  const reviewRecords = run.records.filter((record) => record.validationErrors.length > 0).length;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Import review" teamScope="both" />
      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Import detail</p>
            <h1>{run.sourceTeam} 데이터 적재</h1>
            <p className="lede">
              원천 row는 DB snapshot으로 보존하고, 이 화면에서는 검수에 필요한 상태와 오류만 먼저 확인합니다.
            </p>
          </div>
          <Link className="primary-link" href="/admin/imports">
            목록으로
          </Link>
        </header>

        <section className="metrics" aria-label="import 상세 요약">
          <Metric label="상태" value={run.status} compact />
          <Metric label="원천 row" value={run.rowCount} />
          <Metric label="성공 row" value={run.successCount} />
          <Metric label="오류 row" value={run.errorCount} />
          <Metric label="검토 row" value={reviewRecords} />
          <Metric label="표시 row" value={run.records.length} />
        </section>

        <section className="detail-grid">
          <div className="detail-panel">
            <span>원천</span>
            <strong>{run.sourceType}</strong>
            <p>원천 파일명과 시트명은 권한 화면이 생기기 전까지 표시하지 않습니다.</p>
          </div>
          <div className="detail-panel">
            <span>실행</span>
            <strong>{run.startedAt}</strong>
            <p>{run.finishedAt || "종료 전"}</p>
          </div>
          <div className="detail-panel">
            <span>메모</span>
            <strong>{run.importedBy || "기록 없음"}</strong>
            <p>{run.notes || "메모 없음"}</p>
          </div>
        </section>

        <section className="table-section">
          <div className="table-header">
            <h2>원천 row 검수</h2>
            <span>최대 200건 표시</span>
          </div>
          {run.records.length === 0 ? (
            <EmptyState title="저장된 원천 row가 없습니다" description="import adapter가 row snapshot을 저장하면 이곳에 표시됩니다." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>검토</th>
                    <th>원천 위치</th>
                    <th>매핑</th>
                    <th>연결</th>
                    <th>생성 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {run.records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        {record.validationErrors.length > 0 ? (
                          <ul className="validation-list">
                            {record.validationErrors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="ok">정상</span>
                        )}
                      </td>
                      <td>
                        <strong>원천 row</strong>
                        <span>
                          row {record.sourceRowNumber}
                          {record.headerRowNumber ? ` · header ${record.headerRowNumber}` : ""}
                        </span>
                        <span>원문 snapshot은 DB에만 보존</span>
                      </td>
                      <td>
                        <strong>표준 {record.mappedFieldCount}개</strong>
                        <span>미매핑 {record.unmappedFieldCount}개</span>
                      </td>
                      <td>
                        <strong>{record.linkedOperationId ? "연결됨" : "미연결"}</strong>
                        <span>{record.sourceFingerprint ? "fingerprint 있음" : "fingerprint 없음"}</span>
                      </td>
                      <td>{record.createdAt}</td>
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

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
