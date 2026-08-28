import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { OperationSession } from "./operationTypes.ts";
import type { DiscussionReference, SourceReadResult } from "../sourceReads/sourceReadTypes.ts";

// F01 회귀 테스트: Gmail 논의 캐시가 사용자를 구분하지 않아, 같은 과정을 조회한 다른 OAuth
// 사용자가 서로의 메일 제목·요약·링크를 그대로 돌려받던 문제(원인: operationCollaboration.ts의
// readGmailOperationSpecificDiscussionCache 캐시 키가 `${operationId}:oauth|service-account`뿐이었음).
// 실제 Gmail API를 부르지 않도록 gmailDiscussionReader를 통째로 모킹하고,
// 호출마다 다른 값을 반환해 "몇 번 실제로 읽었는지"와 "누가 무엇을 받았는지"를 검증한다.

let gmailReadCallCount = 0;

mock.module("@/lib/sourceReads/gmailDiscussionReader", {
  namedExports: {
    hasGmailDiscussionConfig: () => true,
    readGmailOperationDiscussionReferences: async (
      _operation: OperationSession
    ): Promise<SourceReadResult<DiscussionReference>> => {
      gmailReadCallCount += 1;
      const callIndex = gmailReadCallCount;
      const item: DiscussionReference = {
        sourceMessageId: `gmail-thread:call-${callIndex}`,
        operationKey: `gmail:call-${callIndex}`,
        title: `호출 ${callIndex}번째 결과`,
        occurredAt: new Date().toISOString(),
        sourceKind: "email",
        sourceLabel: "메일",
        sourceUrl: `https://mail.example.com/${callIndex}`,
        summary: `요약 ${callIndex}`
      };

      return {
        source: "discussion",
        status: "ok",
        readAt: new Date().toISOString(),
        items: [item],
        issues: []
      };
    }
  }
});

mock.module("@/lib/sourceReads/manualEmailDiscussionArchiveReader", {
  namedExports: {
    hasManualEmailDiscussionArchiveConfig: () => false,
    readManualEmailOperationDiscussionReferences: async (): Promise<SourceReadResult<DiscussionReference>> => ({
      source: "discussion",
      status: "disabled",
      readAt: new Date().toISOString(),
      items: [],
      issues: []
    })
  }
});

mock.module("@/lib/sourceReads/slackDiscussionReader", {
  namedExports: {
    hasSlackDiscussionConfig: () => false,
    readSlackOperationDiscussionReferences: async (): Promise<SourceReadResult<DiscussionReference>> => ({
      source: "discussion",
      status: "disabled",
      readAt: new Date().toISOString(),
      items: [],
      issues: []
    }),
    readSlackOperationReportReferences: async (): Promise<SourceReadResult<DiscussionReference>> => ({
      source: "discussion",
      status: "disabled",
      readAt: new Date().toISOString(),
      items: [],
      issues: []
    })
  }
});

// operationCollaboration.ts는 최상단에서 "@/lib/sourceReads" 배럴을 정적 import한다(제네릭 경로 전용).
// 이 테스트에서는 항상 email 경로가 활성화돼 제네릭 경로를 타지 않지만, 배럴이 평가되면
// googleCalendarSourceReader.ts(파라미터 프로퍼티 문법)까지 로드되어 --experimental-strip-types에서
// 무관하게 실패한다. 실제로 호출되지 않는 함수이므로 스텁으로 대체해 배럴 평가 자체를 건너뛴다.
mock.module("@/lib/sourceReads", {
  namedExports: {
    getOperationSourceReader: async () => {
      throw new Error("getOperationSourceReader는 이 테스트에서 호출되면 안 된다");
    }
  }
});

const { clearOperationDiscussionCache, readOperationCollaboration } = await import("./operationCollaboration.ts");

let operationSequence = 0;

