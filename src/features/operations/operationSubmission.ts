import { parseEducationDatesText } from "@/lib/data/operationCalculations";

export interface OperationSubmission {
  version: 2;
  owner: string;
  expectedSubject: string;
  team: string;
  id: string;
  payloads: Record<string, string>[];
  hasResultReport: "Y" | "N";
}

/** Adapter methods resolve only after the encrypted storage transaction commits. */
export interface OperationSubmissionStore {
  owner: string;
  expectedSubject: string;
  read(): Promise<unknown>;
  write(value: OperationSubmission): Promise<void>;
  clear(): Promise<void>;
  assertCurrent(): void;
}

export class OperationSubmissionValidationError extends Error {
  override name = "OperationSubmissionValidationError";
}

/** Legacy records are not read, assigned to the current account, or removed. */
export function hasLegacyOperationSubmission(storage: Pick<Storage, "length" | "key">): boolean {
  for (let index = 0; index < storage.length; index++) {
    if (storage.key(index)?.startsWith("hub-om:operation-submission:v1:")) return true;
  }
  return false;
}

export async function readOperationSubmission(storage: OperationSubmissionStore, team: string): Promise<OperationSubmission | null> {
  storage.assertCurrent();
  const value = await storage.read() as OperationSubmission | null;
  storage.assertCurrent();
  if (value === null || value === undefined) return null;
  if (!value || value.version !== 2 || value.owner !== storage.owner || value.expectedSubject !== storage.expectedSubject || value.team !== team ||
    typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.id) ||
    !["Y", "N"].includes(value.hasResultReport) || !Array.isArray(value.payloads) || !value.payloads.length ||
    value.payloads.some((body) => !body || typeof body !== "object" || Array.isArray(body) || Object.values(body).some((item) => typeof item !== "string")) ||
    !value.payloads[0].companyName || !value.payloads[0].courseName) {
    throw new Error("이전 등록 정보를 확인할 수 없습니다. 중복 등록을 막기 위해 저장을 중단했습니다.");
  }
  return value;
}

export async function persistOperationSubmission(storage: OperationSubmissionStore, submission: OperationSubmission): Promise<void> {
  storage.assertCurrent();
  if (submission.owner !== storage.owner || submission.expectedSubject !== storage.expectedSubject) throw new Error("로그인 계정이 변경되었습니다. 이전 입력을 보존하고 저장을 중단했습니다.");
  validateSubmissionDates(submission);
  await storage.write(submission);
  storage.assertCurrent();
}

function validateSubmissionDates(submission: OperationSubmission): void {
  for (const [index, body] of submission.payloads.entries()) {
    const parsed = parseEducationDatesText(body.educationDates ?? "");
    const start = parsed.dates[0] ?? body.startDate;
    const end = parsed.dates.at(-1) ?? body.endDate ?? start;
    const valid = (value: string | undefined): value is string => {
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (parsed.errors.length || !valid(start) || !valid(end) || start > end) {
      throw new Error(`${body.roundNo || index + 1}회차의 유효한 시작일·종료일과 날짜 순서를 확인해주세요. 아직 등록을 시작하지 않았습니다.`);
    }
  }
}

export async function clearOperationSubmission(storage: OperationSubmissionStore): Promise<void> {
  storage.assertCurrent();
  await storage.clear();
  storage.assertCurrent();
}

/** Encrypt and durably commit the exact request before the first network action. */
export async function persistAndSubmitOperation(storage: OperationSubmissionStore, submission: OperationSubmission, request: typeof fetch = fetch): Promise<string> {
  await persistOperationSubmission(storage, submission);
  return submitOperationSnapshot(submission, request, () => storage.assertCurrent());
}

export async function submitOperationSnapshot(submission: OperationSubmission, request: typeof fetch = fetch, assertCurrent: () => void = () => {}): Promise<string> {
  assertCurrent();
  const operationIds: string[] = [];
  for (const [index, body] of submission.payloads.entries()) {
    const url = index === 0 ? "/api/operations" : `/api/operations/${encodeURIComponent(operationIds[0])}/rounds`;
    assertCurrent();
    const response = await request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Operation-Submission-Subject": submission.expectedSubject, "Idempotency-Key": `${submission.id}:${index}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; creationNotStarted?: boolean; operation?: { operationId?: string } };
    assertCurrent();
    if (index === 0 && response.status === 400 && result.creationNotStarted === true) {
      throw new OperationSubmissionValidationError(result.error ?? "입력값을 확인해주세요.");
    }
    if (!response.ok || !result.ok || !result.operation?.operationId) {
      throw new Error(result.error ?? `${body.roundNo}회차를 등록하지 못했습니다. 원래 등록 계속하기로 다시 시도해주세요.`);
    }
    operationIds.push(result.operation.operationId);
  }
  if (submission.hasResultReport === "N") {
    for (const id of operationIds) {
      assertCurrent();
      const response = await request(`/api/operations/${encodeURIComponent(id)}/drive-import/apply`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Operation-Submission-Subject": submission.expectedSubject },
        body: JSON.stringify({ patches: [{ field: "hasResultReport", action: "replace", value: "불필요" }] }),
        signal: AbortSignal.timeout(30_000)
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean };
      assertCurrent();
      if (!response.ok || !result.ok) throw new Error("회차는 등록되었지만 결과보고서 설정을 저장하지 못했습니다. 원래 등록 계속하기로 다시 시도해주세요.");
    }
  }
  return operationIds[0];
}
