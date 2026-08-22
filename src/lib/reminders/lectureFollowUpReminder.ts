import { normalizePersonName } from "@/lib/data/myOperations";
import { getOperationRepository } from "@/lib/data/operationRepositoryFactory";
import type { OperationSession } from "@/lib/data/operationTypes";
import { splitPersonNames } from "@/lib/data/personNames";
import { listTeamUsers } from "@/lib/data/teamUsers/teamUserRepository";
import type { TeamUser } from "@/lib/data/teamUsers/teamUserTypes";
import { sendSlackDirectMessage } from "@/lib/slack/notifySlack";
import { kstDateString, shiftDateString } from "./reminderDates";
import { appendSentKeys, readSentKeys } from "./reminderSentLog";

// 회차 종료 후 담당 OM에게 개인 DM으로 보내는 마무리 알림.
// D+1: 코스ID·강의관리 시트·만족도 등록 안내. D+7: 아직 안 된 등록 + 운영 회고 작성 안내.
// "등록됨" 판정은 아카이빙 완료 조건(operationCalculations.isArchiveComplete)과 같은
// "값이 비어 있지 않으면 등록됨" 규칙을 쓴다.
// (결과보고서는 필요 여부가 회차마다 달라 이 알림 범위 밖이다.)

export type ReminderStage = "d1" | "d7";

const STAGE_OFFSET_DAYS: Record<ReminderStage, number> = { d1: 1, d7: 7 };

// Slack 이모지 이름은 영문만 되고, 줄 시작의 "*"는 목록이 아니라 굵게 표시 기호로 읽힌다.
// 그래서 하위 항목은 "◦"로 쓴다.
const STAGE_HEADING: Record<ReminderStage, { emoji: string; label: string; suffix: string }> = {
  d1: { emoji: ":pushpin:", label: "어제 종료된 회차", suffix: "(D+1)" },
  d7: { emoji: ":warning:", label: "종료 1주일 경과 회차", suffix: "(D+7 / 확인 필요!)" }
};
const STAGE_ORDER: ReminderStage[] = ["d1", "d7"];
const DEFAULT_MAX_DM_PER_RUN = 50;

export type ReminderBlockedReason = "Slack ID 없음" | "명단에 없음" | "시범 대상 아님";

/** 화이트리스트 상태. off = 아무에게도 안 보냄(기본값), list = 지정한 사람만, all = 전원. */
export type AllowlistMode = "all" | "list" | "off";

export interface ReminderTask {
  stage: ReminderStage;
  operationId: string;
  companyName: string;
  courseName: string;
  roundLabel: string;
  endDate: string;
  todo: string[];
  detailUrl: string;
}

export interface ReminderRecipient {
  omName: string;
  email: null | string;
  slackId: null | string;
  blocked: null | ReminderBlockedReason;
  tasks: ReminderTask[];
  message: string;
  sent: boolean;
}

export interface ReminderSkippedSession {
  stage: ReminderStage;
  operationId: string;
  companyName: string;
  courseName: string;
  roundLabel: string;
  endDate: string;
  reason: string;
}

export interface ReminderRunSummary {
  ok: boolean;
  dryRun: boolean;
  today: string;
  targetDates: Record<ReminderStage, string>;
  allowlistMode: AllowlistMode;
  matchedSessions: number;
  skippedComplete: number;
  skippedAlreadySent: number;
  unassignedSessions: ReminderSkippedSession[];
  recipients: ReminderRecipient[];
  sentCount: number;
  failedCount: number;
  warning?: string;
}

