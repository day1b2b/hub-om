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

export function updateOmRequestAssignment(id: string, assignedOm: string | null): OmRequest | null {
  const requests = readAll();
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const om = assignedOm?.trim() || null;
  requests[idx] = { ...requests[idx], assignedOm: om ?? undefined, status: om ? "배정완료" : "배정필요" };
  writeAll(requests);
  return requests[idx];
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
  const next = requests.filter((r) => r.id !== id);
  if (next.length === requests.length) return false;
  writeAll(next);
  return true;
}
