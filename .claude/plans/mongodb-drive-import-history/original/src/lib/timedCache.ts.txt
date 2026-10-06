export interface TimedCacheEntry<T> {
  expiresAt: number;
  hasValue: boolean;
  promise?: Promise<T>;
  value?: T;
}

/**
 * TTL 캐시 읽기.
 *
 * `onPending`은 새 읽기를 시작한 직후, 아직 끝나지 않은 entry를 넘겨준다. 호출자가 이 entry를
 * 곧바로 저장해 두면 읽기가 오래 걸리는 동안 들어온 다른 호출이 같은 promise를 기다린다(중복 읽기 방지).
 * 넘기지 않으면 읽기가 끝난 뒤에야 entry가 공개되므로, 느린 원천에서는 요청마다 새 읽기가 시작된다.
 */
export async function readTimedCache<T>(
  entry: TimedCacheEntry<T> | null,
  ttlMs: number,
  readFresh: () => Promise<T>,
  onPending?: (pending: TimedCacheEntry<T>) => void
): Promise<{ entry: TimedCacheEntry<T>; value: T }> {
  const now = Date.now();

  if (entry?.hasValue && entry.expiresAt > now) {
    return { entry, value: entry.value as T };
  }

  if (entry?.promise && entry.expiresAt > now) {
    return { entry, value: await entry.promise };
  }

  const nextEntry: TimedCacheEntry<T> = {
    expiresAt: now + ttlMs,
    hasValue: false,
    promise: readFresh()
  };

  onPending?.(nextEntry);

  try {
    const value = (await nextEntry.promise) as T;
    nextEntry.value = value;
    nextEntry.hasValue = true;
    nextEntry.promise = undefined;
    return { entry: nextEntry, value };
  } catch (error) {
    nextEntry.promise = undefined;
    throw error;
  }
}

export function getResourceReadCacheTtlMs(): number {
  const configuredTtl = Number(process.env.RESOURCE_READ_CACHE_TTL_MS);

  if (Number.isFinite(configuredTtl) && configuredTtl >= 0) {
    return configuredTtl;
  }

  return 5 * 60 * 1000;
}
