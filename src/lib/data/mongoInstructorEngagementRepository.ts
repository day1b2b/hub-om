// InstructorEngagementRepository의 라이브(Mongo-shadow) 읽기 구현. 코치 MongoCoachRepository.listEngagements 미러(강사판).
// 투입 이력에 교육형태를 붙이려고 OperationSession을 읽기만 한다(준비·검증기는 운영/강사 쓰기 저장소 몫).
import { MongoOperationStore, MongoOperationError, type MongoOperationOptions } from "./mongoOperationStore";
import { assertMongoReadStoreReady } from "./mongoReadStore";
import { isOperationBackedSourceId } from "../coaches/operationBacked";
import { coachLinkedSession, type CoachLinkedSessionRow } from "./coachLinkedSession";
import type { CoachEngagementStatusValue } from "./coachTypes";
import type { InstructorEngagementRepository, InstructorEngagementView } from "./instructorEngagementRepository";

const INSTRUCTOR_ENGAGEMENT_READ_MODELS = ["InstructorEngagement", "OperationSession"] as const;
const INSTRUCTOR_ENGAGEMENT_STATUS: Record<string, CoachEngagementStatusValue> = {
  SCHEDULED: "scheduled", IN_PROGRESS: "in_progress", COMPLETED: "completed", CANCELLED: "cancelled"
};
const toDateString = (value: Date) => value.toISOString().slice(0, 10);

async function instructorRead<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof MongoOperationError) throw error; throw new MongoOperationError("INSTRUCTOR_READ_FAILED"); }
}

/** Parallel shadow reads only. Like the PG adapter, separate relation reads are not a single snapshot. */
export class MongoInstructorEngagementRepository implements InstructorEngagementRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }

  static async open(options: MongoOperationOptions): Promise<MongoInstructorEngagementRepository> {
    return instructorRead(async () => {
      const store = new MongoOperationStore(options, INSTRUCTOR_ENGAGEMENT_READ_MODELS);
      await assertMongoReadStoreReady(store);
      return new MongoInstructorEngagementRepository(store);
    });
  }

  async listEngagements(instructorNoteId: string): Promise<InstructorEngagementView[]> {
    return instructorRead(async () => {
      const rows = await this.store.scan("InstructorEngagement", { instructorNoteId });
      const sessionIds = [...new Set(rows.flatMap(row => row.operationSessionId ? [row.operationSessionId as string] : []))];
      const sessions = new Map(sessionIds.length
        ? (await this.store.scan("OperationSession", { _id: { $in: sessionIds } })).map(row => [row.id as string, row as unknown as CoachLinkedSessionRow])
        : []);
      return rows
        .sort((a, b) => {
          const byDate = toDateString(b.startDate as Date).localeCompare(toDateString(a.startDate as Date));
          return byDate !== 0 ? byDate : (a.id as string).localeCompare(b.id as string);
        })
        .map(row => ({
          id: row.id as string,
          courseName: row.courseName as string,
          operationSessionId: (row.operationSessionId as string | null) ?? null,
          status: INSTRUCTOR_ENGAGEMENT_STATUS[row.status as string],
          source: (row.source as string).toLowerCase(),
          startDate: toDateString(row.startDate as Date),
          endDate: toDateString(row.endDate as Date),
          startTime: (row.startTime as string | null) ?? null,
          endTime: (row.endTime as string | null) ?? null,
          linkedSession: coachLinkedSession(row.operationSessionId ? sessions.get(row.operationSessionId as string) : null),
          operationBacked: isOperationBackedSourceId(row.sourceEngagementId as string)
        }));
    });
  }
}

export { INSTRUCTOR_ENGAGEMENT_READ_MODELS };
