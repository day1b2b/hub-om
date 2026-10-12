import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithDataRepositories } from "../dataRepositoryContext";
import type { OmRequestRepository } from "./omRequestRepository";
import type { OmRequest } from "./omRequestTypes";
import { syncLinkedOmRequestAssignment } from "./omRequestOperationLink";

test("operation-detail assignment and reassignment notify the original thread only after storage succeeds", async () => {
  const messages: unknown[] = [];
  let exists = true, fail = false;
  const omRequests = { async syncAssignedOmByOperationId(_id: string, assignedOm: string | null) {
    if (fail) throw new Error("storage failure");
    return exists ? { company: "Synthetic", courseName: "Synthetic course", assignedOm, ld: "LD",
      ldEmail: "ld@example.invalid", slackChannel: "CHANNEL", slackThreadTs: "123.456" } as OmRequest : null;
  } } as OmRequestRepository;
  await runWithDataRepositories({ omRequests }, async () => {
    const notify = async (input: unknown) => { messages.push(input); };
    await syncLinkedOmRequestAssignment("operation", "First", null, notify);
    await syncLinkedOmRequestAssignment("operation", "Second", "First", notify);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[1], { company: "Synthetic", courseName: "Synthetic course", assignedOm: "Second",
      ld: "LD", ldEmail: "ld@example.invalid", channel: "CHANNEL", threadTs: "123.456" });
    await syncLinkedOmRequestAssignment("operation", " Second ", "Second", notify);
    await syncLinkedOmRequestAssignment("operation", null, "Second", notify);
    await syncLinkedOmRequestAssignment("operation", "배정필요", "Second", notify);
    exists = false;
    await syncLinkedOmRequestAssignment("operation", "Third", "Second", notify);
    assert.equal(messages.length, 2);
    fail = true;
    await assert.rejects(syncLinkedOmRequestAssignment("operation", "Third", "Second", notify), /storage failure/);
    assert.equal(messages.length, 2);
    fail = false; exists = true;
    await assert.doesNotReject(syncLinkedOmRequestAssignment("operation", "Third", "Second", async () => { throw new Error("Slack unavailable"); }));
  });
});
