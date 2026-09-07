export interface PendingLectureNote {
  value: string;
  editVersion: number;
}

/** 닫기 중 추가된 입력까지 저장됐을 때만 true. 계속 편집하면 창을 유지하고 자동 저장에 맡긴다. */
export async function flushLectureNote(
  getPending: () => PendingLectureNote,
  save: (value: string, editVersion: number) => Promise<boolean>
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = getPending();
    if (!(await save(target.value, target.editVersion))) return false;
    if (getPending().value === target.value) return true;
  }
  return false;
}
