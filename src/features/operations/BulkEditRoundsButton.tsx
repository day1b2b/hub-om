"use client";

import { useEditAllRoundsSignal } from "./EditAllRoundsProvider";

export function BulkEditRoundsButton() {
  const editAllContext = useEditAllRoundsSignal();

  if (!editAllContext) {
    return null;
  }

  return (
    <button className="secondary-action add-round-trigger" onClick={editAllContext.triggerEditAll} type="button">
      일괄 수정
    </button>
  );
}
