/** coach-db를 read-only snapshot으로 읽어 암호화 coach 저장소에 반영한다. */
import { config } from "dotenv";
import { disconnectPrismaClient } from "../src/lib/data/prisma";
import { runCoachDbImportCli } from "../src/lib/data/coachDbImportCliRuntime";
async function main(){config({path:".env.local"});config({path:".env"});try{const{options,summary}=await runCoachDbImportCli(process.argv.slice(2),process.env,()=>{});console.log(`[import-coach-db] ${options.apply?"apply 완료":"dry-run 완료 (쓰기 0)"}: 코치 ${summary.coachCount} / 투입 ${summary.engagementCount} / 스케줄 ${summary.scheduleCount} / 운영매칭 ${summary.matchedOperationCount}건 / 미매칭 ${summary.unmatchedOperationCount}건${summary.errorCount?` / 에러 ${summary.errorCount}건`:""}`);}finally{await disconnectPrismaClient();}}
void main().catch(()=>{console.error("[import-coach-db] 실행에 실패했습니다.");process.exitCode=1;});
