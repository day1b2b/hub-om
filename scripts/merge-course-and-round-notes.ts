import { config } from "dotenv";
import { runMergeCourseAndRoundNotesCli } from "../src/lib/data/mergeCourseAndRoundNotesCliRuntime";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  console.log(`[merge-course-and-round-notes] 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const summary = await runMergeCourseAndRoundNotesCli(args, process.env, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });
  const { specialNotes, operationIssue, omUpdate } = summary.summaryByField;
  console.log(`[merge-course-and-round-notes] 과정 ${summary.courseCount}건, 실제 반영 ${summary.updatedCount}건`);
  console.log(`[merge-course-and-round-notes] 특이사항/이슈 — 변경 없음 ${specialNotes.unchanged}건, 이어붙임 발생 ${specialNotes.merged}건`);
  console.log(`[merge-course-and-round-notes] 회고(OM+LD) — 변경 없음 ${operationIssue.unchanged}건, 이어붙임 발생 ${operationIssue.merged}건`);
  console.log(`[merge-course-and-round-notes] 메모 — 변경 없음 ${omUpdate.unchanged}건, 이어붙임 발생 ${omUpdate.merged}건`);
}

main().catch(() => {
  console.error("[merge-course-and-round-notes] 실패. DB 연결과 실행 조건을 확인하세요.");
  process.exitCode = 1;
});
