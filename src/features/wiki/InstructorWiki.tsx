"use client";

import { type ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { PeopleDirectory, type PeopleRow } from "@/features/people/PeopleDirectory";
import type { InstructorWikiProvenance } from "./instructorWikiModel";

interface InstructorWikiProps {
  /** 목록 한 줄씩. 서버에서 코스 이력을 요약해 만든다(상세는 별도 라우트라 코스 배열을 내리지 않는다). */
  rows: PeopleRow[];
  loadFailed: boolean;
  /** 전체 강사 수(노션 명단 합친 후). 헤더 안내용. */
  entriesCount: number;
  /** 운영 현황에서 집계된 강사 수(노션 명단 합치기 전). 헤더 안내용. */
  operationEntryCount?: number;
  provenance: InstructorWikiProvenance;
  /** 검색줄 옆 "강사 추천" 버튼으로 여는 패널(서버에서 계산해 그린다). */
  recommendPanel?: ReactNode;
  /** 추천 조건이 주소에 있으면(추천받기 직후) 처음부터 펼친다. */
  recommendOpen?: boolean;
}

export function InstructorWiki({
  rows,
  loadFailed,
  entriesCount,
  operationEntryCount,
  provenance,
  recommendPanel,
  recommendOpen = false
}: InstructorWikiProps) {
  const lede =
    provenance === "empty"
      ? "관리자 > 데이터 동기화에서 노션 강사 동기화를 실행하거나, 운영 현황에 강사가 배정되면 표시됩니다."
      : provenance === "notion" && operationEntryCount !== undefined
        ? `노션 강사 DB 명단에 운영 현황 배정을 붙여 보여 줍니다. 전체 ${entriesCount}명 중 ${operationEntryCount}명이 운영 이력이 있어요.`
        : "운영 현황에 배정된 강사만 보입니다. 노션 동기화를 돌리면 배정 이력이 없는 강사까지 함께 표시됩니다.";

  return (
    <main className="dashboard-shell">
      <AppSidebar label="Instructor Wiki" teamScope="both" />

      <section className="content">
        <PeopleDirectory
          toolPanel={recommendPanel ? { label: "강사 추천", content: recommendPanel, defaultOpen: recommendOpen } : undefined}
          deployHeader="투입"
          emptyText="표시할 강사가 없습니다."
          lede={lede}
          loadFailed={loadFailed}
          loadFailedText="운영 현황 데이터를 불러오지 못했습니다."
          ratingHeader="종합만족도"
          secondaryRatingHeader="강사만족도"
          rows={rows}
          searchPlaceholder="이름 · 전문분야 · 기업 · 과정 검색"
          secondaryLabel="기업"
          title="강사 위키"
        />
      </section>
    </main>
  );
}
