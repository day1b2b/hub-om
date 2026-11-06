// 서버 로더 구간의 소요 시간을 Coolify Runtime Logs(`[perf] ...`)에 남긴다.
// 성능 병목을 추측이 아니라 데이터로 잡기 위한 계측. 결과값은 그대로 돌려주므로 호출부를 감싸기만 하면 된다.
export async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    console.info(`[perf] ${label} ${Date.now() - startedAt}ms`);
  }
}
