import { config } from "dotenv";
import { runSyncupRequestNoteCleanupCli } from "../src/lib/data/syncupRequestNoteCleanupCliRuntime";

// 2026-10-14 이전 업무 요청의 "요청사항"이 싱크업 칸에 들어간 회차(e4ccfb04로 코드만 고침)를 정리한다.
// 기본은 조회(dry-run). --apply는 --backup-confirmed --maintenance-confirmed와 함께만 쓴다.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const tag = "[cleanup-syncup-request-notes]";
  console.log(`${tag} 모드: ${apply ? "apply (실제 쓰기)" : "dry-run (쓰기 없음)"}`);
  const { plan, clearedRounds, updatedCommonNotes } = await runSyncupRequestNoteCleanupCli(args, process.env, () => {
    config({ path: ".env.local" });
    config({ path: ".env" });
  });
  console.log(`${tag} 싱크업 값 있는 회차 ${plan.roundsWithValue}건 = 링크(유지) ${plan.linkRounds}건 + 요청사항 문장(정리 대상) ${plan.requestNoteRounds}건 + 링크 아닌 다른 글자(직접 확인) ${plan.manualRounds}건`);
  console.log(`${tag} 정리 대상 과정 ${plan.courses.length}건, 공통 메모 특이사항에 옮길 과정 ${plan.courses.filter((course) => course.commonNoteChanged).length}건`);
  console.log(`${tag} 실제 반영: 싱크업 비운 회차 ${clearedRounds}건, 공통 메모 저장 ${updatedCommonNotes}건`);
  if (plan.manual.length) {
    console.log(`${tag} 직접 확인 ${plan.manual.length}건 (값은 출력하지 않음, 관리자 엑셀 다운로드에서 확인):`);
    for (const item of plan.manual) console.log(`  - ${item.companyName} / ${item.courseName} / ${item.roundNo}회차 (operationId=${item.operationId})`);
  }
}

main().catch(() => {
  console.error("[cleanup-syncup-request-notes] 실패. DB 연결과 실행 조건을 확인하세요.");
  process.exitCode = 1;
});
