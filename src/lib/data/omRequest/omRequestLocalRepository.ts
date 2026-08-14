import fs from "fs";
import path from "path";
import type { OmRequest, OmRequestInput } from "./omRequestTypes";

const DATA_FILE = path.join(process.cwd(), "om-requests.json");

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

export function listOmRequests(): OmRequest[] {
  return readAll();
}

export function getOmRequest(id: string): OmRequest | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function createOmRequest(input: OmRequestInput): OmRequest {
  const requests = readAll();
  const newRequest: OmRequest = {
    ...input,
    id: `omr-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "배정필요"
  };
  writeAll([...requests, newRequest]);
  return newRequest;
}

export function updateOmRequest(id: string, input: OmRequestInput): OmRequest | null {
  const requests = readAll();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  requests[idx] = { ...requests[idx], ...input };
  writeAll(requests);
  return requests[idx];
}

export function deleteOmRequest(id: string): boolean {
  const requests = readAll();
  const filtered = requests.filter((r) => r.id !== id);
  if (filtered.length === requests.length) return false;
  writeAll(filtered);
  return true;
}

// 요청 생성 직후, 발송한 Slack 알림의 채널/스레드ts와 LD 이메일을 기록한다.
// 배정 시점에 같은 스레드로 댓글을 달고 LD를 태깅하기 위한 값이다.
export function setOmRequestSlackMeta(
  id: string,
  meta: { ldEmail?: string; slackChannel?: string; slackThreadTs?: string }
): OmRequest | null {
  const requests = readAll();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  requests[idx] = {
    ...requests[idx],
    ...(meta.ldEmail ? { ldEmail: meta.ldEmail } : {}),
    ...(meta.slackChannel ? { slackChannel: meta.slackChannel } : {}),
    ...(meta.slackThreadTs ? { slackThreadTs: meta.slackThreadTs } : {}),
  };
  writeAll(requests);
  return requests[idx];
}

export function updateOmRequestAssignment(id: string, assignedOm: string | null): OmRequest | null {
  const requests = readAll();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const om = assignedOm?.trim() || null;
  requests[idx] = { ...requests[idx], assignedOm: om ?? undefined, status: om ? "배정완료" : "배정필요" };
  writeAll(requests);
  return requests[idx];
}
