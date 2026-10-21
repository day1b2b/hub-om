import { readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";
import type { OperationRepository } from "./operationRepository";
import type { OperationSession } from "./operationTypes";

declare global {
  var __hubOmOperationListCacheEntry: TimedCacheEntry<OperationSession[]> | null | undefined;
}

function getOperationListCacheTtlMs(): number {
  const configured = Number(process.env.OPERATION_LIST_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 30 * 1000;
}

/**
 * 운영현황 목록(/operations)과 운영 상세(/operations/[operationId])가 같은
 * repository.listOperations() 전체 조회를 매 요청마다 반복한다. 변경 직후에도
 * 최신 데이터가 보여야 하니 TTL을 짧게(기본 30초) 둬서, 그 사이 들어오는 요청은
 * DB를 다시 안 거치고 캐시를 쓴다.
 *
 * mongodb-shadow 이관 검증 중에는 캐시를 끼우지 않는다 - 그 모드의 목적 자체가
 * "매 요청 실제로 읽어서 postgres와 일치하는지" 확인하는 거라 캐시가 끼면 검증 의미가 없다.
 */
export async function listOperationsCached(repository: OperationRepository): Promise<OperationSession[]> {
  const backend = process.env.OPERATION_PAGES_BACKEND?.trim() || "postgres";
  if (backend !== "postgres") return repository.listOperations();

  const { entry, value } = await readTimedCache(globalThis.__hubOmOperationListCacheEntry ?? null, getOperationListCacheTtlMs(), () =>
    repository.listOperations()
  );
  globalThis.__hubOmOperationListCacheEntry = entry;
  return value;
}
