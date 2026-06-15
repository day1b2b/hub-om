import Link from "next/link";
import { AppSidebar } from "@/components/AppSidebar";
import { ImportUploadPanel } from "./ImportUploadPanel";
import type {
  ImportRunDetail,
  ImportRunSummary,
  ImportRunStatus,
  SourceRecordFieldPreview,
  SourceRecordPreview,
  SourceRecordReviewStatus
} from "@/lib/data/importTypes";

const STATUS_CLASS: Record<ImportRunStatus, string> = {
  "대기": "planned-assignment",
  "완료": "active",
  "오류있음": "archive-needed",
  "실패": "needs-assignment"
};

const REVIEW_STATUS_CLASS: Record<SourceRecordReviewStatus, string> = {
  "적용 준비": "active",
  "확인 필요": "archive-needed",
  "매칭 필요": "needs-assignment"
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
      <AppSidebar label="데이터 가져오기" teamScope="both" />
      <section className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">데이터 가져오기</p>
            <h1>운영 데이터를 올리고 확인하기</h1>
            <p className="lede">파일이나 API로 가져온 데이터를 먼저 확인한 뒤, 필요한 값만 운영 데이터에 반영합니다.</p>
          </div>
          <Link className="primary-link" href="/">
            운영 목록
          </Link>
        </header>

        <section className="metrics import-compact-metrics" aria-label="가져오기 요약">
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
              title="아직 가져온 데이터가 없습니다"
              description="CSV 또는 JSON 파일을 올리면 이곳에 검토할 묶음이 생깁니다."
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
  const readyRecords = run.records.filter((record) => record.reviewStatus === "적용 준비").length;
  const needsFixRecords = run.records.filter((record) => record.reviewStatus === "확인 필요").length;
  const matchingRecords = run.records.filter((record) => record.reviewStatus === "매칭 필요").length;

  return (
    <main className="dashboard-shell">
      <AppSidebar label="데이터 가져오기" teamScope="both" />
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

        <section className="import-review-summary" aria-label="검토 판단 요약">
          <div>
            <span>맞음</span>
            <strong>{readyRecords.toLocaleString("ko-KR")}</strong>
            <small>읽어낸 값과 과정 연결이 모두 확인된 행</small>
          </div>
          <div>
            <span>수정 필요</span>
            <strong>{needsFixRecords.toLocaleString("ko-KR")}</strong>
            <small>날짜/필수값 등 사람이 확인해야 하는 행</small>
          </div>
          <div>
            <span>연결 필요</span>
            <strong>{matchingRecords.toLocaleString("ko-KR")}</strong>
            <small>어느 과정에 반영할지 아직 못 찾은 행</small>
          </div>
          <button disabled type="button">
            검토 결과 저장 준비중
          </button>
        </section>

        <section className="detail-grid">
          <div className="detail-panel">
            <span>가져온 방식</span>
            <strong>{getSourceTypeLabel(run.sourceType)}</strong>
            <p>파일 업로드 또는 API 가져오기 결과입니다.</p>
          </div>
          <div className="detail-panel">
            <span>가져온 시각</span>
            <strong>{run.startedAt}</strong>
            <p>{run.finishedAt || "종료 전"}</p>
          </div>
          <div className="detail-panel">
            <span>올린 사람</span>
            <strong>{run.importedBy || "기록 없음"}</strong>
            <p>{run.notes || "메모 없음"}</p>
          </div>
        </section>

        <section className="import-review-flow" aria-label="데이터 반영 단계">
          <ReviewStep title="1. 가져오기" description="파일 또는 API에서 데이터를 가져왔습니다." state="done" />
          <ReviewStep title="2. 확인하기" description="읽어낸 값과 연결할 과정을 확인합니다." state="current" />
          <ReviewStep title="3. 반영하기" description="선택한 값만 운영 데이터에 반영합니다." state="locked" />
        </section>

        <section className="table-section">
          <div className="table-header">
            <div>
              <h2>행별 확인</h2>
              <p>읽어낸 값, 연결할 과정, 확인할 점을 봅니다.</p>
            </div>
            <span>최대 200건 표시</span>
          </div>
          {run.records.length === 0 ? (
            <EmptyState title="저장된 행이 없습니다" description="파일을 다시 올리거나 가져오기 설정을 확인해 주세요." />
          ) : (
            <div className="import-review-list">
              {run.records.map((record) => (
                <SourceRecordReviewCard key={record.id} record={record} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function SourceRecordReviewCard({ record }: { record: SourceRecordPreview }) {
  return (
    <article className="import-review-card">
      <header className="import-review-card-header">
        <div>
          <span className={`status ${REVIEW_STATUS_CLASS[record.reviewStatus]}`}>{record.reviewStatus}</span>
          <h3>
            {record.sourceRowNumber}행
            {record.headerRowNumber ? ` · header ${record.headerRowNumber}` : ""}
          </h3>
          <p>
            {record.createdAt} · {record.sourceFingerprint ? "중복 확인됨" : "중복 확인 정보 없음"}
          </p>
        </div>
        <button type="button" disabled>
          반영 준비중
        </button>
      </header>

      <div className="import-decision-strip" aria-label="행 판별 상태">
        <DecisionPill good={record.mappedFields.length > 0} label={record.mappedFields.length > 0 ? "값 읽음" : "값 없음"} />
        <DecisionPill good={Boolean(record.linkedOperation)} label={record.linkedOperation ? "과정 연결됨" : "과정 연결 필요"} />
        <DecisionPill good={record.validationErrors.length === 0} label={record.validationErrors.length === 0 ? "오류 없음" : "수정 필요"} />
      </div>

      <div className="import-review-card-body">
        <section className="import-review-column">
          <span className="import-review-label">읽어낸 값</span>
          <FieldPreviewList emptyLabel="읽어낸 운영 값이 없습니다." fields={record.mappedFields} />
        </section>

        <section className="import-review-column">
          <span className="import-review-label">연결할 과정</span>
          {record.linkedOperation ? (
            <div className="linked-operation-preview">
              <strong>{record.linkedOperation.companyName}</strong>
              <span>{record.linkedOperation.courseName}</span>
              <small>
                {record.linkedOperation.operationId} · {record.linkedOperation.dateRange}
              </small>
            </div>
          ) : (
            <div className="review-empty">
              <strong>아직 연결된 과정이 없습니다</strong>
              <span>기업명, 과정명, 기간을 보고 연결할 과정 후보를 찾는 단계가 필요합니다.</span>
            </div>
          )}
        </section>

        <section className="import-review-column">
          <span className="import-review-label">확인할 점</span>
          {record.validationErrors.length > 0 ? (
            <ul className="validation-list">
              {record.validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : (
            <span className="ok">기본 검증 통과</span>
          )}
        </section>
      </div>

      <details className="import-review-details">
        <summary>원본 값 / 아직 읽지 못한 값 보기</summary>
        <div className="import-review-details-grid">
          <section>
            <span className="import-review-label">원본 값</span>
            <FieldPreviewList emptyLabel="표시할 원본 값이 없습니다." fields={record.rowSnapshotPreview} />
          </section>
          <section>
            <span className="import-review-label">아직 읽지 못한 값</span>
            <FieldPreviewList emptyLabel="아직 읽지 못한 값이 없습니다." fields={record.unmappedFields} />
          </section>
        </div>
      </details>
    </article>
  );
}

function DecisionPill({ good, label }: { good: boolean; label: string }) {
  return <span className={`decision-pill ${good ? "good" : "needs-review"}`}>{label}</span>;
}

function FieldPreviewList({ emptyLabel, fields }: { emptyLabel: string; fields: SourceRecordFieldPreview[] }) {
  if (fields.length === 0) {
    return <span className="review-empty-inline">{emptyLabel}</span>;
  }

  return (
    <dl className="field-preview-list">
      {fields.map((field) => (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReviewStep({
  description,
  state,
  title
}: {
  description: string;
  state: "done" | "current" | "locked";
  title: string;
}) {
  return (
    <div className={`import-review-step ${state}`}>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
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

  if (normalizedType.includes("slack")) {
    return "Slack 데이터";
  }

  if (normalizedType.includes("json")) {
    return "JSON 파일";
  }

  return "가져온 데이터";
}

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
