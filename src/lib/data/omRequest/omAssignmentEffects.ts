import { getDataRepositoryOverride } from "../dataRepositoryContext";
import type { reflectOperationUpdated } from "../../googleCalendar/reflectOperationToCalendar";
import type { notifyOmAssigned } from "../../slack/notifySlack";
export interface OmAssignmentCalendar { reflectOperationUpdated: typeof reflectOperationUpdated }
export interface OmAssignmentNotifier { notifyAssigned: typeof notifyOmAssigned }
export function getOmAssignmentCalendar(): OmAssignmentCalendar {
  return getDataRepositoryOverride("omAssignmentCalendar") ?? {
    async reflectOperationUpdated(operation) {
      const { reflectOperationUpdated } = await import("../../googleCalendar/reflectOperationToCalendar");
      return reflectOperationUpdated(operation);
    }
  };
}
export function getOmAssignmentNotifier(): OmAssignmentNotifier {
  return getDataRepositoryOverride("omAssignmentNotifier") ?? {
    async notifyAssigned(input) {
      const { notifyOmAssigned } = await import("../../slack/notifySlack");
      return notifyOmAssigned(input);
    }
  };
}
