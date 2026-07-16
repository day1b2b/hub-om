"use client";

import { useEditAllRoundsSignal } from "./EditAllRoundsProvider";

export function BulkSaveRoundsButton() {
  const editAllContext = useEditAllRoundsSignal();

  if (!editAllContext || editAllContext.editingRowCount === 0) {
    return null;
  }

  const isSaving = editAllContext.saveAllState === "saving";

  return (
    <div className="bulk-save-rounds-bar">
      <button className="primary-action" disabled={isSaving} onClick={editAllContext.saveAll} type="button">
        {isSaving ? "저장 중" : "일괄 저장"}
      </button>
      {editAllContext.saveAllState === "failed" ? (
        <span className="archive-item-save-error">
          {editAllContext.saveAllFailedCount}건 저장하지 못했습니다. 실패한 회차의 오류를 확인해주세요.
        </span>
      ) : null}
    </div>
  );
}
