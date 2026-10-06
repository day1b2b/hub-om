import { coachFixtureRow } from "./mongoCoachFixtures";
import type { MongoRow } from "./mongoOperationStore";
/** Fixed synthetic baseline, independently transcribed from 1a7323b's PG implementation. */
export const tokenBackfillId = (n: number) => `cccccccc-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const TOKEN_BACKFILL_UPDATED_AT = new Date("2090-01-01T00:00:00.000Z");
export const TOKEN_BACKFILL_IDS = {
  fallback: tokenBackfillId(1), same: tokenBackfillId(2), empty: tokenBackfillId(3), none: tokenBackfillId(4), deleted: tokenBackfillId(5), inactive: tokenBackfillId(6), tie: tokenBackfillId(7), shadowed: tokenBackfillId(8), scalar: tokenBackfillId(9), array: tokenBackfillId(10), caseSource: tokenBackfillId(11), paddedSource: tokenBackfillId(12), whitespaceToken: tokenBackfillId(13),
  oldSnapshot: tokenBackfillId(101), latestSnapshot: tokenBackfillId(102), tieLowSnapshot: tokenBackfillId(103), tieHighSnapshot: tokenBackfillId(104), runningSnapshot: tokenBackfillId(105), failedSnapshot: tokenBackfillId(106), wrongCaseSnapshot: tokenBackfillId(107),
  fallbackOldRow: tokenBackfillId(201), fallbackNullRow: tokenBackfillId(202), tieWinnerRow: tokenBackfillId(290), tieLoserRow: tokenBackfillId(280)
};
export const tokenBackfillSource = (id: string) => `synthetic-source-${id}`;
export const expectedTokenBackfillDryRun = { archivedTokens: 10, missingTokens: 7, changedTokens: 9, updatedTokens: 0 };
export const expectedTokenBackfillApply = { archivedTokens: 10, missingTokens: 7, changedTokens: 9, updatedTokens: 9 };
export const expectedTokenBackfillRerun = { archivedTokens: 10, missingTokens: 0, changedTokens: 0, updatedTokens: 0 };
export const expectedBackfilledTokens: Record<string, string | null> = {
  [TOKEN_BACKFILL_IDS.fallback]: "synthetic-fallback-token", [TOKEN_BACKFILL_IDS.same]: "synthetic-same-token", [TOKEN_BACKFILL_IDS.empty]: "", [TOKEN_BACKFILL_IDS.none]: null, [TOKEN_BACKFILL_IDS.deleted]: "synthetic-deleted-token", [TOKEN_BACKFILL_IDS.inactive]: "synthetic-inactive-token", [TOKEN_BACKFILL_IDS.tie]: "synthetic-tie-winner", [TOKEN_BACKFILL_IDS.shadowed]: "synthetic-newest-valid", [TOKEN_BACKFILL_IDS.scalar]: "synthetic-scalar-fallback", [TOKEN_BACKFILL_IDS.array]: "synthetic-array-fallback", [TOKEN_BACKFILL_IDS.caseSource]: null, [TOKEN_BACKFILL_IDS.paddedSource]: null, [TOKEN_BACKFILL_IDS.whitespaceToken]: "  Synthetic Case-Sensitive Token  "
};
export function coachTokenBackfillFixtures(): Map<string, MongoRow[]> {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => data.set(model, [...(data.get(model) ?? []), coachFixtureRow(model, values)]);
  const i = TOKEN_BACKFILL_IDS;
  for (const id of Object.keys(expectedBackfilledTokens)) add("Coach", {
    id, sourceCoachId: id === i.caseSource ? "Synthetic:Case" : id === i.paddedSource ? " synthetic:spaced " : tokenBackfillSource(id), name: `Synthetic backfill coach ${id}`, normalizedName: `synthetic${id}`,
    accessToken: id === i.same ? "synthetic-same-token" : id === i.empty ? "synthetic-old-empty" : id === i.inactive ? "synthetic-old-inactive" : null,
    updatedAt: TOKEN_BACKFILL_UPDATED_AT, deletedAt: id === i.deleted ? new Date("2091-01-01") : null, status: id === i.inactive ? "INACTIVE" : "ACTIVE"
  });
  for (const [id, status, date] of [[i.oldSnapshot,"completed","2097-01-01"], [i.latestSnapshot,"completed","2098-01-01"], [i.tieLowSnapshot,"completed","2099-01-01"], [i.tieHighSnapshot,"completed","2099-01-01"], [i.runningSnapshot,"running","2100-01-01"], [i.failedSnapshot,"failed","2100-01-02"], [i.wrongCaseSnapshot,"Completed","2100-01-03"]]) add("CoachdbArchiveSnapshot", { id, status, startedAt: new Date(date), sourceDatabase: "synthetic-unrelated-database", sourceSchema: "synthetic-unrelated-schema" });
  let seq = 300;
  const archive = (coachId: string, rowData: unknown, snapshotId = i.latestSnapshot, values: MongoRow = {}) => add("CoachdbArchiveRow", { id: tokenBackfillId(seq++), snapshotId, tableSchema: "public", tableName: "coaches", rowKey: tokenBackfillSource(coachId), rowData, ...values });
  archive(i.fallback, { access_token: "synthetic-fallback-token" }, i.oldSnapshot, { id: i.fallbackOldRow });
  archive(i.fallback, { access_token: null }, i.latestSnapshot, { id: i.fallbackNullRow });
  archive(i.fallback, { access_token: "must-ignore-running" }, i.runningSnapshot);
  archive(i.fallback, { access_token: "must-ignore-failed" }, i.failedSnapshot);
  archive(i.fallback, { access_token: "must-ignore-status-case" }, i.wrongCaseSnapshot);
  archive(i.fallback, { access_token: "must-ignore-schema" }, i.tieLowSnapshot, { tableSchema: "private" });
  archive(i.fallback, { access_token: "must-ignore-table" }, i.tieLowSnapshot, { tableName: "other" });
  archive(i.same, { access_token: "synthetic-same-token" }); archive(i.empty, { access_token: "" }); archive(i.none, { unrelated: true });
  archive(i.deleted, { access_token: "synthetic-deleted-token" }); archive(i.inactive, { access_token: "synthetic-inactive-token" });
  // Winner has the smaller snapshot ID: equal startedAt is broken by archive row ID.
  archive(i.tie, { access_token: "synthetic-tie-winner" }, i.tieLowSnapshot, { id: i.tieWinnerRow });
  archive(i.tie, { access_token: "must-ignore-tie-loser" }, i.tieHighSnapshot, { id: i.tieLoserRow });
  archive(i.shadowed, { access_token: { secret: "ignored-malformed-old-token" } }, i.oldSnapshot); archive(i.shadowed, { access_token: "synthetic-newest-valid" });
  archive(i.scalar, { access_token: "synthetic-scalar-fallback" }, i.oldSnapshot); archive(i.scalar, "scalar-row-data");
  archive(i.array, { access_token: "synthetic-array-fallback" }, i.oldSnapshot); archive(i.array, [{ access_token: "must-ignore-array" }]);
  archive(i.caseSource, { access_token: "must-ignore-source-case" }, i.latestSnapshot, { rowKey: "synthetic:case" });
  archive(i.paddedSource, { access_token: "must-ignore-source-trim" }, i.latestSnapshot, { rowKey: "synthetic:spaced" });
  archive(i.whitespaceToken, { access_token: "  Synthetic Case-Sensitive Token  " });
  return data;
}
