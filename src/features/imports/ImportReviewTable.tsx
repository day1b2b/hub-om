"use client";

import { useEffect, useState } from "react";
import type {
  SourceRecordFieldPreview,
  SourceRecordPreview,
  SourceRecordReviewStatus
} from "@/lib/data/importTypes";

const REVIEW_STATUS_CLASS: Record<SourceRecordReviewStatus, string> = {
  "적용 준비": "active",
  "확인 필요": "archive-needed",
  "매칭 필요": "needs-assignment"
};

export function ImportReviewTable({
  canPromoteRecords = true,
  records
}: {
  canPromoteRecords?: boolean;
  records: SourceRecordPreview[];
}) {
  const [selectedRecord, setSelectedRecord] = useState<SourceRecordPreview | null>(null);

  useEffect(() => {
    if (!selectedRecord) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedRecord(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRecord]);

  return (
    <>
      <div className="import-review-table-wrap">
        <table className="import-review-table">
          <thead>
            <tr>
              <th>판정</th>
              <th>행</th>
              <th>기업</th>
              <th>과정</th>
              <th>기간</th>
              <th>담당</th>
              <th>연결할 과정</th>
              <th>확인할 점</th>
              <th>상세</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>
                  <span className={`status ${REVIEW_STATUS_CLASS[record.reviewStatus]}`}>{record.reviewStatus}</span>
                </td>
                <td>
                  <strong>{record.sourceRowNumber}행</strong>
                </td>
                <td>{getFieldValue(record, ["companyName", "기업명", "고객사"])}</td>
                <td className="wide-cell">{getFieldValue(record, ["courseName", "과정명", "교육명"])}</td>
                <td>{getPeriodText(record)}</td>
                <td>{getPeopleText(record)}</td>
                <td className="wide-cell">
                  {record.linkedOperation ? (
                    <span>
                      {record.linkedOperation.companyName} · {record.linkedOperation.courseName}
                    </span>
                  ) : isPromotionReady(record, canPromoteRecords) ? (
                    <span className="ready-create-text">새 운영 생성</span>
                  ) : (
                    <span className="needs-review-text">{canPromoteRecords ? "연결 필요" : "검수 전용"}</span>
                  )}
                </td>
                <td className="wide-cell">{getIssueText(record, canPromoteRecords)}</td>
                <td>
                  <button className="import-review-open-button" type="button" onClick={() => setSelectedRecord(record)}>
                    확인
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRecord ? (
        <ImportReviewModal canPromoteRecords={canPromoteRecords} record={selectedRecord} onClose={() => setSelectedRecord(null)} />
      ) : null}
    </>
  );
}

function ImportReviewModal({
  canPromoteRecords,
  onClose,
  record
}: {
  canPromoteRecords: boolean;
  onClose: () => void;
  record: SourceRecordPreview;
}) {
  return (
    <div className="import-review-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="import-review-modal-title"
        aria-modal="true"
        className="import-review-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="import-review-modal-header">
          <div>
            <span className={`status ${REVIEW_STATUS_CLASS[record.reviewStatus]}`}>{record.reviewStatus}</span>
            <h3 id="import-review-modal-title">{record.sourceRowNumber}행 확인</h3>
            <p>
              {getFieldValue(record, ["companyName", "기업명", "고객사"])} ·{" "}
              {getFieldValue(record, ["courseName", "과정명", "교육명"])}
            </p>
          </div>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </header>

        <div className="import-review-modal-body">
          <section className="import-review-modal-section">
            <span className="import-review-label">연결할 과정</span>
            {record.linkedOperation ? (
              <div className="linked-operation-summary">
                <strong>{record.linkedOperation.companyName}</strong>
                <span>{record.linkedOperation.courseName}</span>
                <small>{record.linkedOperation.dateRange}</small>
              </div>
            ) : isPromotionReady(record, canPromoteRecords) ? (
              <p className="ready-create-text">이 행은 새 운영 데이터로 생성할 수 있습니다.</p>
            ) : (
              <p className="needs-review-text">
                {canPromoteRecords ? "아직 연결된 과정이 없습니다." : "이 행은 운영 DB에 반영하지 않고 원천 검수용으로만 보관합니다."}
              </p>
            )}
          </section>

          <section className="import-review-modal-section">
            <span className="import-review-label">확인할 점</span>
            <IssueList canPromoteRecords={canPromoteRecords} record={record} />
          </section>

          <section className="import-review-modal-section">
            <span className="import-review-label">읽어낸 값</span>
            <FieldPreviewList emptyLabel="읽어낸 운영 값이 없습니다." fields={record.mappedFields} />
          </section>

          <section className="import-review-modal-section">
            <span className="import-review-label">원본 값</span>
            <FieldPreviewList emptyLabel="표시할 원본 값이 없습니다." fields={record.rowSnapshotPreview} />
          </section>

          <section className="import-review-modal-section">
            <span className="import-review-label">아직 읽지 못한 값</span>
            <FieldPreviewList emptyLabel="아직 읽지 못한 값이 없습니다." fields={record.unmappedFields} />
          </section>
        </div>

        <footer className="import-review-modal-footer">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </footer>
      </section>
    </div>
  );
}

