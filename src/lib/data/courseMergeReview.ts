import { findLinkHref } from "../links";
import { planCourseLevelReportLinksBackfill } from "./courseLevelReportLinksBackfill";
import type { OmRequest } from "./omRequest/omRequestTypes";
import type { CourseCommonNoteInput, OperationSession } from "./operationTypes";

// 회차 단위 → 과정 단위 통합 이후 사람이 직접 골라야 하는 항목을 모은다.
// - 강의관리 링크·메모: 회차마다 값이 달라 과정 값으로 자동 반영하지 못한 과정
// - 과정 공통 메모(특이사항·운영 이슈·OM 업데이트): 회차마다 다르거나 일부 회차에만 있는 과정
// - 싱크업: 2026-10-14 이전 업무 요청의 "요청사항"이 싱크업 칸에 들어간 버그(e4ccfb04)의 흔적

const COMMON_NOTE_FIELDS = ["specialNotes", "operationIssue", "omUpdate"] as const;
const COMMON_NOTE_LABELS: Record<(typeof COMMON_NOTE_FIELDS)[number], string> = {
  specialNotes: "공통 메모 - 특이사항",
  operationIssue: "공통 메모 - 운영 이슈",
  omUpdate: "공통 메모 - 업데이트사항"
};
const LINK_FIELD_LABELS = { lectureManagementLink: "강의관리 링크", lectureManagementNote: "강의관리 메모" } as const;

