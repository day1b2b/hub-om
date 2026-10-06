import type { InstructorNotionSyncRepository } from "../data/instructorNotionSyncRepository";
import { emptySyncResult, type SyncResult } from "../coaches/syncTypes";
import { mapPageToInstructor, type JsonObject } from "./notionInstructorMap";

export async function runNotionInstructorSync(pages: JsonObject[], repository: InstructorNotionSyncRepository, dryRun: boolean): Promise<SyncResult> {
  const result = emptySyncResult(dryRun);
  result.totalRows = pages.length;
  // Even empty/all-skipped input performed this check in the original workflow.
  try { repository.initialize(); }
  catch { throw new Error("INSTRUCTOR_NOTION_INITIALIZE_FAILED"); }

  for (const page of pages) {
    let record: ReturnType<typeof mapPageToInstructor>;
    // Mapping failure remains a whole-request error, after any already committed rows.
    try { record = mapPageToInstructor(page); }
    catch { throw new Error("INSTRUCTOR_NOTION_MAPPING_FAILED"); }
    if (!record) { result.skipped++; continue; }
    try {
      if (dryRun) {
        const { target, by } = await repository.findMatch(record);
        const { name, notionNo } = record;
        result.changes?.push({
          coachName: name,
          action: target ? "update_notion" : "create_notion",
          details: !target ? "신규 강사" : by === "legacy" ? `NO ${notionNo} 연결(예전 행)`
            : target.instructorName !== name ? `이름 변경 ${target.instructorName} → ${name}` : "노션 프로필 갱신"
        });
        if (target) result.updated++; else result.created++;
      } else {
        const outcome = await repository.applyRecord(record);
        if (outcome === "created") result.created++; else result.updated++;
      }
    } catch {
      result.errors++;
      result.errorDetail.push("INSTRUCTOR_NOTION_ROW_FAILED");
    }
  }
  return result;
}
