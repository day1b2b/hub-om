/** 암호화 hub-om coach 데이터와 선택적 read-only coach-db 원천의 건수를 검증한다. */
import nextEnv from "@next/env";
import { compareCoachVerificationCounts } from "../src/lib/data/coachDataVerificationRepository";
import { runCoachDataVerificationCli } from "../src/lib/data/coachDataVerificationCliRuntime";
import { readCoachSourceCounts } from "../src/lib/data/coachDataVerificationSource";

async function main() {
  const load = () => { nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} }); };
  const report = await runCoachDataVerificationCli(process.argv.slice(2), process.env, load);
  console.log("[verify-coach-data] 서비스 건수"); console.table(report.serviceCounts);
  console.log("[verify-coach-data] 최근 import"); console.table(report.latestImport ? [report.latestImport] : []);
  console.log("[verify-coach-data] 최근 원본 아카이브");
  console.table(report.latestArchive ? [{ tableCount: report.latestArchive.tableCount, rowCount: report.latestArchive.rowCount,
    status: report.latestArchive.status, finishedAt: report.latestArchive.finishedAt }] : []);
  console.log("[verify-coach-data] 원본 아카이브 주요 테이블"); console.table(report.archiveCounts);
  console.log("[verify-coach-data] 원본 아카이브 ↔ 서비스 테이블");
  if (report.latestArchive) console.table(compareCoachVerificationCounts(report.archiveCounts, report.serviceCounts, true));
  else console.log("[verify-coach-data] 비교 불가: 원본 아카이브 없음");
  load();
  const sourceUrl = process.env.COACH_DB_DATABASE_URL?.trim();
  if (sourceUrl) { console.log("[verify-coach-data] 원본 coach-db live count"); console.table(await readCoachSourceCounts(sourceUrl)); }
  else console.log("[verify-coach-data] 원본 live count 생략");
}
main().catch(() => { console.error("[verify-coach-data] 실패. 인자·암호화 설정·저장소 및 read-only 원천 연결을 점검하세요."); process.exitCode = 1; });