function buildOperation(): OperationSession {
  operationSequence += 1;

  return {
    id: `op-${operationSequence}`,
    operationId: `SRC-TEST-${operationSequence}`,
    sourceTeam: "미분류",
    courseId: "COURSE-TEST",
    companyName: "테스트기업",
    courseName: "테스트과정",
    courseCategory: "AI",
    tools: "",
    om: "김오엠",
    ld: "이엘디",
    onsiteOm: "",
    operationStatus: "진행중",
    archiveStatus: "아카이빙전",
    educationFormat: "비대면",
    educationFormatRaw: "비대면",
    operationChannel: "online_platform",
    operationType: "단기",
    operationTypeRaw: "단기",
    roundNo: "1",
    educationDays: "5",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    operationMonth: "2026-01",
    sessionDurationDays: 5,
    sessionDurationType: "단기",
    timeText: "",
    instructors: "박강사",
    coach: "",
    region: "",
    onsiteRequired: "N",
    onsiteText: "",
    specialNotes: "",
    operationIssue: "",
    omUpdate: "",
    driveLink: "",
    operationDetail: "",
    companyWikiLink: "",
    instructorWikiLink: "",
    revenue: null,
    costRaw: "",
    profitRaw: "",
    totalCost: null,
    instructorCost: null,
    operationCost: null,
    profit: null,
    avgSatisfaction: "",
    instructorSatisfaction: "",
    hasSatisfactionSurvey: "확인필요",
    hasResultReport: "확인필요",
    resultReportLink: "",
    lectureManagementLink: "",
    lectureManagementNote: "",
    padletLink: "",
    validationStatus: "정상",
    validationErrors: []
  };
}

function resetGmailReadTracking() {
  gmailReadCallCount = 0;
}

test("T02: 같은 과정에서 A 조회 후 B가 조회하면 A의 메일 결과를 받지 않는다", async () => {
  resetGmailReadTracking();
  const operation = buildOperation();

  const a = await readOperationCollaboration(operation, {
    gmailOAuthAccessToken: "token-a",
    requestUserEmail: "a@day1company.co.kr"
  });
  const b = await readOperationCollaboration(operation, {
    gmailOAuthAccessToken: "token-b",
    requestUserEmail: "b@day1company.co.kr"
  });

  assert.equal(gmailReadCallCount, 2, "서로 다른 사용자는 각자 새로 읽어야 한다");
  assert.notEqual(
    a.discussionEmailCandidates[0]?.id,
    b.discussionEmailCandidates[0]?.id,
    "B가 A의 메일 결과를 그대로 받으면 안 된다"
  );
});

test("T03: 같은 사용자 반복 조회는 캐시를 재사용하고, 다른 과정은 다시 읽는다", async () => {
  resetGmailReadTracking();
  const operation = buildOperation();
  const otherOperation = buildOperation();
  const options = { gmailOAuthAccessToken: "token-a", requestUserEmail: "a@day1company.co.kr" };

  await readOperationCollaboration(operation, options);
  await readOperationCollaboration(operation, options);
  assert.equal(gmailReadCallCount, 1, "같은 사용자·같은 과정 반복 조회는 캐시를 재사용해야 한다");

  await readOperationCollaboration(otherOperation, options);
  assert.equal(gmailReadCallCount, 2, "다른 과정은 캐시를 공유하면 안 된다");
});

test("T04: TTL 0이면 같은 사용자도 새 결과를 받는다(만료 후 재조회)", async () => {
  resetGmailReadTracking();
  const previousTtl = process.env.RESOURCE_READ_CACHE_TTL_MS;
  process.env.RESOURCE_READ_CACHE_TTL_MS = "0";

  try {
    const operation = buildOperation();
    const options = { gmailOAuthAccessToken: "token-a", requestUserEmail: "a@day1company.co.kr" };

    const first = await readOperationCollaboration(operation, options);
    const second = await readOperationCollaboration(operation, options);

    assert.equal(gmailReadCallCount, 2);
    assert.notEqual(first.discussionEmailCandidates[0]?.id, second.discussionEmailCandidates[0]?.id);
  } finally {
    if (previousTtl === undefined) {
      delete process.env.RESOURCE_READ_CACHE_TTL_MS;
    } else {
      process.env.RESOURCE_READ_CACHE_TTL_MS = previousTtl;
    }
  }
});

