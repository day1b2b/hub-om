// 기획서 테스트용 업무요청 저장소·Slack 가짜. 실제 연결 로직(omRequestOperationLink 등)은 그대로 돌린다.
import { mock } from "node:test";
import { runWithDataRepositories } from "@/lib/data/dataRepositoryContext";
import type { OmRequestRepository } from "@/lib/data/omRequest/omRequestRepository";
import type { OmRequest } from "@/lib/data/omRequest/omRequestTypes";

export const omRequest = {
  assignedOm: "기존 OM" as string | null,
  syncCalls: [] as Array<[string, string | null]>,
  slackMessages: [] as Array<Record<string, unknown>>,
  slackFails: false,
  reset() { this.assignedOm = "기존 OM"; this.syncCalls = []; this.slackMessages = []; this.slackFails = false; }
};

export async function installSlackFake() {
  const real = await import("@/lib/slack/notifySlack") as Record<string, unknown>;
  mock.module("@/lib/slack/notifySlack", { namedExports: { ...real, notifyOmAssigned: async (input: Record<string, unknown>) => {
    if (omRequest.slackFails) throw new Error("simulated Slack failure");
    omRequest.slackMessages.push(input);
  } } });
}

/** 연결된 업무요청이 하나 있는 상태로 work를 실행한다. */
export function withLinkedOmRequest<T>(work: () => Promise<T>): Promise<T> {
  const omRequests = { async syncAssignedOmByOperationId(operationId: string, assignedOm: string | null) {
    omRequest.syncCalls.push([operationId, assignedOm]);
    omRequest.assignedOm = assignedOm;
    return { company: "기업", courseName: "과정", assignedOm, ld: "LD", ldEmail: "ld@example.invalid",
      slackChannel: "CHANNEL", slackThreadTs: "thread-ts" } as OmRequest;
  } } as unknown as OmRequestRepository;
  return runWithDataRepositories({ omRequests }, work);
}
