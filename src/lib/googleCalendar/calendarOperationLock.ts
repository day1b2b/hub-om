// 프로세스가 달라도 같은 회차의 캘린더 작업은 겹치지 않게 한다.
// 잠금 전용 연결을 빌리고 finally에서 반드시 반납한다. 운영 테이블은 수정하지 않는다.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { isCalendarWriteEnabled } from "./calendarWriteConfig";

const context = new AsyncLocalStorage<{ operationId: string; controller: AbortController; suppressReflection?: boolean }>();
const globalPool = globalThis as unknown as { calendarLockPool?: Pool };
function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("캘린더 잠금에 DATABASE_URL이 필요합니다.");
  if (!globalPool.calendarLockPool) {
    globalPool.calendarLockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true, statement_timeout: 10000, query_timeout: 12000 });
    globalPool.calendarLockPool.on("error", () => console.error("[gcal] 잠금 연결 오류"));
  }
  return globalPool.calendarLockPool;
}
export function calendarLockSignal(): AbortSignal | undefined {
  return context.getStore()?.controller.signal;
}
export async function withCalendarOperationLock<T>(operationId: string, run: () => Promise<T>): Promise<T> {
  if (!isCalendarWriteEnabled()) return run();
  const held = context.getStore();
  if (held) {
    held.controller.signal.throwIfAborted();
    if (held.operationId !== operationId) throw new Error("서로 다른 회차의 중첩 캘린더 잠금은 허용하지 않습니다.");
    return run();
  }
  const key = createHash("sha256").update(`hub-om-calendar:${operationId}`).digest().readBigInt64BE().toString();
  const client = await pool().connect();
  const controller = new AbortController();
  const onError = () => controller.abort(new Error("캘린더 잠금 연결이 끊어졌습니다."));
  client.on("error", onError);
  let locked = false;
  let destroy = false;
  try {
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [key]);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("같은 회차의 캘린더 작업이 진행 중입니다. 잠시 후 재시도하세요.");
    const resultValue = await context.run({ operationId, controller }, run);
    controller.signal.throwIfAborted();
    return resultValue;
  } catch (error) {
    // 잠금 응답 자체가 유실되면 획득 여부를 모르므로 연결을 재사용하지 않는다.
    if (!locked) destroy = true;
    throw error;
  } finally {
    if (locked) {
      try {
        const result = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock($1::bigint) AS unlocked", [key]);
        destroy = result.rows[0]?.unlocked !== true;
      } catch { destroy = true; }
    }
    client.removeListener("error", onError);
    client.release(destroy || controller.signal.aborted);
  }
}

export function isCalendarReflectionSuppressed(): boolean { return context.getStore()?.suppressReflection === true; }
export function withoutCalendarReflection<T>(run: () => Promise<T>): Promise<T> {
  const held = context.getStore();
  if (!held) throw new Error("역반영은 회차 잠금 안에서만 실행할 수 있습니다.");
  return context.run({ ...held, suppressReflection: true }, run);
}
