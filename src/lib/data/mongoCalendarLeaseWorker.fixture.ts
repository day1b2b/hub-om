/** L8 전용 소유 child process. *.test.ts 밖에 두며 parent suite만 실행한다. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { ClientSession, MongoClient, MongoServerError } from "mongodb";
import { MongoCalendarOperationLock } from "./mongoCalendarOperationLock";
import { MongoCalendarPersistence } from "./mongoCalendarPersistence";
import { attributed, CALENDAR_TEST_URI, link, safeError } from "./mongoCalendarIntegrationFixtures";

async function resume() {
  const [message] = await once(process, "message");
  assert.deepEqual(message, { type: "resume" });
}
async function main() {
  assert.ok(process.send, "독립 실행 불가: parent 소유 IPC 필요");
  assert.equal(process.env.MONGODB_CALENDAR_TEST_URI, CALENDAR_TEST_URI);
  const [message] = await once(process, "message");
  const { databaseName, namespace, operationId, mode } = message as Record<string, string>;
  assert.match(databaseName, /^hub_om_shadow_calendar_[a-f0-9]{24}$/);
  assert.match(namespace, /^shadow_calendar_[a-f0-9]{20}$/);
  assert.ok(mode === "stale-mapping" || mode === "committed-ack");
  assert.match(operationId, /^synthetic-/);
  const client = new MongoClient(CALENDAR_TEST_URI, { directConnection: true, serverSelectionTimeoutMS: 5_000 });
  const original = ClientSession.prototype.commitTransaction;
  let callbacks = 0, commits = 0, mappingReturned = false, lost = false;
  try {
    await client.connect();
    const options = { client, databaseName, namespace, allowShadowWrites: true as const };
    // parent가 준비한 metadata만 open. worker는 자원 생성·삭제·키 생성 권한이 없다.
    const lock = await MongoCalendarOperationLock.open(options), repo = await MongoCalendarPersistence.open(options, lock);
    if (mode === "committed-ack") {
      ClientSession.prototype.commitTransaction = async function (this: ClientSession, ...args: Parameters<ClientSession["commitTransaction"]>) {
        const result = await original.apply(this, args);
        if (++commits === 1) {
          process.send!({ type: "committed" });
          await resume();
          const error = new MongoServerError({ code: 91, message: "Synthetic commit ACK withheld during real process pause" });
          error.addErrorLabel("UnknownTransactionCommitResult"); throw error;
        }
        return result;
      };
    }
    await assert.rejects(attributed(() => lock.withLock(operationId, async handle => {
      callbacks++;
      if (mode === "stale-mapping") { process.send!({ type: "acquired" }); await resume(); }
      try { await repo.saveCalendarEventLink(link(operationId)); mappingReturned = true; }
      catch (error) { safeError(error); lost = handle.signal.aborted; throw error; }
    })), safeError);
    assert.equal(callbacks, 1); assert.equal(mappingReturned, false, "자연 만료는 10초 ACK 확인 예산 안의 성공이 아니다");
    if (mode === "stale-mapping") assert.equal(lost, true);
    process.send!({ type: "result", callbacks, commits, mappingReturned, lost });
  } finally {
    ClientSession.prototype.commitTransaction = original;
    await client.close();
  }
}
void main().then(() => process.disconnect?.()).catch(error => {
  // IPC도 raw DB/error body를 노출하지 않는다. test runner는 실패 code만 받는다.
  process.exitCode = 1;
  if (process.connected) process.send?.({ type: "failure", code: error instanceof assert.AssertionError ? "WORKER_ASSERTION" : "WORKER_FAILED" }, () => process.disconnect?.());
});
