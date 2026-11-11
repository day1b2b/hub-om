// 워크스페이스 공용 읽기(전체 코치·운영 현황 등)를 짧은 TTL로 메모이즈한다.
// force-dynamic 페이지가 매 방문마다 같은 무거운 DB 읽기를 다시 돌려 느린 문제를 줄인다
// (강사·코치위키 서버 렌더가 listCoaches/listOperations 때문에 1~2초 걸리던 것).
//
// 설계:
// - 프로덕션에서만 활성(테스트·개발은 통과) — 통합테스트가 매번 새 데이터로 검증하므로 캐시가 끼면 안 됨.
// - Promise를 저장해 동시 요청이 쿼리를 한 번만 하게 한다(stampede 방지).
// - 실패(reject)하면 캐시하지 않는다(순간 장애가 TTL 동안 굳는 것 방지).
// - 단일 인스턴스(Coolify) 메모리 캐시라 재배포 시 비워진다. 값은 워크스페이스 공용이라 사용자 구분이 없다.

// 5분. 위키는 가끔 들어오는 단일 사용자가 많아, 30초면 재방문 사이에 매번 만료돼 캐시가 거의 무용했다.
// 편집은 드무니(팀 확인) 5분 staleness는 수용. 편집 즉시 반영이 필요하면 쓰기 경로에서 무효화를 얹는다.
const DEFAULT_TTL_MS = 300_000;

// 프로덕션에서만 활성(테스트·개발은 통과). 테스트는 READ_CACHE_FORCE=1로 로직을 직접 검증할 수 있다.
// 매 호출 env를 읽어, 테스트가 import 이후에 바꿔도 반영된다.
function cacheEnabled(): boolean {
  if (process.env.READ_CACHE_DISABLED === "1") return false;
  return process.env.NODE_ENV === "production" || process.env.READ_CACHE_FORCE === "1";
}

interface Entry {
  promise: Promise<unknown>;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export async function cachedRead<T>(key: string, load: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  if (!cacheEnabled()) return load();

  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.promise as Promise<T>;
  }

  const promise = load();
  cache.set(key, { promise, expiresAt: now + ttlMs });
  // 실패한 읽기는 굳히지 않는다 — 같은 promise가 아직 들어 있을 때만 제거(이후 갱신된 항목을 지우지 않도록).
  promise.catch(() => {
    const current = cache.get(key);
    if (current && current.promise === promise) cache.delete(key);
  });
  return promise;
}

/** 테스트·운영 중 수동으로 비울 때. */
export function clearReadCache(): void {
  cache.clear();
}
