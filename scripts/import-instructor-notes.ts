/** `.local/instructor-wiki.json`의 개인정보 제거 사본을 강사노트 저장소로 원자 적재한다. */
import nextEnv from "@next/env";
import { runInstructorNoteImportCli } from "../src/lib/data/instructorNoteImportCliRuntime";

async function main() {
  const { options, result } = await runInstructorNoteImportCli(process.argv.slice(2), process.env, () => {
    nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  });
  console.log(`[instructor-note-import] 모드: ${options.apply ? "apply" : "dry-run"}`);
  console.log(`[instructor-note-import] 강사 ${result.total}명 / 신규 ${result.inserted}명 / 갱신 ${result.updated}명`);
  console.log("[instructor-note-import] 연락처·이메일·생년월일과 자유 입력란의 연락처·이메일 원문은 저장·출력하지 않습니다.");
}
main().catch(() => { console.error("[instructor-note-import] 실패. 인자·원천 파일·저장소 연결을 점검하세요. 쓰기 실패 시 전체 변경이 롤백됩니다."); process.exitCode = 1; });
