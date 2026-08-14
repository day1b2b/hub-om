import fs from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../prisma";
import type { OmRequest, OmRequestInput, OmRequestSession, TrainingType, YN } from "./omRequestTypes";

// OM 요청 저장소. 운영(Postgres)에서는 om_requests 테이블을 쓰고,
// 로컬 개발(DATABASE_URL 없음 또는 OPERATION_DATA_SOURCE=local)에서는
// 기존처럼 om-requests.json 파일에 저장한다. team-users 저장소와 같은 패턴.
const DATA_FILE = path.join(process.cwd(), "om-requests.json");

function hasDatabaseUrl(): boolean {
  return process.env.OPERATION_DATA_SOURCE !== "local" && Boolean(process.env.DATABASE_URL);
}

// ── 로컬 파일 백업 경로(개발 전용) ─────────────────────────────────
function readAll(): OmRequest[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as OmRequest[];
  } catch {
    return [];
  }
}

function writeAll(requests: OmRequest[]) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2), "utf-8");
}

// ── Prisma row ↔ OmRequest 매핑 ────────────────────────────────────
interface OmRequestRow {
  id: string;
  status: string;
  assignedOm: string | null;
  operationId: string | null;
  ldEmail: string | null;
  slackChannel: string | null;
  slackThreadTs: string | null;
  team: string;
  ld: string;
  company: string;
  businessNumber: string | null;
  trainingType: string;
  courseId: string;
  courseName: string;
  courseCategoryMajor: string | null;
  courseCategory: string;
  tools: string | null;
  instructorName: string;
  syncupLink: string;
  driveLink: string;
  skillfloSetup: string;
  skillmatchSetup: string;
  onSiteOperation: string;
  coachRequest: string;
  totalSessions: number;
  sessions: unknown;
  notes: string;
  createdAt: Date;
}

function toOmRequest(row: OmRequestRow): OmRequest {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    status: row.status === "배정완료" ? "배정완료" : "배정필요",
    assignedOm: row.assignedOm ?? undefined,
    operationId: row.operationId ?? undefined,
    ldEmail: row.ldEmail ?? undefined,
    slackChannel: row.slackChannel ?? undefined,
    slackThreadTs: row.slackThreadTs ?? undefined,
    team: row.team,
    ld: row.ld,
    company: row.company,
    businessNumber: row.businessNumber ?? undefined,
    trainingType: row.trainingType as TrainingType,
    courseId: row.courseId,
    courseName: row.courseName,
    courseCategoryMajor: row.courseCategoryMajor ?? undefined,
    courseCategory: row.courseCategory,
    tools: row.tools ?? undefined,
    instructorName: row.instructorName,
    syncupLink: row.syncupLink,
    driveLink: row.driveLink,
    skillfloSetup: row.skillfloSetup as YN,
    skillmatchSetup: row.skillmatchSetup as YN,
    onSiteOperation: row.onSiteOperation as YN,
    coachRequest: row.coachRequest as YN,
    totalSessions: row.totalSessions,
    sessions: (row.sessions as OmRequestSession[] | null) ?? [],
    notes: row.notes,
  };
}

// Prisma create/update용 컬럼 데이터(입력 필드만).
function toInputData(input: OmRequestInput) {
  return {
    team: input.team,
    ld: input.ld,
    company: input.company,
    businessNumber: input.businessNumber ?? null,
    trainingType: input.trainingType,
    courseId: input.courseId,
    courseName: input.courseName,
    courseCategoryMajor: input.courseCategoryMajor ?? null,
    courseCategory: input.courseCategory,
    tools: input.tools ?? null,
    instructorName: input.instructorName,
    syncupLink: input.syncupLink,
    driveLink: input.driveLink,
    skillfloSetup: input.skillfloSetup,
    skillmatchSetup: input.skillmatchSetup,
    onSiteOperation: input.onSiteOperation,
    coachRequest: input.coachRequest,
    totalSessions: input.totalSessions,
    sessions: input.sessions as unknown as Prisma.InputJsonValue,
    notes: input.notes,
  };
}

// ── 공개 API ───────────────────────────────────────────────────────
export async function listOmRequests(): Promise<OmRequest[]> {
  if (!hasDatabaseUrl()) return readAll();
  const prisma = getPrismaClient();
  const rows = await prisma.omRequest.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((row) => toOmRequest(row as OmRequestRow));
}