function IssueList({ canPromoteRecords, record }: { canPromoteRecords: boolean; record: SourceRecordPreview }) {
  if (record.validationErrors.length === 0) {
    return (
      <span className="review-empty-inline">
        {isPromotionReady(record, canPromoteRecords) ? "반영 가능한 행입니다." : "기본 검증을 통과했습니다."}
      </span>
    );
  }

  return (
    <ul className="import-review-issues">
      {record.validationErrors.map((issue) => (
        <li key={issue}>{issue}</li>
      ))}
    </ul>
  );
}

function FieldPreviewList({ emptyLabel, fields }: { emptyLabel: string; fields: SourceRecordFieldPreview[] }) {
  if (fields.length === 0) {
    return <span className="review-empty-inline">{emptyLabel}</span>;
  }

  return (
    <dl className="field-preview-list">
      {fields.map((field) => (
        <div key={`${field.key}-${field.label}`}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function getFieldValue(record: SourceRecordPreview, keys: string[]) {
  const field = [...record.mappedFields, ...record.rowSnapshotPreview].find((field) => {
    const normalizedKey = field.key.toLowerCase();
    const normalizedLabel = field.label.toLowerCase();

    return keys.some((key) => normalizedKey === key.toLowerCase() || normalizedLabel === key.toLowerCase());
  });

  return field?.value || "-";
}

function getPeriodText(record: SourceRecordPreview) {
  const startDate = getFieldValue(record, ["startDate", "시작일"]);
  const endDate = getFieldValue(record, ["endDate", "종료일"]);

  if (startDate === "-" && endDate === "-") return "-";
  if (startDate === endDate) return startDate;
  return `${startDate} - ${endDate}`;
}

function getPeopleText(record: SourceRecordPreview) {
  const om = getFieldValue(record, ["om", "OM", "운영매니저"]);
  const ld = getFieldValue(record, ["ld", "LD", "러닝디자이너"]);

  return [om !== "-" ? `OM ${om}` : "", ld !== "-" ? `LD ${ld}` : ""].filter(Boolean).join(" · ") || "-";
}

function getIssueText(record: SourceRecordPreview, canPromoteRecords: boolean) {
  if (record.validationErrors.length > 0) return record.validationErrors.join(" / ");
  if (!canPromoteRecords) return "원천 검수 전용";
  if (isPromotionReady(record, canPromoteRecords)) return "반영 가능";
  if (!record.linkedOperation) return "과정 연결 필요";
  return "기본 검증 통과";
}

function isPromotionReady(record: SourceRecordPreview, canPromoteRecords: boolean) {
  return (
    canPromoteRecords &&
    record.reviewStatus === "적용 준비" &&
    Boolean(
      getFieldValue(record, ["companyName", "기업명", "고객사"]) !== "-" &&
        getFieldValue(record, ["courseName", "과정명", "교육명"]) !== "-" &&
        parseDateValue(getFieldValue(record, ["startDate", "시작일"])) &&
        parseDateValue(getFieldValue(record, ["endDate", "종료일"]))
    )
  );
}

function parseDateValue(value: string) {
  const normalized = value.trim().replace(/[./]/g, "-");
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);

  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}
