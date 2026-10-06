import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveNullableDate, archiveNullableTimestamp, archiveRequiredTimestamp, coachArchivePatch } from "./coachArchiveServiceBackfillValues";

test("archive service values preserve legacy empty/null rules and validate dates", () => {
  const patch = coachArchivePatch({ access_token: "", status_note: "", return_date: "2099-02-03T12:34:00Z", self_note: null });
  assert.equal(patch.accessToken, ""); assert.equal(patch.statusNote, null); assert.deepEqual(patch.returnDate, new Date("2099-02-03T00:00:00.000Z"));
  assert.equal(patch.selfNote, null);
  assert.throws(() => archiveNullableDate("2099-02-30", "return_date"));
  assert.throws(() => archiveRequiredTimestamp("invalid", "accessed_at"));
  assert.deepEqual(archiveRequiredTimestamp("2099-02-04 01:02:03+09", "accessed_at"), new Date("2099-02-04T01:02:03.000Z"));
  assert.equal(archiveNullableTimestamp("", "last_edited_at"), null);
  assert.deepEqual(archiveNullableTimestamp("2099-02-05T01:02:03+09:00", "last_edited_at"), new Date("2099-02-05T01:02:03.000Z"));
});