export async function getOmRequest(id: string): Promise<OmRequest | null> {
  if (!hasDatabaseUrl()) return readAll().find((r) => r.id === id) ?? null;
  const prisma = getPrismaClient();
  const row = await prisma.omRequest.findUnique({ where: { id } });
  return row ? toOmRequest(row as OmRequestRow) : null;
}

export async function createOmRequest(input: OmRequestInput): Promise<OmRequest> {
  if (!hasDatabaseUrl()) {
    const requests = readAll();
    const newRequest: OmRequest = {
      ...input,
      id: `omr-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: "배정필요",
    };
    writeAll([...requests, newRequest]);
    return newRequest;
  }
  const prisma = getPrismaClient();
  const row = await prisma.omRequest.create({
    data: { ...toInputData(input), status: "배정필요" },
  });
  return toOmRequest(row as OmRequestRow);
}

export async function updateOmRequest(id: string, input: OmRequestInput): Promise<OmRequest | null> {
  if (!hasDatabaseUrl()) {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    requests[idx] = { ...requests[idx], ...input };
    writeAll(requests);
    return requests[idx];
  }
  const prisma = getPrismaClient();
  const existing = await prisma.omRequest.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.omRequest.update({ where: { id }, data: toInputData(input) });
  return toOmRequest(row as OmRequestRow);
}

export async function deleteOmRequest(id: string): Promise<boolean> {
  if (!hasDatabaseUrl()) {
    const requests = readAll();
    const filtered = requests.filter((r) => r.id !== id);
    if (filtered.length === requests.length) return false;
    writeAll(filtered);
    return true;
  }
  const prisma = getPrismaClient();
  const existing = await prisma.omRequest.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.omRequest.delete({ where: { id } });
  return true;
}

// 접수 직후, 자동 생성한 운영현황 회차(첫 차수)의 operationId를 기록한다.
// 생성 자체가 best-effort라 실패하면 호출되지 않을 수 있다(omRequestOperationLink.ts 참고).
export async function setOmRequestOperationId(id: string, operationId: string): Promise<OmRequest | null> {
  if (!hasDatabaseUrl()) {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    requests[idx] = { ...requests[idx], operationId };
    writeAll(requests);
    return requests[idx];
  }
  const prisma = getPrismaClient();
  const existing = await prisma.omRequest.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.omRequest.update({ where: { id }, data: { operationId } });
  return toOmRequest(row as OmRequestRow);
}

// 요청 생성 직후, 발송한 Slack 알림의 채널/스레드ts와 LD 이메일을 기록한다.
// 배정 시점에 같은 스레드로 댓글을 달고 LD를 태깅하기 위한 값이다.
export async function setOmRequestSlackMeta(
  id: string,
  meta: { ldEmail?: string; slackChannel?: string; slackThreadTs?: string }
): Promise<OmRequest | null> {
  const patch = {
    ...(meta.ldEmail ? { ldEmail: meta.ldEmail } : {}),
    ...(meta.slackChannel ? { slackChannel: meta.slackChannel } : {}),
    ...(meta.slackThreadTs ? { slackThreadTs: meta.slackThreadTs } : {}),
  };
  if (!hasDatabaseUrl()) {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    requests[idx] = { ...requests[idx], ...patch };
    writeAll(requests);
    return requests[idx];
  }
  const prisma = getPrismaClient();
  const existing = await prisma.omRequest.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.omRequest.update({ where: { id }, data: patch });
  return toOmRequest(row as OmRequestRow);
}

export async function updateOmRequestAssignment(
  id: string,
  assignedOm: string | null
): Promise<OmRequest | null> {
  const om = assignedOm?.trim() || null;
  const status = om ? "배정완료" : "배정필요";
  if (!hasDatabaseUrl()) {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    requests[idx] = { ...requests[idx], assignedOm: om ?? undefined, status };
    writeAll(requests);
    return requests[idx];
  }
  const prisma = getPrismaClient();
  const existing = await prisma.omRequest.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.omRequest.update({
    where: { id },
    data: { assignedOm: om, status },
  });
  return toOmRequest(row as OmRequestRow);
}