export async function runLectureFollowUpReminders(options: {
  dryRun: boolean;
  now?: Date;
}): Promise<ReminderRunSummary> {
  const today = kstDateString(options.now ?? new Date());
  const targetDates = {
    d1: shiftDateString(today, -STAGE_OFFSET_DAYS.d1),
    d7: shiftDateString(today, -STAGE_OFFSET_DAYS.d7)
  } satisfies Record<ReminderStage, string>;

  const [operations, teamUsers] = await Promise.all([
    getOperationRepository().listOperations(),
    loadTeamUsers()
  ]);

  const sentKeys = readSentKeys();
  const allowlist = readAllowlist();
  const unassignedSessions: ReminderSkippedSession[] = [];
  const tasksByOm = new Map<string, { omName: string; tasks: ReminderTask[] }>();
  let matchedSessions = 0;
  let skippedComplete = 0;
  let skippedAlreadySent = 0;

  for (const operation of operations) {
    const stage = resolveStage(operation.endDate, targetDates);
    if (!stage) continue;

    matchedSessions += 1;

    const todo = buildTodo(operation, stage);
    if (todo.length === 0) {
      skippedComplete += 1;
      continue;
    }

    const task = buildTask(operation, stage, todo);
    const omNames = splitPersonNames(operation.om, "").filter((name) => name.trim());

    if (omNames.length === 0) {
      unassignedSessions.push({ ...sessionRef(operation, stage), reason: "담당 OM 없음" });
      continue;
    }

    for (const omName of omNames) {
      const normalized = normalizePersonName(omName);
      if (!normalized) continue;

      if (sentKeys.has(sentKey(today, task, normalized))) {
        skippedAlreadySent += 1;
        continue;
      }

      const bucket = tasksByOm.get(normalized);
      if (bucket) {
        bucket.tasks.push(task);
      } else {
        tasksByOm.set(normalized, { omName, tasks: [task] });
      }
    }
  }

  const recipients: ReminderRecipient[] = [...tasksByOm.values()]
    .map(({ omName, tasks }) => buildRecipient(omName, sortTasks(tasks), teamUsers, allowlist, today))
    .sort((a, b) => a.omName.localeCompare(b.omName, "ko"));

  const sendable = recipients.filter((recipient) => !recipient.blocked);
  const maxPerRun = readMaxDmPerRun();

  if (!options.dryRun && sendable.length > maxPerRun) {
    // 날짜 계산이나 데이터가 틀어졌을 때 전 직원에게 DM이 쏟아지는 것을 막는 안전장치.
    return {
      ok: false,
      dryRun: options.dryRun,
      today,
      targetDates,
      allowlistMode: allowlist.mode,
      matchedSessions,
      skippedComplete,
      skippedAlreadySent,
      unassignedSessions,
      recipients,
      sentCount: 0,
      failedCount: 0,
      warning: `발송 대상 ${sendable.length}명이 1회 상한(${maxPerRun}명)을 넘어 발송을 중단했습니다. 미리보기로 확인한 뒤 REMINDER_MAX_DM_PER_RUN을 조정하세요.`
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  const newlySentKeys: string[] = [];

  if (!options.dryRun) {
    for (const recipient of sendable) {
      const delivered = await sendSlackDirectMessage(recipient.slackId ?? "", recipient.message);

      if (delivered) {
        recipient.sent = true;
        sentCount += 1;
        for (const task of recipient.tasks) {
          newlySentKeys.push(sentKey(today, task, normalizePersonName(recipient.omName)));
        }
      } else {
        failedCount += 1;
      }
    }

    appendSentKeys(today, newlySentKeys);
  }

  return {
    ok: true,
    dryRun: options.dryRun,
    today,
    targetDates,
    allowlistMode: allowlist.mode,
    matchedSessions,
    skippedComplete,
    skippedAlreadySent,
    unassignedSessions,
    recipients,
    sentCount,
    failedCount
  };
}

function resolveStage(endDate: string, targetDates: Record<ReminderStage, string>): null | ReminderStage {
  const value = endDate.trim();
  if (!value) return null;

  for (const stage of STAGE_ORDER) {
    if (value === targetDates[stage]) return stage;
  }

  return null;
}

/** 아직 안 된 일만 남긴다. 비면 알림을 보내지 않는다. 순서는 운영 상세 입력 순서를 따른다. */
function buildTodo(operation: OperationSession, stage: ReminderStage): string[] {
  const todo: string[] = [];

  if (!operation.courseId.trim()) todo.push("코스ID 등록");
  if (!operation.lectureManagementNote.trim()) todo.push("강의관리 등록");
  // 조사하지 않기로 한 회차는 등록할 값이 없으므로 재촉하지 않는다(아카이빙 완료 조건과 같은 규칙).
  if (operation.hasSatisfactionSurvey !== "불필요" && !operation.avgSatisfaction.trim()) {
    todo.push("만족도 등록");
  }
  if (stage === "d7" && needsRetrospective(operation)) todo.push("운영 회고 작성");

  return todo;
}

/** 회고는 상세화면 "이슈 / 회고"의 회고 칸(operationIssue) 또는 상태 "회고완료"로 판단한다. */
function needsRetrospective(operation: OperationSession): boolean {
  return !(operation.operationStatus === "회고완료" || operation.operationIssue.trim());
}

function buildTask(operation: OperationSession, stage: ReminderStage, todo: string[]): ReminderTask {
  return {
    ...sessionRef(operation, stage),
    todo,
    detailUrl: `${baseUrl()}/operations/${encodeURIComponent(operation.operationId)}`
  };
}

function sessionRef(operation: OperationSession, stage: ReminderStage) {
  return {
    stage,
    operationId: operation.operationId,
    companyName: operation.companyName,
    courseName: operation.courseName,
    roundLabel: roundLabel(operation.roundNo),
    endDate: operation.endDate
  };
}

function roundLabel(roundNo: string): string {
  const value = roundNo.trim();
  if (!value) return "";

  return value.includes("회차") ? value : `${value}회차`;
}

function sortTasks(tasks: ReminderTask[]): ReminderTask[] {
  return [...tasks].sort((a, b) => {
    if (a.stage !== b.stage) return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
    return a.companyName.localeCompare(b.companyName, "ko");
  });
}

function buildRecipient(
  omName: string,
  tasks: ReminderTask[],
  teamUsers: TeamUser[],
  allowlist: { emails: Set<string>; mode: AllowlistMode },
  today: string
): ReminderRecipient {
  const normalized = normalizePersonName(omName);
  const user = teamUsers.find((candidate) => normalizePersonName(candidate.name) === normalized);
  const email = user?.email?.trim() ?? "";
  const slackId = user?.slackId?.trim() ?? "";

  return {
    omName,
    email: email || null,
    slackId: slackId || null,
    blocked: resolveBlockedReason(user, slackId, email, allowlist),
    tasks,
    message: buildMessage(omName, tasks, today),
    sent: false
  };
}

function resolveBlockedReason(
  user: TeamUser | undefined,
  slackId: string,
  email: string,
  allowlist: { emails: Set<string>; mode: AllowlistMode }
): null | ReminderBlockedReason {
  if (!user) return "명단에 없음";
  if (!slackId) return "Slack ID 없음";
  if (allowlist.mode === "all") return null;
  if (allowlist.mode === "list" && allowlist.emails.has(email.toLowerCase())) return null;

  return "시범 대상 아님";
}

function buildMessage(omName: string, tasks: ReminderTask[], today: string): string {
  const lines = [
    `:bell: *운영 마무리 알림* (${shortDate(today)})`,
    `${omName}님, 담당하신 과정 중 *아직 미입력된 항목*이 있어 안내드립니다!`,
    "아래의 링크에서 확인 후 데이터를 입력해주세요."
  ];

  for (const stage of STAGE_ORDER) {
    const stageTasks = tasks.filter((task) => task.stage === stage);
    if (stageTasks.length === 0) continue;

    const heading = STAGE_HEADING[stage];
    lines.push("", "", `*${heading.emoji} ${heading.label}* ${heading.suffix}`);

    for (const task of stageTasks) {
      const courseLabel = [task.courseName, task.roundLabel].filter(Boolean).join(" ");
      const title = [task.companyName, courseLabel].filter(Boolean).join(" / ");
      lines.push(`• *${title}* (종료 ${shortDate(task.endDate)})`);
      lines.push(`   ◦ 미입력 : ${task.todo.join(", ")}`);
      lines.push(`   ◦ :point_right: <${task.detailUrl}|사이트로 이동하기>`);
    }
  }

  lines.push("", "", "확인 후 작성을 부탁드립니다.");

  return lines.join("\n");
}

/** 2026-08-19 → 26-08-19 */
function shortDate(dateString: string): string {
  return dateString.trim().replace(/^\d{2}(\d{2}-\d{2}-\d{2})$/, "$1");
}

async function loadTeamUsers(): Promise<TeamUser[]> {
  try {
    return await listTeamUsers();
  } catch (error) {
    console.error("[reminder] 팀원 명단 조회 실패:", error);
    return [];
  }
}

/**
 * 시범 운영용 화이트리스트.
 * 값이 없으면 아무에게도 보내지 않는다(배포만으로 전원에게 DM이 가는 사고를 막는 기본값).
 * 전원 발송은 SLACK_REMINDER_ONLY_EMAILS=ALL 로 명시한다.
 */
function readAllowlist(): { emails: Set<string>; mode: AllowlistMode } {
  const raw = process.env.SLACK_REMINDER_ONLY_EMAILS?.trim() ?? "";
  if (!raw) return { emails: new Set(), mode: "off" };
  if (raw.toUpperCase() === "ALL" || raw === "*") return { emails: new Set(), mode: "all" };

  const emails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return emails.length > 0 ? { emails: new Set(emails), mode: "list" } : { emails: new Set(), mode: "off" };
}

function readMaxDmPerRun(): number {
  const parsed = Number(process.env.REMINDER_MAX_DM_PER_RUN?.trim());

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_DM_PER_RUN;
}

function baseUrl(): string {
  const raw = process.env.HUB_OM_BASE_URL?.trim() || process.env.AUTH_URL?.trim() || "https://hub-om.skillflo.app";

  return raw.replace(/\/+$/, "");
}

function sentKey(today: string, task: ReminderTask, normalizedOmName: string): string {
  return `${today}|${task.stage}|${task.operationId}|${normalizedOmName}`;
}