function normalized(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function groupByCourse(operations: OperationSession[]): Map<string, OperationSession[]> {
  const courses = new Map<string, OperationSession[]>();
  for (const operation of operations) {
    if (!operation.courseRecordId) continue;
    const group = courses.get(operation.courseRecordId) ?? [];
    group.push(operation);
    courses.set(operation.courseRecordId, group);
  }
  for (const rounds of courses.values()) rounds.sort((a, b) => Number(a.roundNo) - Number(b.roundNo) || a.startDate.localeCompare(b.startDate));
  return courses;
}

/** 과정별로 연결된 업무 요청의 "요청사항" 문장(정규화). 업무 요청은 대표 회차 ID로만 연결돼 과정으로 넓힌다. */
function requestNotesByCourse(operations: OperationSession[], requests: OmRequest[]): Map<string, Set<string>> {
  const courseByOperation = new Map(operations.map((operation) => [operation.operationId, operation.courseRecordId ?? ""]));
  const notes = new Map<string, Set<string>>();
  for (const request of requests) {
    const courseRecordId = request.operationId ? courseByOperation.get(request.operationId) : undefined;
    const text = normalized(request.notes ?? "");
    if (!courseRecordId || !text) continue;
    const set = notes.get(courseRecordId) ?? new Set<string>();
    set.add(text);
    notes.set(courseRecordId, set);
  }
  return notes;
}

export type SyncupKind = "link" | "requestNote" | "manual";

/** 싱크업 칸 값 분류: 링크가 있으면 그대로, 업무 요청 요청사항과 같은 문장이면 버그 흔적, 그 외 글자는 사람이 확인. */
export function classifySyncup(value: string, courseRequestNotes: Set<string> | undefined): SyncupKind {
  if (findLinkHref(value)) return "link";
  return courseRequestNotes?.has(normalized(value)) ? "requestNote" : "manual";
}

export interface SyncupCleanupCourse {
  courseRecordId: string;
  companyName: string;
  courseName: string;
  operationIds: string[];
  /** 과정 공통 메모에 저장할 값. 특이사항에 요청사항을 옮기고(이미 있으면 그대로), 나머지 칸은 기존 값 유지. */
  commonNote: CourseCommonNoteInput;
  commonNoteChanged: boolean;
}

export interface SyncupCleanupPlan {
  roundsWithValue: number;
  linkRounds: number;
  requestNoteRounds: number;
  manualRounds: number;
  courses: SyncupCleanupCourse[];
  manual: { companyName: string; courseName: string; roundNo: string; operationId: string }[];
}

/**
 * 싱크업 칸에 들어간 업무 요청 요청사항을 정리하는 계획. 요청사항과 같은 문장(링크 없음)인 회차만 대상이고,
 * 문장은 과정 공통 메모의 특이사항으로 옮긴 뒤(기존 특이사항이 있으면 뒤에 붙임, 이미 들어 있으면 생략) 싱크업을 비운다.
 */
export function planSyncupRequestNoteCleanup(operations: OperationSession[], requests: OmRequest[]): SyncupCleanupPlan {
  const notesByCourse = requestNotesByCourse(operations, requests);
  const plan: SyncupCleanupPlan = { roundsWithValue: 0, linkRounds: 0, requestNoteRounds: 0, manualRounds: 0, courses: [], manual: [] };

  for (const [courseRecordId, rounds] of groupByCourse(operations)) {
    const courseNotes = notesByCourse.get(courseRecordId);
    const bugRounds: OperationSession[] = [];
    const texts: string[] = [];
    for (const round of rounds) {
      if (!round.operationDetail.trim()) continue;
      plan.roundsWithValue++;
      const kind = classifySyncup(round.operationDetail, courseNotes);
      if (kind === "link") plan.linkRounds++;
      else if (kind === "manual") {
        plan.manualRounds++;
        plan.manual.push({ companyName: round.companyName, courseName: round.courseName, roundNo: round.roundNo, operationId: round.operationId });
      } else {
        plan.requestNoteRounds++;
        bugRounds.push(round);
        const text = normalized(round.operationDetail);
        if (!texts.includes(text)) texts.push(text);
      }
    }
    if (bugRounds.length === 0) continue;

    const existing = rounds.find((round) => round.courseCommonNote)?.courseCommonNote;
    let specialNotes = normalized(existing?.specialNotes ?? "");
    for (const text of texts) {
      if (specialNotes.includes(text)) continue;
      specialNotes = specialNotes ? `${specialNotes}\n\n[업무 요청 요청사항]\n${text}` : text;
    }
    plan.courses.push({
      courseRecordId,
      companyName: rounds[0].companyName,
      courseName: rounds[0].courseName,
      operationIds: bugRounds.map((round) => round.operationId),
      commonNote: { specialNotes, operationIssue: existing?.operationIssue ?? "", omUpdate: existing?.omUpdate ?? "" },
      commonNoteChanged: specialNotes !== normalized(existing?.specialNotes ?? "")
    });
  }
  return plan;
}

export interface CourseMergeReviewRow {
  item: string;
  companyName: string;
  courseName: string;
  processId: string;
  om: string;
  ld: string;
  roundNo: string;
  period: string;
  value: string;
  operationId: string;
  courseRecordId: string;
}

/** 담당자가 과정 값을 골라야 하는 항목을 회차별 값과 함께 펼친다(값이 있는 회차만). */
export function buildCourseMergeReviewRows(operations: OperationSession[], requests: OmRequest[]): CourseMergeReviewRow[] {
  const courses = groupByCourse(operations);
  const rows: CourseMergeReviewRow[] = [];
  const push = (item: string, round: OperationSession, value: string) => rows.push({
    item,
    companyName: round.companyName,
    courseName: round.courseName,
    processId: round.processId ?? "",
    om: round.om,
    ld: round.ld,
    roundNo: round.roundNo,
    period: round.startDate === round.endDate ? round.startDate : `${round.startDate} ~ ${round.endDate}`,
    value,
    operationId: round.operationId,
    courseRecordId: round.courseRecordId ?? ""
  });

  const linkPlan = planCourseLevelReportLinksBackfill(operations);
  for (const course of linkPlan.courses) {
    const rounds = courses.get(course.courseRecordId) ?? [];
    for (const field of ["lectureManagementLink", "lectureManagementNote"] as const) {
      if (course.fields[field].kind !== "conflict") continue;
      for (const round of rounds) if (round[field].trim()) push(LINK_FIELD_LABELS[field], round, round[field].trim());
    }
  }

  for (const rounds of courses.values()) {
    const existing = rounds.find((round) => round.courseCommonNote)?.courseCommonNote;
    for (const field of COMMON_NOTE_FIELDS) {
      if (normalized(existing?.[field] ?? "")) continue;
      const values = rounds.map((round) => normalized(round[field]));
      const distinct = new Set(values.filter(Boolean));
      const autoFilled = distinct.size === 1 && values.every(Boolean);
      if (distinct.size === 0 || autoFilled) continue;
      for (const round of rounds) if (normalized(round[field])) push(COMMON_NOTE_LABELS[field], round, normalized(round[field]));
    }
  }

  const notesByCourse = requestNotesByCourse(operations, requests);
  for (const [courseRecordId, rounds] of courses) {
    for (const round of rounds) {
      if (round.operationDetail.trim() && classifySyncup(round.operationDetail, notesByCourse.get(courseRecordId)) === "manual") {
        push("싱크업 (링크 아님)", round, round.operationDetail.trim());
      }
    }
  }
  return rows;
}

const CSV_HEADERS = ["항목", "기업", "과정명", "과정ID", "OM", "LD", "회차", "교육기간", "회차별 값", "과정 값으로 쓸 회차(담당자 입력)", "직접 입력할 값(담당자 입력)", "회차 ID", "과정 내부ID"];

function csvField(value: string): string {
  // 엑셀이 =,+,-,@로 시작하는 값을 수식으로 실행하지 않게 막는다.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function courseMergeReviewCsv(rows: CourseMergeReviewRow[]): string {
  const body = rows.map((row) => [row.item, row.companyName, row.courseName, row.processId, row.om, row.ld, row.roundNo, row.period, row.value, "", "", row.operationId, row.courseRecordId]);
  return "﻿" + [CSV_HEADERS, ...body].map((line) => line.map(csvField).join(",")).join("\r\n");
}
