import { test, mock } from "node:test";
import assert from "node:assert/strict";

let engagementRows: Array<Record<string, unknown>> = [];
mock.module("./prisma", { namedExports: { getPrismaClient: () => ({ instructorEngagement: { findMany: async () => engagementRows } }) } });

const { PrismaInstructorEngagementRepository } = await import("./prismaInstructorEngagementRepository");

function row(overrides: Record<string, unknown>) {
  return {
    id: "e1", courseName: "삼성 AI", operationSessionId: "s1", status: "SCHEDULED", source: "MANUAL",
    startDate: new Date("2026-11-16T00:00:00.000Z"), endDate: new Date("2026-11-20T00:00:00.000Z"),
    startTime: "09:00", endTime: "18:00", sourceEngagementId: "manual-session:s1:n1",
    operationSession: { educationFormat: "OFFLINE", timeText: "09:00~18:00", deletedAt: null },
    ...overrides
  };
}

test("operationBacked: manual-session 접두사면 true, 보조 소스면 false", async () => {
  engagementRows = [
    row({ id: "e1", sourceEngagementId: "manual-session:s1:n1" }),
    row({ id: "e2", sourceEngagementId: "contract-sheet:12:n1", operationSessionId: null, operationSession: null })
  ];
  const views = await new PrismaInstructorEngagementRepository().listEngagements("n1");
  const e1 = views.find(v => v.id === "e1")!, e2 = views.find(v => v.id === "e2")!;
  assert.equal(e1.operationBacked, true);
  assert.equal(e2.operationBacked, false);
  // 코치 CoachEngagementView 구조 호환용 평가필드는 강사엔 항상 null
  assert.equal(e1.rating, null); assert.equal(e1.rehire, null); assert.equal(e1.feedback, null);
});

test("status·source 소문자 매핑, 날짜 포맷, linkedSession(회차 연결/삭제)", async () => {
  engagementRows = [
    row({ id: "e1", status: "IN_PROGRESS", source: "MANUAL" }),
    row({ id: "e2", status: "COMPLETED", source: "CONTRACT", operationSessionId: null, operationSession: null }),
    row({ id: "e3", status: "CANCELLED", operationSession: { educationFormat: "OFFLINE", timeText: "x", deletedAt: new Date() } })
  ];
  const views = await new PrismaInstructorEngagementRepository().listEngagements("n1");
  const e1 = views.find(v => v.id === "e1")!, e2 = views.find(v => v.id === "e2")!, e3 = views.find(v => v.id === "e3")!;
  assert.equal(e1.status, "in_progress");
  assert.equal(e2.status, "completed");
  assert.equal(e3.status, "cancelled");
  assert.equal(e1.source, "manual");
  assert.equal(e2.source, "contract");
  assert.equal(e1.startDate, "2026-11-16");
  assert.equal(e1.endDate, "2026-11-20");
  assert.ok(e1.linkedSession && typeof e1.linkedSession.educationFormat === "string"); // 회차 연결 → facts
  assert.equal(e2.linkedSession, null); // 회차 미연결 → null
  assert.equal(e3.linkedSession, null); // 회차 삭제됨(deletedAt) → null
});
