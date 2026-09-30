/** Frozen PG behavior only. Native backend termination and real SIGSTOP are explicitly separate from driver faults. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import type { Pool } from "pg";
import { configure, ownPg, send } from "./oracle-environment.fixture.ts";
import { frozen } from "./frozen-loader.fixture.ts";
import type { ActivityContext } from "../../../../src/lib/activity/context";
import type { CalendarPersistence } from "../../../../src/lib/googleCalendar/calendarPersistence";
interface Locks {
  withCalendarOperationLock<T>(id: string, work: () => Promise<T>): Promise<T>;
  calendarLockSignal(): AbortSignal | undefined;
  withoutCalendarReflection<T>(work: () => Promise<T>): Promise<T>;
  isCalendarReflectionSuppressed(): boolean;
}
const globals = globalThis as unknown as { calendarLockPool?: Pool };
const key = (id: string) => createHash("sha256").update(`hub-om-calendar:${id}`).digest().readBigInt64BE().toString();
function bounded<T>(promise: Promise<T>, label: string, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]).finally(() => clearTimeout(timer!));
}
const actor: ActivityContext = { requestId: "00000000-0000-4000-8000-000000008888", actorEmail: "synthetic-lock@example.invalid", actorName: "SYNTHETIC_LOCK", actorType: "user", route: "/synthetic/lock", method: "POST" };
async function run() {
  configure(); const owned = await ownPg(), sql = owned.sql;
  let prisma: PrismaClient | undefined;
  const children = new Set<ChildProcess>();
  const emergency = () => {
    // Never leave an owned SIGSTOP worker suspended if the parent times out.
    for (const child of children) { child.kill("SIGCONT"); child.kill("SIGTERM"); }
    process.exit(1); // failure evidence; coordinator verifies any remaining owned PG schema
  };
  process.once("SIGTERM", emergency); process.once("SIGINT", emergency);
  const evidence: string[] = [];
  try {
    const locks = await frozen<Locks>("src/lib/googleCalendar/calendarOperationLock.ts");
    const context = (await frozen<{ activityContext: AsyncLocalStorage<ActivityContext> }>("src/lib/activity/context.ts")).activityContext;
    const api = await frozen<Omit<CalendarPersistence, "findOperationUpdatedAt">>("src/lib/googleCalendar/calendarEventLinkRepository.ts");
    prisma = (await frozen<{ getPrismaClient(): PrismaClient }>("src/lib/data/prisma.ts")).getPrismaClient();
    const frozenContext = await frozen<{ runWithDataRepositories<T>(scope: object, work: () => T): T }>("src/lib/data/dataRepositoryContext.ts");
    const lockPid = async (operationId: string) => {
      const value = BigInt.asUintN(64, BigInt(key(operationId)));
      const result = await sql.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.granted AND l.objsubid=1 AND l.classid::bigint=$1 AND l.objid::bigint=$2 AND a.datname=current_database() AND a.usename=current_user", [(value >> 32n).toString(), (value & 0xffffffffn).toString()]);
      assert.equal(result.rowCount, 1, "identify exactly one owned lock session"); return Number(result.rows[0].pid);
    };
    const contender = async (operationId: string, expected: boolean) => {
      const row = (await sql.query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [key(operationId)])).rows[0];
      assert.equal(row.acquired, expected);
      if (row.acquired) assert.equal((await sql.query("SELECT pg_advisory_unlock($1::bigint) AS released", [key(operationId)])).rows[0].released, true);
    };
    await locks.withCalendarOperationLock("normal", async () => {
      const signal = locks.calendarLockSignal(); assert.ok(signal); assert.equal(signal.aborted, false);
      await contender("normal", false); await contender("other", true);
      await locks.withCalendarOperationLock("normal", async () => { assert.equal(locks.calendarLockSignal(), signal); });
      await assert.rejects(() => locks.withCalendarOperationLock("other", async () => assert.fail("different nested callback")), /서로 다른 회차/);
      assert.equal(locks.isCalendarReflectionSuppressed(), false);
      await locks.withoutCalendarReflection(async () => assert.equal(locks.isCalendarReflectionSuppressed(), true));
      assert.equal(locks.isCalendarReflectionSuppressed(), false);
      return "result";
    });
    assert.equal(locks.calendarLockSignal(), undefined); await contender("normal", true);
    assert.throws(() => locks.withoutCalendarReflection(async () => {}), /잠금 안/);
    const boom = new Error("SYNTHETIC_CALLBACK_THROW"); let callbacks = 0;
    await assert.rejects(() => locks.withCalendarOperationLock("throw", async () => { callbacks++; throw boom; }), error => error === boom);
    assert.equal(callbacks, 1); await contender("throw", true); evidence.push("BL01-03/06: native trylock, independent contender, reentry, nesting, suppression, callback throw");
    // Raw contender holds the key; original wrapper must reject without entering callback.
    await sql.query("SELECT pg_advisory_lock($1::bigint)", [key("busy")]);
    try { await assert.rejects(() => locks.withCalendarOperationLock("busy", async () => assert.fail("busy callback")), /같은 회차/); }
    finally { await sql.query("SELECT pg_advisory_unlock($1::bigint)", [key("busy")]); }
    // With a live existing pool, disabled must still have no new checkout.
    const pool = globals.calendarLockPool!; const beforeTotal = pool.totalCount, beforeIdle = pool.idleCount;
    const token = process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN; delete process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN;
    try {
      assert.equal(await locks.withCalendarOperationLock("disabled", async () => { assert.equal(locks.calendarLockSignal(), undefined); return 7; }), 7);
      await assert.rejects(() => frozenContext.runWithDataRepositories({}, () => locks.withCalendarOperationLock("disabled", async () => assert.fail("scope bypass"))), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
      assert.equal(pool.totalCount, beforeTotal); assert.equal(pool.idleCount, beforeIdle);
    } finally { process.env.GOOGLE_CAL_OAUTH_REFRESH_TOKEN = token; }
    evidence.push("BL05: original disabled bypass after default-access guard");
    // Actual owned PG session termination; Prisma's separate connection remains usable.
    const lostId = "native-loss"; callbacks = 0; let effects = 0;
    await assert.rejects(() => locks.withCalendarOperationLock(lostId, async () => {
      callbacks++; const signal = locks.calendarLockSignal()!;
      const lost = new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      const pid = await lockPid(lostId); assert.notEqual(pid, Number((await sql.query("SELECT pg_backend_pid() AS pid")).rows[0].pid));
      assert.equal((await sql.query("SELECT pg_terminate_backend($1,5000) AS terminated", [pid])).rows[0].terminated, true);
      await bounded(lost, "PG loss event missing"); assert.equal(signal.aborted, true);
      await contender(lostId, true);
      await assert.rejects(() => locks.withCalendarOperationLock(lostId, async () => assert.fail("aborted reentry")), /잠금 연결/);
      effects++; // labelled synthetic effect: not a real Google call and not erased on abort.
      await context.run(actor, () => api.saveCalendarEventLink({ operationId: lostId, eventDate: "2030-01-01", calendarId: "synthetic-calendar", eventId: "synthetic-event" }));
      assert.equal((await api.listCalendarEventLinks(lostId)).length, 1);
      return "callback persisted despite lock loss";
    }), /잠금 연결/);
    assert.equal(callbacks, 1); assert.equal(effects, 1);
    const rows = await sql.query("SELECT c.target_type,c.action,c.request_id FROM activity_changes c JOIN calendar_event_links l ON c.target_id=l.id::text WHERE l.operation_id=$1", [lostId]);
    assert.deepEqual(rows.rows, [{ target_type: "calendar_event_links", action: "create", request_id: actor.requestId }]);
    evidence.push("BL08/09: native lock session terminated, B reacquired, frozen Prisma mapping+audit survives outer abort; synthetic effect1");

    for (const terminate of [false, true]) {
      const id = terminate ? "pause-terminate" : "pause-live";
      const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PG_CALENDAR_TEST_DATABASE_URL", "MONGODB_CALENDAR_TEST_URI"].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
      const child = fork(new URL("./lock-actor.fixture.ts", import.meta.url), [id], { env: { ...env, LC_ALL: "C", NODE_ENV: "test" }, execArgv: process.execArgv.filter(arg => !arg.startsWith("--test")), stdio: ["ignore", "pipe", "pipe", "ipc"] });
      children.add(child); let stderr = ""; child.stderr?.on("data", chunk => { stderr += String(chunk); }); child.stdout?.resume();
      const messages: Array<{ kind: string; message?: string }> = [];
      child.on("message", message => { messages.push(message as { kind: string; message?: string }); });
      const ended = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`worker exit ${code}/${signal}: ${stderr}`))); }); void ended.catch(() => {});
      const waitMessage = async (kind: string) => bounded((async () => {
        while (!messages.some(message => message.kind === kind)) {
          const failure = messages.find(message => ["failure", "rejected", "returned"].includes(message.kind));
          if (failure) throw new Error(`worker unexpected ${JSON.stringify(failure)} awaiting ${kind}`);
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`worker exited before ${kind}`);
          await delay(20);
        }
      })(), `worker ${kind}`);
      try {
        await waitMessage("entered"); const pid = await lockPid(id); assert.ok(child.pid);
        assert.equal(child.kill("SIGSTOP"), true);
        // Kernel process state, not elapsed time alone, proves actual suspension.
        const { execFile } = await import("node:child_process");
        const state = () => new Promise<string>((resolve, reject) => execFile("ps", ["-o", "stat=", "-p", String(child.pid)], (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
        await bounded((async () => { while (!(await state()).includes("T")) await delay(20); })(), "SIGSTOP not observed");
        if (!terminate) {
          await contender(id, false);
          const started = performance.now(); await delay(65_000); assert.ok(performance.now() - started >= 60_000);
          assert.equal(await lockPid(id), pid); await contender(id, false);
          assert.equal(child.kill("SIGCONT"), true); child.send("finish"); await waitMessage("returned");
        } else {
          assert.equal((await sql.query("SELECT pg_terminate_backend($1,5000) AS terminated", [pid])).rows[0].terminated, true);
          await contender(id, true);
          assert.equal(child.kill("SIGCONT"), true); await waitMessage("aborted"); child.send("finish");
          await waitMessage("rejected");
          assert.match(messages.find(message => message.kind === "rejected")!.message!, /잠금 연결/);
        }
        await bounded(ended, "worker exit"); await contender(id, true);
        evidence.push(terminate ? "BL11: real SIGSTOP + native session termination, B acquires, resumed A observes abort" : "BL10: real SIGSTOP >60s, session lives, B denied until resumed A releases");
      } finally {
        if (child.exitCode === null && child.signalCode === null) { child.kill("SIGCONT"); child.send("finish", () => {}); child.kill("SIGTERM"); }
        await bounded(ended.catch(() => {}), "worker cleanup"); children.delete(child);
      }
    }
    return evidence;
  } finally {
    for (const child of children) { child.kill("SIGCONT"); child.kill("SIGTERM"); }
    await prisma?.$disconnect(); await globals.calendarLockPool?.end(); await owned.close();
    process.removeListener("SIGTERM", emergency); process.removeListener("SIGINT", emergency);
  }
}
run().then(async evidence => { await send({ kind: "result", evidence }); process.disconnect?.(); }).catch(async error => { await send({ kind: "failure", message: error instanceof Error ? error.stack : String(error) }); process.exitCode = 1; process.disconnect?.(); });
