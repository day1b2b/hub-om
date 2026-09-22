import type { CoachEngagement, CoachPrivateProfile } from "@prisma/client";
import type { CoachPrivateRepository } from "./coachPrivateRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { COACH_READ_MODELS, assertMongoReadStoreReady } from "./mongoReadStore";
import { coachDate, coachRead, compareEngagements } from "./mongoCoachMapping";
/** Caller retains the existing PII authorization/audit responsibility. No factory wiring. */
export class MongoCoachPrivateRepository implements CoachPrivateRepository {
  private readonly store: MongoOperationStore;
  private constructor(store: MongoOperationStore) { this.store = store; }
  static async open(options: MongoOperationOptions) {
    return coachRead(async () => {
    const store = new MongoOperationStore(options, COACH_READ_MODELS);
    await assertMongoReadStoreReady(store);
    return new MongoCoachPrivateRepository(store);
    });
  }
  async getPrivateProfile(coachId: string) {
    return coachRead(async () => {
      const row = await this.store.one("CoachPrivateProfile", { _id: coachId }) as unknown as CoachPrivateProfile | null;
      return row ? { coachId: row.coachId, employeeId: row.employeeId, phone: row.phone, email: row.email,
        birthDate: row.birthDate ? coachDate(row.birthDate) : null, affiliation: row.affiliation } : null;
    });
  }
  async getEngagementFeedback(coachId: string) {
    return coachRead(async () => {
      const rows = await this.store.scan("CoachEngagement", { coachId }) as unknown as CoachEngagement[];
      return rows.sort(compareEngagements).map(row => ({ engagementId: row.id, feedback: row.feedback, hiredByText: row.hiredByText }));
    });
  }
}
