/** 암호화된 `.local/team-members.json`을 기본 PostgreSQL 또는 명시적 Mongo shadow에 원자 적재한다. */
import nextEnv from "@next/env";
import { runTeamMemberImportCli } from "../src/lib/data/teamMemberImportCliRuntime";
async function main() {
  const { options, result } = await runTeamMemberImportCli(process.argv.slice(2), process.env, () => { nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} }); });
  console.log(`[team-member-import] 모드: ${options.apply ? "apply" : "dry-run"}`);
  console.log(`[team-member-import] 입력 ${result.total}명 / 신규 ${result.inserted}명 / 갱신 ${result.updated}명 / 비활성 ${result.deactivated}명`);
}
main().catch(() => { console.error("[team-member-import] 실패. 인자·암호화 원천 파일·저장소 연결을 점검하세요. 적용 실패 시 전체 변경이 롤백됩니다."); process.exitCode = 1; });
