import { getDataRepositoryOverride } from "../dataRepositoryContext";
import { getOmRequestRepository } from "./omRequestRepositoryFactory";
import { updateOmRequestAssignment as legacyAssignment } from "./legacyOmRequestRepository";
import type { OmRequestInput } from "./omRequestTypes";

export function listOmRequests() { return getOmRequestRepository().listOmRequests(); }
export function getOmRequest(id: string) { return getOmRequestRepository().getOmRequest(id); }
export function createOmRequest(input: OmRequestInput) { return getOmRequestRepository().createOmRequest(input); }
export function updateOmRequest(id: string, input: OmRequestInput) { return getOmRequestRepository().updateOmRequest(id, input); }
export function deleteOmRequest(id: string) { return getOmRequestRepository().deleteOmRequest(id); }
export function setOmRequestOperationId(id: string, operationId: string) { return getOmRequestRepository().setOmRequestOperationId(id, operationId); }
export function setOmRequestSlackMeta(id: string, meta: { ldEmail?: string; slackChannel?: string; slackThreadTs?: string }) { return getOmRequestRepository().setOmRequestSlackMeta(id, meta); }

// The confirmed multi-round assignment boundary is a separate migration unit.
export async function updateOmRequestAssignment(id: string, assignedOm: string | null) {
  if (getDataRepositoryOverride("omRequests")) throw new Error("OM_ASSIGNMENT_MONGO_NOT_IMPLEMENTED");
  return legacyAssignment(id, assignedOm);
}
