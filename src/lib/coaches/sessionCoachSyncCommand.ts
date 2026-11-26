// 운영현황 '실습코치'(coachText) → 그 회차의 MANUAL 투입(CoachEngagement) 백필 커맨드.
// 정본=운영현황 실습코치(OM 확정값). 삭제되지 않은 회차만 읽어, 코치위키 명부로 이름을 풀고
// syncSessionCoaches로 생성/전환(SHEET→MANUAL)/취소를 계획·실행한다. 삭제는 하지 않는다(평가 보존).
//
// 저장소(읽기·쓰기)는 SessionCoachSyncRepository 뒤로 숨긴다. 기본=Postgres(prismaSessionCoachSyncRepository),
// scoped override가 있으면 그걸 쓴다(Mongo-shadow 라우팅용 — sessionCoachSyncCliRuntime이 주입).
// coachOperationMatchCommand와 같은 패턴: scoped 유무로 (a) dotenv 로드 (b) 기본 Prisma 저장소 생성 (c) Prisma disconnect를 모두 가른다.
import { disconnectPrismaClient } from "../data/prisma";
import { getDataRepositoryOverride } from "../data/dataRepositoryContext";
import { getPrismaSessionCoachSyncRepository } from "../data/prismaSessionCoachSyncRepository";
import type { SessionCoachSyncRepository } from "../data/sessionCoachSyncRepository";
import { normalizeCoachName } from "./accessToken";
import {
  syncSessionCoaches,
  type SessionCoachSyncResult,
  type SessionCoachWriter,
  type SyncCoach
} from "./sessionCoachSyncWorkflow";

const CHUNK_SIZE = 50;

/** dry-run에서 실수로 쓰기가 일어나면 즉시 터뜨린다(쓰기 없음 보장). */
const DRY_RUN_WRITER: SessionCoachWriter = {
  async createEngagement() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async replaceSchedules() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async convertToManual() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async reactivateEngagements() { throw new Error("dry-run에서는 쓰지 않는다"); },
  async cancelEngagements() { throw new Error("dry-run에서는 쓰지 않는다"); }
};

/** 정규화 이름이 겹치는 코치는 모두 빼서(동명이인 오배정 방지) 그 이름은 unmatched로 떨어지게 한다. */
function rosterWithoutNameCollisions(coaches: ReadonlyArray<{ id: string; name: string }>): SyncCoach[] {
  const byName = new Map<string, Array<{ id: string; name: string }>>();
  for (const coach of coaches) {
    const key = normalizeCoachName(coach.name);
    byName.set(key, [...(byName.get(key) ?? []), coach]);
  }
  const out: SyncCoach[] = [];
  for (const group of byName.values()) if (group.length === 1) out.push({ id: group[0].id, name: group[0].name });
  return out;
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function mergeResult(into: SessionCoachSyncResult, part: SessionCoachSyncResult): void {
  into.checkedSessions += part.checkedSessions;
  into.created += part.created;
  into.converted += part.converted;
  into.reactivated += part.reactivated;
  into.cancelled += part.cancelled;
  into.unmatched.push(...part.unmatched);
}

interface Dependencies {
  getDefaultRepository(): SessionCoachSyncRepository;
  closeDefaultRepository(): Promise<void>;
}
const defaults: Dependencies = { getDefaultRepository: getPrismaSessionCoachSyncRepository, closeDefaultRepository: disconnectPrismaClient };

/**
 * 커맨드 본체: 회차·명부·기존 투입을 읽어 동기화 계획을 세우고(기본 dry-run) 또는 실행(--apply)한다.
 * 읽기는 트랜잭션 밖에서 하고, 쓰기만 청크 트랜잭션(카탈로그 락) 안에서 한다.
 * scoped override(Mongo)가 있으면 env 로드·Prisma 생성/disconnect를 전부 건너뛴다(라이브 Mongo 경로).
 */
export async function runSessionCoachSync(args: string[], loadEnvironment: () => void, dependencies: Dependencies = defaults): Promise<SessionCoachSyncResult> {
  const scoped = getDataRepositoryOverride("sessionCoachSync");
  if (!scoped) loadEnvironment();
  const repository = scoped ?? dependencies.getDefaultRepository();
  const apply = args.includes("--apply");
  const today = new Date();

  let result: SessionCoachSyncResult | undefined, failed = false;
  try {
    const { sessions, existingBySession, coaches: coachRows } = await repository.readInputs();
    const coaches = rosterWithoutNameCollisions(coachRows);

    if (!apply) {
      result = await syncSessionCoaches(sessions, existingBySession, coaches, DRY_RUN_WRITER, today, true);
    } else {
      const total: SessionCoachSyncResult = { checkedSessions: 0, created: 0, converted: 0, reactivated: 0, cancelled: 0, unmatched: [], apply: true };
      for (const part of chunk(sessions, CHUNK_SIZE)) {
        const partResult = await repository.withWriter((writer) => syncSessionCoaches(part, existingBySession, coaches, writer, today, false));
        mergeResult(total, partResult);
      }
      result = total;
    }
  } catch { failed = true; }
  finally { if (!scoped) try { await dependencies.closeDefaultRepository(); } catch { failed = true; } }

  if (failed || !result) throw new Error("SESSION_COACH_SYNC_FAILED");
  return result;
}
