export interface TimedCacheEntry<T> {
  expiresAt: number;
  hasValue: boolean;
  promise?: Promise<T>;
  value?: T;
}

export async function readTimedCache<T>(
  entry: TimedCacheEntry<T> | null,
  ttlMs: number,
  readFresh: () => Promise<T>
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
