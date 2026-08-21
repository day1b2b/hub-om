/**
 * 정해진 시간까지만 기다린다. 시간이 지나면 `null`을 주고, 원래 promise는 취소하지 않는다.
 *
 * 느린 원천 읽기(예: 세일즈맵 딜 전체 읽기)를 기다리는 응답에 상한을 두기 위한 유틸이다.
 * 호출자는 `null`을 "아직 준비 중"으로 다루고, 뒤에서 계속 도는 읽기가 캐시를 채우면
 * 다음 호출이 곧바로 답을 받는다.
 *
 * 주의: 시간이 지난 뒤 원래 promise가 실패하면 처리되지 않은 rejection이 될 수 있으므로,
 * 호출자가 promise에 `.catch()`를 미리 붙여 두어야 한다.
 */
export async function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
