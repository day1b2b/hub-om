import type { OmRequest, OmRequestInput } from "./omRequestTypes";
import type { notifyOmRequestCreated } from "../../slack/notifySlack";

export interface OmRequestRepository {
  listOmRequests(): Promise<OmRequest[]>;
  getOmRequest(id: string): Promise<OmRequest | null>;
  createOmRequest(input: OmRequestInput): Promise<OmRequest>;
  updateOmRequest(id: string, input: OmRequestInput): Promise<OmRequest | null>;
  deleteOmRequest(id: string): Promise<boolean>;
  setOmRequestOperationId(id: string, operationId: string): Promise<OmRequest | null>;
  syncAssignedOmByOperationId?(operationId: string, assignedOm: string | null): Promise<OmRequest | null>;
  setOmRequestSlackMeta(id: string, meta: { ldEmail?: string; slackChannel?: string; slackThreadTs?: string }): Promise<OmRequest | null>;
}
export interface OmCustomToolsRepository { list(): string[]; add(names: string[]): void }
export interface OmRequestNotifier { notifyCreated: typeof notifyOmRequestCreated }
