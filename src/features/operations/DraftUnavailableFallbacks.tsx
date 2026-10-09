import type { OperationSession } from "@/lib/data/operationTypes";
import { LOCKED_DRAFT_NOTICE } from "./operationDraftSession";
import { lockedIssueValues, lockedSavedHref } from "./draftUnavailableFallback";

export function LockedLectureManagementNoteRow({ done, value }: { done: boolean; value: string }) {
  const savedValue = value;
  const href = lockedSavedHref(savedValue);

  return (
    <div className={`archive-item-row ${done ? "done" : "missing"}`}>
      <div className="archive-item-actions">
        {href ? (
          <a aria-label="등록 정보 확인" className="table-link-icon" href={href} rel="noreferrer" target="_blank">
            ↗
          </a>
        ) : savedValue ? <span>{savedValue}</span> : null}
        <button className="archive-item-edit-trigger" disabled title={LOCKED_DRAFT_NOTICE} type="button">
          {done ? "수정" : "등록"}
        </button>
      </div>
    </div>
  );
}

export function LockedIssueReviewEditor({ operation }: { operation: OperationSession }) {
  return (
    <div className="issue-editor">
      <p role="status">{LOCKED_DRAFT_NOTICE} 저장된 내용은 아래에서 확인할 수 있습니다.</p>
      <fieldset disabled style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="issue-editor-grid">
          {lockedIssueValues(operation).map(({ field, label, value }) => (
            <div className="issue-editor-field" key={field}>
              <div className="issue-editor-field-head"><label htmlFor={`issue-editor-${field}`}>{label}</label></div>
              <textarea id={`issue-editor-${field}`} rows={4} value={value} readOnly />
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function LockedDriveImportPanel({ operation }: { operation: OperationSession }) {
  const href = lockedSavedHref(operation.driveLink);

  return (
    <div className="drive-import-panel">
      <p role="status">{LOCKED_DRAFT_NOTICE} 저장된 Drive 링크는 계속 확인할 수 있습니다.</p>
      {href ? <a href={href} rel="noreferrer" target="_blank">저장된 Drive 링크 열기</a> : null}
    </div>
  );
}
