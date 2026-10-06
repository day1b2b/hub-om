import type { JsonObject, mapPageToInstructor } from "../instructors/notionInstructorMap";

export type InstructorNotionRecord = NonNullable<ReturnType<typeof mapPageToInstructor>>;
export interface InstructorNotionMatch {
  target: { id: string; instructorName: string; recruitAvoid: boolean } | null;
  by: "notionNo" | "legacy" | "none";
}
export interface InstructorNotionSyncRepository {
  /** Original synchronous client configuration check, after source collection and before any row. */
  initialize(): void;
  findMatch(record: InstructorNotionRecord): Promise<InstructorNotionMatch>;
  /** One source row; implementations must preserve fields owned by manual editing. */
  applyRecord(record: InstructorNotionRecord): Promise<"created" | "updated">;
}
export interface InstructorNotionSource { readPages(): Promise<JsonObject[]> }
