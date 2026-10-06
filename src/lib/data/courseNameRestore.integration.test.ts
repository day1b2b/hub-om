import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { activityContext } from "@/lib/activity/context";
import { withActivityDatabase } from "@/lib/activity/database";
import { applyCourseNameRestore, CourseNameRestoreConflict, planCourseNameRestore } from "./courseNameRestore";

const url = process.env.COURSE_RESTORE_TEST_DATABASE_URL;
test("과정명 복원: 격리 PostgreSQL의 데이터·경합·감사 원자성", { skip: !url }, async (t) => {
  const parsed = new URL(url!);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.pathname === "/course_restore_test");
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const db = withActivityDatabase(raw);
  const companyIds: string[] = [];
  const runIds: string[] = [];
  const requestIds: string[] = [];
  const date = new Date("2026-09-07T00:00:00Z");
  async function fixture() {
    const key = randomUUID();
    const company = await raw.company.create({ data: { name: key, normalizedName: key } });
    companyIds.push(company.id);
    const course = await raw.course.create({ data: { companyId: company.id, courseId: key, name: "현재 과정",
      operationType: "LONG", courseCategory: "category", tools: "tool", revenue: 1234, revenueRaw: "1,234" } });
    const run = await raw.dataImportRun.create({ data: { sourceType: "test", sourceName: key } });
    runIds.push(run.id);
    const session = await raw.operationSession.create({ data: { operationId: key, courseRecordId: course.id,
      startDate: date, endDate: date, lectureManagementNote: "preserve-me" } });
    const source = await raw.operationSourceRecord.create({ data: { importRunId: run.id, operationSessionId: session.id,
      sourceWorkbook: "test", sourceSheet: "test", sourceRowNumber: 1, rowSnapshot: {}, mappedFields: { courseName: "원래 과정" } } });
    return { key, company, course, run, session, source };
  }
  function attributed<T>(fn: () => Promise<T>) {
    const requestId = randomUUID(); requestIds.push(requestId);
    return { requestId, result: activityContext.run({ requestId, actorEmail: "test@example.test", actorName: "test",
      actorType: "development", route: "/api/admin/course-name-restore", method: "POST" }, fn) };
  }
  try {
    await t.test("새 과정 메타데이터와 선택하지 않은 회차·기록을 보존하고 중복 재시도는 거절한다", async () => {
      const f = await fixture();
      const untouched = await raw.operationSession.create({ data: { operationId: randomUUID(), courseRecordId: f.course.id, startDate: date, endDate: date } });
      const plan = await planCourseNameRestore(f.key, db);
      assert.equal(plan.rows.filter((row) => row.restorable).length, 1);
      const call = attributed(() => applyCourseNameRestore(f.key, [f.key], plan.snapshot, "test@example.test", db));
      assert.equal((await call.result).moved.length, 1);
      const changed = await raw.operationSession.findUniqueOrThrow({ where: { id: f.session.id }, include: { course: true } });
      assert.equal(changed.course.name, "원래 과정");
      assert.equal(changed.lectureManagementNote, "preserve-me");
      assert.equal(changed.course.tools, "tool"); assert.equal(changed.course.courseCategory, "category");
      assert.equal(changed.course.operationType, "LONG"); assert.equal(changed.course.revenue?.toString(), "1234");
      assert.equal(changed.course.revenueRaw, "1,234");
      assert.equal((await raw.operationSession.findUniqueOrThrow({ where: { id: untouched.id } })).courseRecordId, f.course.id);
      assert.equal(await raw.activityChange.count({ where: { requestId: call.requestId } }), 2);
      await assert.rejects(applyCourseNameRestore(f.key, [f.key], plan.snapshot, null, db), CourseNameRestoreConflict);
    });
    await t.test("동일 이름의 다른 코스는 제외하고 제로폭 공백이 있는 기존 대상을 재사용한다", async () => {
      const f = await fixture();
      await raw.course.create({ data: { companyId: f.company.id, courseId: "other", name: "원래 과정" } });
      const target = await raw.course.create({ data: { companyId: f.company.id, courseId: `${f.key}\u200b`, name: "원래 과정", tools: "existing" } });
      const plan = await planCourseNameRestore(f.key, db);
      await applyCourseNameRestore(f.key, [f.key], plan.snapshot, null, db);
      assert.equal((await raw.operationSession.findUniqueOrThrow({ where: { id: f.session.id } })).courseRecordId, target.id);
      assert.equal((await raw.course.findUniqueOrThrow({ where: { id: target.id } })).tools, "existing");
    });
    await t.test("원천 수정·대상 수정·소프트 삭제 후 오래된 계획은 쓰기 전에 거절한다", async () => {
      for (const change of ["source", "course", "deleted"]) {
        const f = await fixture(); const plan = await planCourseNameRestore(f.key, db);
        if (change === "source") await raw.operationSourceRecord.update({ where: { id: f.source.id }, data: { mappedFields: { courseName: "바뀐 원천" } } });
        if (change === "course") await raw.course.update({ where: { id: f.course.id }, data: { tools: "changed" } });
        if (change === "deleted") await raw.operationSession.update({ where: { id: f.session.id }, data: { deletedAt: new Date() } });
        await assert.rejects(applyCourseNameRestore(f.key, [f.key], plan.snapshot, null, db), CourseNameRestoreConflict);
        assert.equal(await raw.course.count({ where: { companyId: f.company.id } }), 1);
      }
    });
    await t.test("정규화 중복 대상과 원천 최신 시각 동률은 임의로 고르지 않는다", async () => {
      const f = await fixture();
      for (const id of [f.key, `${f.key}\u200b`]) await raw.course.create({ data: { companyId: f.company.id, courseId: id, name: "원래 과정" } });
      assert.equal((await planCourseNameRestore(f.key, db)).rows[0].restorable, false);
      const g = await fixture();
      await raw.operationSourceRecord.create({ data: { importRunId: g.run.id, operationSessionId: g.session.id, sourceWorkbook: "test",
        sourceSheet: "test", sourceRowNumber: 2, rowSnapshot: {}, mappedFields: { courseName: "다른 원천" }, createdAt: g.source.createdAt } });
      assert.equal((await planCourseNameRestore(g.key, db)).rows[0].restorable, false);
    });
    await t.test("같은 새 대상의 메타데이터가 다르면 복원을 차단한다", async () => {
      const f = await fixture();
      const course = await raw.course.create({ data: { companyId: f.company.id, courseId: f.key, name: "현재 과정2", tools: "different" } });
      const session = await raw.operationSession.create({ data: { operationId: randomUUID(), courseRecordId: course.id, startDate: date, endDate: date } });
      await raw.operationSourceRecord.create({ data: { importRunId: f.run.id, operationSessionId: session.id, sourceWorkbook: "test",
        sourceSheet: "test", sourceRowNumber: 2, rowSnapshot: {}, mappedFields: { courseName: "원래 과정" } } });
      assert.ok((await planCourseNameRestore(f.key, db)).rows.every((row) => !row.restorable));
    });
    await t.test("두 번째 회차 실패 시 첫 회차·새 과정·감사 이력까지 전부 롤백한다", async () => {
      const f = await fixture();
      const second = await raw.operationSession.create({ data: { operationId: "restore-test-fail", courseRecordId: f.course.id, startDate: date, endDate: date } });
      await raw.operationSourceRecord.create({ data: { importRunId: f.run.id, operationSessionId: second.id, sourceWorkbook: "test",
        sourceSheet: "test", sourceRowNumber: 2, rowSnapshot: {}, mappedFields: { courseName: "원래 과정" } } });
      await raw.$executeRawUnsafe("CREATE FUNCTION restore_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id = 'restore-test-fail' THEN RAISE EXCEPTION 'test rejection'; END IF; RETURN NEW; END $$");
      await raw.$executeRawUnsafe("CREATE TRIGGER restore_test_reject BEFORE UPDATE ON operation_sessions FOR EACH ROW EXECUTE FUNCTION restore_test_reject()");
      try {
        const plan = await planCourseNameRestore(f.key, db);
        const call = attributed(() => applyCourseNameRestore(f.key, [f.key, second.operationId], plan.snapshot, null, db));
        await assert.rejects(call.result);
        assert.equal(await raw.course.count({ where: { companyId: f.company.id } }), 1);
        assert.equal((await raw.operationSession.findUniqueOrThrow({ where: { id: f.session.id } })).courseRecordId, f.course.id);
        assert.equal(await raw.activityChange.count({ where: { requestId: call.requestId } }), 0);
      } finally {
        await raw.$executeRawUnsafe("DROP TRIGGER restore_test_reject ON operation_sessions");
        await raw.$executeRawUnsafe("DROP FUNCTION restore_test_reject()");
      }
    });
    await t.test("동시 적용 두 건 중 한 건만 성공하고 과정은 한 번만 생성한다", async () => {
      const f = await fixture(); const plan = await planCourseNameRestore(f.key, db);
      // 두 트랜잭션이 같은 기존 상태를 읽은 뒤에만 쓰기를 시작하도록 동기화한다.
      let readers = 0;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => { release = resolve; });
      const competing = new Proxy(db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: Parameters<PrismaClient["$transaction"]>[1]) =>
          target.$transaction((tx) => callback(new Proxy(tx, { get(client, model) {
            if (model !== "course") return Reflect.get(client, model);
            return new Proxy(client.course, { get(delegate, operation) {
              const fn = Reflect.get(delegate, operation);
              if (operation !== "findMany") return typeof fn === "function" ? fn.bind(delegate) : fn;
              return async (...args: unknown[]) => {
                const rows = await fn.apply(delegate, args);
                if (args[0] && typeof args[0] === "object" && "include" in args[0]) {
                  if (++readers === 2) release();
                  await ready;
                }
                return rows;
              };
            } });
          } })), options);
      } });
      const results = await Promise.allSettled([1, 2].map(() => applyCourseNameRestore(f.key, [f.key], plan.snapshot, null, competing)));
      assert.equal(readers, 2);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failed = results.find((result) => result.status === "rejected");
      assert.ok(failed?.status === "rejected" && failed.reason instanceof CourseNameRestoreConflict);
      assert.equal(await raw.course.count({ where: { companyId: f.company.id, name: "원래 과정" } }), 1);
    });
    await t.test("대상 외 회차가 섞이면 선택 전체를 거절한다", async () => {
      const f = await fixture(); const plan = await planCourseNameRestore(f.key, db);
      await assert.rejects(applyCourseNameRestore(f.key, [f.key, "outside"], plan.snapshot, null, db), CourseNameRestoreConflict);
      assert.equal((await raw.operationSession.findUniqueOrThrow({ where: { id: f.session.id } })).courseRecordId, f.course.id);
    });
    await t.test("같은 코스ID의 기업을 행마다 표시하고 선택한 기업만 변경한다", async () => {
      const f = await fixture(); const g = await fixture();
      await raw.course.update({ where: { id: g.course.id }, data: { courseId: f.key } });
      const plan = await planCourseNameRestore(f.key, db);
      assert.equal(new Set(plan.rows.map((row) => row.companyName)).size, 2);
      await applyCourseNameRestore(f.key, [f.key], plan.snapshot, null, db);
      assert.equal((await raw.operationSession.findUniqueOrThrow({ where: { id: g.session.id } })).courseRecordId, g.course.id);
    });
  } finally {
    await raw.operationSourceRecord.deleteMany({ where: { importRunId: { in: runIds } } });
    await raw.operationSession.deleteMany({ where: { course: { companyId: { in: companyIds } } } });
    await raw.course.deleteMany({ where: { companyId: { in: companyIds } } });
    await raw.company.deleteMany({ where: { id: { in: companyIds } } });
    await raw.dataImportRun.deleteMany({ where: { id: { in: runIds } } });
    await raw.activityChange.deleteMany({ where: { requestId: { in: requestIds } } });
    await raw.$disconnect();
  }
});
