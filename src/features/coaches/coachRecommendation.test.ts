import assert from "node:assert/strict";
import { test } from "node:test";

import { recommendCoachesByCriteria } from "@/features/coaches/coachRecommendation.ts";
import type { CoachSummary } from "@/lib/data/coachTypes.ts";

function fact(startDate: string, endDate?: string) {
  return { engagementId: startDate, startDate, endDate: endDate ?? startDate, cancelled: false, rating: null };
}

function coach(overrides: Partial<CoachSummary>): CoachSummary {
  return {
    id: "c",
    name: "코치",
    workType: null,
    status: "active",
    isActive: true,
    deletedAt: null,
    fields: [],
    avgRating: null,
    workDayCount: 0,
    notionPageId: null,
    engagementFacts: [],
    recentAvgRating: null,
    recentRatingCount: 0,
    ...overrides
  };
}

test("recommendCoachesByCriteria: 교육일·전문분야가 없으면 추천하지 않는다", () => {
  const result = recommendCoachesByCriteria({ field: "", date: "", coaches: [coach({})], today: "2026-11-09", dormantMonths: 6 });
  assert.equal(result.needsInput, true);
  assert.equal(result.candidates.length, 0);
});

test("recommendCoachesByCriteria: OM 평가 높은순 → 투입 경험순으로 세운다", () => {
  const coaches = [
    coach({ id: "a", name: "가", fields: ["인공지능"], recentAvgRating: 4.2, recentRatingCount: 3, engagementFacts: [fact("2026-08-01")] }),
    coach({ id: "b", name: "나", fields: ["인공지능"], recentAvgRating: 4.8, recentRatingCount: 2, engagementFacts: [fact("2026-08-01"), fact("2026-09-01")] }),
    coach({ id: "c", name: "다", fields: ["인공지능"], recentAvgRating: null, recentRatingCount: 0, engagementFacts: [fact("2026-07-01")] })
  ];
  const result = recommendCoachesByCriteria({ field: "인공지능", date: "", coaches, today: "2026-11-09", dormantMonths: 6 });
  assert.deepEqual(result.candidates.map((candidate) => candidate.name), ["나", "가", "다"]);
});

test("recommendCoachesByCriteria: 전문분야로 좁히고, 그날 투입이 겹치는 코치는 따로 모은다", () => {
  const coaches = [
    coach({ id: "a", name: "가", fields: ["인공지능"], recentAvgRating: 4.5, engagementFacts: [fact("2026-12-15", "2026-12-16")] }),
    coach({ id: "b", name: "나", fields: ["인공지능"], recentAvgRating: 4.0, engagementFacts: [fact("2026-10-01")] }),
    coach({ id: "c", name: "다", fields: ["데이터"], recentAvgRating: 5.0, engagementFacts: [] })
  ];
  const result = recommendCoachesByCriteria({ field: "인공지능", date: "2026-12-15", coaches, today: "2026-11-09", dormantMonths: 6 });
  assert.deepEqual(result.candidates.map((candidate) => candidate.name), ["나"]);
  assert.deepEqual(result.conflicts.map((conflict) => conflict.name), ["가"]);
});

test("recommendCoachesByCriteria: 비노출·삭제 코치는 뺀다", () => {
  const coaches = [
    coach({ id: "a", name: "가", fields: ["인공지능"], isActive: false }),
    coach({ id: "b", name: "나", fields: ["인공지능"], deletedAt: "2026-01-01" })
  ];
  const result = recommendCoachesByCriteria({ field: "인공지능", date: "", coaches, today: "2026-11-09", dormantMonths: 6 });
  assert.equal(result.candidates.length, 0);
});
