// 운영현황 '강사'(instructorsText) → 그 회차의 MANUAL 투입(InstructorEngagement) 백필 커맨드. 코치 sessionCoachSyncCommand 미러.
// 정본=운영현황 강사(OM 확정값). 삭제되지 않은 회차만 읽어, 강사위키 명부(InstructorNote)로 이름을 풀고
// syncSessionInstructors로 생성/전환(CONTRACT→MANUAL)/취소를 계획·실행한다. 삭제는 하지 않는다.
//
// 저장소(읽기·쓰기)는 SessionInstructorSyncRepository 뒤로 숨긴다. 기본=Postgres(prismaSessionInstructorSyncRepository),
// scoped override가 있으면 그걸 쓴다(Mongo-shadow 라우팅용 — sessionInstructorSyncCliRuntime이 주입).
import { disconnectPrismaClient } from "../data/prisma";
import { getDataRepositoryOverride } from "../data/dataRepositoryContext";
import { getPrismaSessionInstructorSyncRepository } from "../data/prismaSessionInstructorSyncRepository";
import type { SessionInstructorSyncRepository } from "../data/sessionInstructorSyncRepository";
import { normalizeInstructorName } from "./instructorContractMatch";
import {
  syncSessionInstructors,
  type SessionInstructorSyncResult,
  type SessionInstructorWriter,
  type SyncInstructor
} from "./sessionInstructorSyncWorkflow";

const CHUNK_SIZE = 50;

/** dry-run에서 실수로 쓰기가 일어나면 즉시 터뜨린다(쓰기 없음 보장). */
const DRY_RUN_WRITER: SessionInstructorWriter = {
  async createEngagement() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async replaceSchedules() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async convertToManual() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async reactivateEngagements() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async cancelEngagements() { throw new Error("dry-run에서는 쓰지 않는다"); }
};

/** 정규화 이름이 겹치는 강사는 모두 빼서(동명이인 오배정 방지) 그 이름은 unmatched로 떨어지게 한다. */
function rosterWithoutNameCollisions(instructors: ReadonlyArray<{ id: string; name: string }>): SyncInstructor[] {
  const byName = new Map<string, Array<{ id: string; name: string }>>();
  for (const instructor of instructors) {
    const key = normalizeInstructorName(instructor.name);
    byName.set(key, [...(byName.get(key) ?? []), instructor]);
  }
  const out: SyncInstructor[] = [];
  for (const group of byName.values()) if (group.length === 1) out.push({ id: group[0].id, name: group[0].name });
  return out;
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function mergeResult(into: SessionInstructorSyncResult, part: SessionInstructorSyncResult): void {
  into.checkedSessions += part.checkedSessions;
  into.created += part.created;
  into.converted += part.converted;
  into.reactivated += part.reactivated;
  into.cancelled += part.cancelled;
  into.unmatched.push(...part.unmatched);
}

interface Dependencies {
  getDefaultRepository(): SessionInstructorSyncRepository;
  closeDefaultRepository(): Promise<void>;
}
const defaults: Dependencies = { getDefaultRepository: getPrismaSessionInstructorSyncRepository, closeDefaultRepository: disconnectPrismaClient };

/**
 * 커맨드 본체: 회차·명부·기존 투입을 읽어 동기화 계획을 세우고(기본 dry-run) 또는 실행(--apply)한다.
 * 읽기는 트랜잭션 밖에서 하고, 쓰기만 청크 트랜잭션(카탈로그 락) 안에서 한다.
 * scoped override(Mongo)가 있으면 env 로드·Prisma 생성/disconnect를 전부 건너뛴다(라이브 Mongo 경로).
 */
export async function runSessionInstructorSync(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults): Promise<SessionInstructorSyncResult> {
  const scoped = getDataRepositoryOverride("sessionInstructorSync");
  if (!scoped) loadEnvironment();
  const repository = scoped ?? dependencies.getDefaultRepository();
  const apply = args.includes("--apply");
  const today = new Date();

  let result: SessionInstructorSyncResult | undefined, failed = false;
  try {
    const { sessions, existingBySession, instructors: instructorRows } = await repository.readInputs();
    const instructors = rosterWithoutNameCollisions(instructorRows);

    if (!apply) {
      result = await syncSessionInstructors(sessions, existingBySession, instructors, DRY_RUN_WRITER, today, true);
    } else {
      const total: SessionInstructorSyncResult = { checkedSessions: 0, created: 0, converted: 0, reactivated: 0, cancelled: 0, unmatched: [], apply: true };
      for (const part of chunk(sessions, CHUNK_SIZE)) {
        const partResult = await repository.withWriter((writer) => syncSessionInstructors(part, existingBySession, instructors, writer, today, false));
        mergeResult(total, partResult);
      }
      result = total;
    }
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }

  if (failed || !result) throw new Error("SESSION_INSTRUCTOR_SYNC_FAILED");
  return result;
}
