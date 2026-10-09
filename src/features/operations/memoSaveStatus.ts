export type MemoSaveState = "idle" | "saving" | "saved" | "failed";

export function memoSaveStatusText(state: MemoSaveState, hasChanges: boolean, savedTime: string | null) {
  if (state === "saving") return "저장 중…";
  if (state === "failed") return "저장하지 못했습니다. 다시 시도해 주세요.";
  if (state === "saved" && savedTime) return `저장됨 · ${savedTime}`;
  return hasChanges ? "저장하지 않은 변경 사항" : "변경 사항 없음";
}

export function confirmedSaveTime(value: Date) {
  return value.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
