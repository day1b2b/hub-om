/** Real stoppable worker. No schema changes; controller owns the PG test database. */
import { configure, send } from "./oracle-environment.fixture.ts";
import { frozen } from "./frozen-loader.fixture.ts";
import type { Pool } from "pg";
interface Locks { withCalendarOperationLock<T>(id: string, work: () => Promise<T>): Promise<T>; calendarLockSignal(): AbortSignal | undefined }
async function main() {
  configure();
  const locks = await frozen<Locks>("src/lib/googleCalendar/calendarOperationLock.ts");
  try {
    await locks.withCalendarOperationLock(process.argv[2], async () => {
      const signal = locks.calendarLockSignal()!;
      signal.addEventListener("abort", () => { void send({ kind: "aborted" }); }, { once: true });
      // Install receiver before telling the controller to stop/resume us.
      await new Promise<void>(resolve => { process.on("message", message => { if (message === "finish") resolve(); }); void send({ kind: "entered", pid: process.pid }); });
    });
    await send({ kind: "returned" });
  } catch (error) { await send({ kind: "rejected", message: error instanceof Error ? error.message : String(error) }); }
  finally { await (globalThis as unknown as { calendarLockPool?: Pool }).calendarLockPool?.end(); process.disconnect?.(); }
}
main().catch(async error => { await send({ kind: "failure", message: String(error) }); process.exitCode = 1; process.disconnect?.(); });
