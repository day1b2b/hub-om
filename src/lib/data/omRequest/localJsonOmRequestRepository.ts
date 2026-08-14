// 로컬(dev) 전용 저장소. .local/ 은 gitignore라 배포에 올라가지 않는다.
// 배포 저장은 PrismaOmRequestRepository가 담당한다.
import fs from "fs";
import path from "path";
import type { OmRequestRepository } from "./omRequestRepository";
import type { OmRequest, OmRequestInput } from "./omRequestTypes";

const DATA_FILE = path.join(process.cwd(), ".local", "om-requests.json");

function readAll(): OmRequest[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as OmRequest[];
  } catch {
    return [];
  }
}

function writeAll(requests: OmRequest[]) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2), "utf-8");
}

export class LocalJsonOmRequestRepository implements OmRequestRepository {
  async listOmRequests(): Promise<OmRequest[]> {
    return readAll();
  }

  async getOmRequest(id: string): Promise<OmRequest | null> {
    return readAll().find((r) => r.id === id) ?? null;
  }

  async createOmRequest(input: OmRequestInput): Promise<OmRequest> {
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

  async updateOmRequest(id: string, input: OmRequestInput): Promise<OmRequest | null> {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    requests[idx] = { ...requests[idx], ...input };
    writeAll(requests);
    return requests[idx];
  }

  async deleteOmRequest(id: string): Promise<boolean> {
    const requests = readAll();
    const filtered = requests.filter((r) => r.id !== id);
    if (filtered.length === requests.length) return false;
    writeAll(filtered);
    return true;
  }

  async updateOmRequestAssignment(id: string, assignedOm: string | null): Promise<OmRequest | null> {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const om = assignedOm?.trim() || null;
    requests[idx] = { ...requests[idx], assignedOm: om ?? undefined, status: om ? "배정완료" : "배정필요" };
    writeAll(requests);
    return requests[idx];
  }

  async setOmRequestOperationId(id: string, operationId: string): Promise<void> {
    const requests = readAll();
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1) return;
    requests[idx] = { ...requests[idx], operationId };
    writeAll(requests);
  }
}
