import { readTimedCache, type TimedCacheEntry } from "@/lib/timedCache";
import type { OperationRepository } from "./operationRepository";
import type { OperationSession } from "./operationTypes";

declare global {
  var __hubOmOperationListCacheEntry: TimedCacheEntry<OperationSession[]> | null | undefined;
  var __hubOmOperationListCacheGeneration: number | undefined;
}

function getOperationListCacheTtlMs(): number {
  const configured = Number(process.env.OPERATION_LIST_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 30 * 1000;
}

/**
 * 운영현황 목록(/operations)은 repository.listOperations() 전체 조회를 매 요청마다 반복한다.
 * TTL을 짧게(기본 30초) 둬서 그 사이 들어오는 요청은 DB를 다시 안 거치고 캐시를 쓴다.
 *
 * 운영 데이터 쓰기(운영 수정 API, 업무요청 쓰기)가 끝나면 clearOperationListCache()로 바로 비운다.
 * 그 밖의 경로(가져오기·동기화 등)로 바뀐 값은 최대 TTL만큼 늦게 보일 수 있다.
 * 운영 상세는 저장 후 router.refresh()로 바로 다시 그리므로 이 캐시를 쓰지 않는다.
 */
export async function listOperationsCached(repository: OperationRepository): Promise<OperationSession[]> {
  const generation = globalThis.__hubOmOperationListCacheGeneration ?? 0;
  const keep = (entry: TimedCacheEntry<OperationSession[]>) => {
    // 읽는 도중 쓰기로 비워졌다면, 쓰기 전 값일 수 있는 이 결과는 캐시에 남기지 않는다.
    if ((globalThis.__hubOmOperationListCacheGeneration ?? 0) === generation) globalThis.__hubOmOperationListCacheEntry = entry;
  };
  const { entry, value } = await readTimedCache(globalThis.__hubOmOperationListCacheEntry ?? null, getOperationListCacheTtlMs(), () =>
    repository.listOperations(), keep
  );
  keep(entry);
  return value;
}

export function clearOperationListCache(): void {
  globalThis.__hubOmOperationListCacheGeneration = (globalThis.__hubOmOperationListCacheGeneration ?? 0) + 1;
  globalThis.__hubOmOperationListCacheEntry = null;
}
