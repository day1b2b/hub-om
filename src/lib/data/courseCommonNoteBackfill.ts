import type { CourseCommonNoteInput, OperationSession } from "./operationTypes";

const fields = ["specialNotes", "operationIssue", "omUpdate"] as const;
type NoteField = typeof fields[number];

export interface CourseCommonNoteBackfillCandidate {
  courseRecordId: string;
  input: CourseCommonNoteInput;
}

export interface CourseCommonNoteBackfillPlan {
  courseCount: number;
  candidateCount: number;
  conflictCourseCount: number;
  skippedExistingFieldCount: number;
  candidates: CourseCommonNoteBackfillCandidate[];
}

function normalized(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

export function planCourseCommonNoteBackfill(operations: OperationSession[]): CourseCommonNoteBackfillPlan {
  const courses = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    if (!operation.courseRecordId) continue;
    const group = courses.get(operation.courseRecordId) ?? [];
    group.push(operation);
    courses.set(operation.courseRecordId, group);
  }

  const candidates: CourseCommonNoteBackfillCandidate[] = [];
  let conflictCourseCount = 0;
  let skippedExistingFieldCount = 0;
  for (const [courseRecordId, rounds] of courses) {
    const existing = rounds.find(round => round.courseCommonNote)?.courseCommonNote;
    const input: CourseCommonNoteInput = {
      specialNotes: existing?.specialNotes ?? "",
      operationIssue: existing?.operationIssue ?? "",
      omUpdate: existing?.omUpdate ?? "",
    };
    let changed = false;
    let conflicted = false;
    for (const field of fields) {
      if (normalized(input[field])) {
        skippedExistingFieldCount++;
        continue;
      }
      const values = [...new Set(rounds.map(round => normalized(round[field])).filter(Boolean))];
      if (values.length === 1) {
        input[field] = values[0];
        changed = true;
      } else if (values.length > 1) {
        conflicted = true;
      }
    }
    if (conflicted) conflictCourseCount++;
    if (changed) candidates.push({ courseRecordId, input });
  }
  return { courseCount: courses.size, candidateCount: candidates.length, conflictCourseCount, skippedExistingFieldCount, candidates };
}
