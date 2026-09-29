import { getDataRepositoryOverride } from "../dataRepositoryContext";
import * as legacy from "./legacyOmRequestRepository";
import type { OmRequestRepository, OmRequestNotifier } from "./omRequestRepository";

export function getOmRequestRepository(): OmRequestRepository {
  return getDataRepositoryOverride("omRequests") ?? legacy;
}
export function getOmRequestNotifier(): OmRequestNotifier {
  return getDataRepositoryOverride("omRequestNotifier") ?? {
    async notifyCreated(input) {
      const { notifyOmRequestCreated } = await import("../../slack/notifySlack");
      return notifyOmRequestCreated(input);
    }
  };
}
