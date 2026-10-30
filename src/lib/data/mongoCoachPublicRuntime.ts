import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { INSTRUCTOR_NOTE_MODELS, MongoInstructorNoteRepository } from "./mongoInstructorNoteRepository";
import { MongoCoachRepository } from "./mongoCoachRepository";
import { MongoCoachEvaluationRepository } from "./mongoCoachEvaluationRepository";
import { MongoOperationRepository } from "./mongoOperationRepository";
import { MongoOperationStore, OPERATION_MODELS, prepareMongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { COACH_READ_MODELS, prepareMongoReadStore } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoSessionSurveyResultRepository, SESSION_SURVEY_RESULT_MODELS } from "./mongoSessionSurveyResultRepository";

type ScopeKey = "operations" | "instructorNote" | "coach" | "sessionSurveyResults";
// 평가는 선택: 평가 컬렉션이 아직 준비되지 않은 운영에서도 코치 화면은 열려야 한다(평균은 예전 평점으로 표시).
export type MongoCoachPublicRepositories = Readonly<Pick<DataRepositories, ScopeKey> & Partial<Pick<DataRepositories, "coachEvaluation">>>;
type Options = MongoOperationOptions & { allowShadowWrites: true };
export const MONGO_COACH_PUBLIC_RUNTIME_MODELS = [...new Set([
  ...OPERATION_MODELS, ...INSTRUCTOR_NOTE_MODELS, ...COACH_READ_MODELS, ...SESSION_SURVEY_RESULT_MODELS
])] as readonly string[];

export interface MongoCoachPublicRuntime {
  readonly repositories: MongoCoachPublicRepositories;
  run<T>(work: () => T): T;
}

/** Test/bootstrap boundary. Existing namespaces receive a read-only readiness check. */
export async function prepareMongoCoachPublicRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoCoachPublicRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_PUBLIC_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoOperationStore(options);
      await prepareMongoReadStore(options, INSTRUCTOR_NOTE_MODELS);
      await prepareMongoReadStore(options, COACH_READ_MODELS);
      await prepareMongoReadStore(options, SESSION_SURVEY_RESULT_MODELS);
    }
    return await openMongoCoachPublicRuntime(options);
  } catch { throw new Error("MONGO_COACH_PUBLIC_RUNTIME_FAILED"); }
}

/** Opens prepared storage only; request handling never creates or repairs collections. */
export async function openMongoCoachPublicRuntime(options: Options): Promise<MongoCoachPublicRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_PUBLIC_RUNTIME_MODELS);
    // 강사 위키의 수강생 코멘트는 읽기만 한다(쓰기는 만족도 반영 런타임만).
    const [operations, instructorNote, coach, sessionSurveyResults] = await Promise.all([
      MongoOperationRepository.open(options), MongoInstructorNoteRepository.open(options), MongoCoachRepository.open(options),
      MongoSessionSurveyResultRepository.open({ client: options.client, databaseName: options.databaseName, namespace: options.namespace })
    ]);
    const coachEvaluation = await MongoCoachEvaluationRepository.open(options).catch(() => undefined);
    const repositories: MongoCoachPublicRepositories = Object.freeze(coachEvaluation
      ? { operations, instructorNote, coach, sessionSurveyResults, coachEvaluation }
      : { operations, instructorNote, coach, sessionSurveyResults });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_COACH_PUBLIC_RUNTIME_FAILED"); }
}