test("T05: 사용자 식별값이 없는 OAuth 요청은 공용 캐시를 타지 않고, 동시 요청도 섞이지 않는다", async () => {
  resetGmailReadTracking();
  const operation = buildOperation();

  const [first, second] = await Promise.all([
    readOperationCollaboration(operation, { gmailOAuthAccessToken: "token-a" }),
    readOperationCollaboration(operation, { gmailOAuthAccessToken: "token-b" })
  ]);

  assert.equal(gmailReadCallCount, 2, "신원 미확인 OAuth 요청은 캐시 없이 매번 새로 읽어야 한다");
  assert.notEqual(first.discussionEmailCandidates[0]?.id, second.discussionEmailCandidates[0]?.id);
});

test("T07: 서비스 계정 경로와 OAuth 경로는 캐시를 공유하지 않는다", async () => {
  resetGmailReadTracking();
  const operation = buildOperation();

  const oauthResult = await readOperationCollaboration(operation, {
    gmailOAuthAccessToken: "token-a",
    requestUserEmail: "a@day1company.co.kr"
  });
  const serviceAccountResult = await readOperationCollaboration(operation, {});

  assert.equal(gmailReadCallCount, 2, "서비스 계정 경로가 OAuth 캐시를 재사용하면 안 된다");
  assert.notEqual(
    oauthResult.discussionEmailCandidates[0]?.id,
    serviceAccountResult.discussionEmailCandidates[0]?.id
  );
});

test("본인 새로고침(clearOperationDiscussionCache)은 다른 사용자의 캐시를 지우지 않는다", async () => {
  resetGmailReadTracking();
  const operation = buildOperation();
  const optionsA = { gmailOAuthAccessToken: "token-a", requestUserEmail: "a@day1company.co.kr" };
  const optionsB = { gmailOAuthAccessToken: "token-b", requestUserEmail: "b@day1company.co.kr" };

  await readOperationCollaboration(operation, optionsA);
  await readOperationCollaboration(operation, optionsB);
  assert.equal(gmailReadCallCount, 2);

  clearOperationDiscussionCache(operation.operationId, "email", { requestUserEmail: "a@day1company.co.kr" });

  await readOperationCollaboration(operation, optionsA);
  assert.equal(gmailReadCallCount, 3, "A 본인 새로고침은 A의 캐시만 지워야 한다");

  await readOperationCollaboration(operation, optionsB);
  assert.equal(gmailReadCallCount, 3, "B의 캐시는 A의 새로고침으로 지워지면 안 된다");
});

test("사용자 식별값 없이 clearOperationDiscussionCache를 호출하면(관리자/전체 무효화) 해당 과정의 모든 사용자 캐시를 지운다", async () => {
  resetGmailReadTracking();
  const operation = buildOperation();
  const optionsA = { gmailOAuthAccessToken: "token-a", requestUserEmail: "a@day1company.co.kr" };
  const optionsB = { gmailOAuthAccessToken: "token-b", requestUserEmail: "b@day1company.co.kr" };

  await readOperationCollaboration(operation, optionsA);
  await readOperationCollaboration(operation, optionsB);
  assert.equal(gmailReadCallCount, 2);

  clearOperationDiscussionCache(operation.operationId, "all");

  await readOperationCollaboration(operation, optionsA);
  await readOperationCollaboration(operation, optionsB);
  assert.equal(gmailReadCallCount, 4, "전체 무효화는 A·B 캐시를 모두 지워야 한다");
});
