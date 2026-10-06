import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { backfillCoachAccessTokens, BACKFILL_TRANSACTION_OPTIONS, parseCoachTokenBackfillArgs } from "./coachAccessTokenBackfill";

type Coach = { id: string; sourceCoachId: string; accessToken: string | null };
type Archive = { id: string; rowKey: string; rowData: Record<string, unknown>; started: number; status?: string; tableName?: string; tableSchema?: string };
function fixture(coaches: Coach[], archives: Archive[], failUpdate = false) {
  const persisted = structuredClone(coaches);
  const reads: { take: number; size: number }[] = [];
  let updates = 0;
  const db = {
    async $transaction(run: (tx: unknown) => Promise<unknown>, options: unknown) {
      assert.deepEqual(options, BACKFILL_TRANSACTION_OPTIONS);
      const pending = structuredClone(persisted);
      const result = await run({
        coach: {
          async findMany(args: { take: number; cursor?: { id: string } }) {
            const start = args.cursor ? pending.findIndex(c => c.id === args.cursor!.id) + 1 : 0;
            const result = pending.slice(start, start + args.take);
            reads.push({ take: args.take, size: result.length });
            return result;
          },
          async update(args: { where: { id: string }; data: { accessToken: string } }) {
            updates++;
            if (failUpdate && updates === 2) throw new Error("synthetic database failure");
            const coach = pending.find(c => c.id === args.where.id)!;
            coach.accessToken = args.data.accessToken;
            return { id: coach.id };
          },
        },
        coachdbArchiveRow: {
          async findMany(args: { where: { rowKey: { in: string[] }; snapshot: { status: string }; tableSchema: string; tableName: string }; orderBy: unknown; cursor?: { id: string }; take: number }) {
            assert.deepEqual(args.orderBy, [{ snapshot: { startedAt: "desc" } }, { id: "desc" }]);
            const filtered = archives.filter(r => args.where.rowKey.in.includes(r.rowKey)
              && (r.status ?? "completed") === args.where.snapshot.status
              && (r.tableName ?? "coaches") === args.where.tableName
              && (r.tableSchema ?? "public") === args.where.tableSchema)
              .sort((a, b) => b.started - a.started || b.id.localeCompare(a.id));
            const start = args.cursor ? filtered.findIndex(r => r.id === args.cursor!.id) + 1 : 0;
            const result = filtered.slice(start, start + args.take);
            reads.push({ take: args.take, size: result.length });
            return result;
          },
        },
      });
      persisted.splice(0, persisted.length, ...pending);
      return result;
    },
  };
  return { db: db as unknown as Pick<PrismaClient, "$transaction">, persisted, reads, updateCount: () => updates };
}
const coach = (id: string, accessToken: string | null = null): Coach => ({ id, sourceCoachId: `source-${id}`, accessToken });
const archive = (id: string, rowKey: string, access_token: unknown, started: number): Archive => ({ id, rowKey, rowData: { access_token }, started });

test("latest non-null completed public/coaches token matches source ID; dry-run never writes", async () => {
  const f = fixture([coach("a"), coach("b", "unchanged"), coach("c", "old"), coach("d")], [
    archive("1", "source-a", "new", 1), archive("2", "source-a", null, 4),
    { ...archive("3", "source-a", "running", 5), status: "running" },
    { ...archive("4", "source-a", "wrong-schema", 6), tableSchema: "private" },
    { ...archive("5", "source-a", "wrong-table", 7), tableName: "other" },
    archive("6", "source-b", "unchanged", 1), archive("7", "source-c", "", 2),
    archive("8", "unmatched", "unused", 9), archive("9", "source-d", null, 1),
  ]);
  assert.deepEqual(await backfillCoachAccessTokens(f.db, { apply: false }), { archivedTokens: 3, missingTokens: 1, changedTokens: 2, updatedTokens: 0 });
  assert.equal(f.updateCount(), 0);
  assert.deepEqual(await backfillCoachAccessTokens(f.db, { apply: true }), { archivedTokens: 3, missingTokens: 1, changedTokens: 2, updatedTokens: 2 });
  assert.equal(f.persisted[0].accessToken, "new");
  assert.equal(f.persisted[2].accessToken, "");
});

test("coach and archive scans cross page boundaries with bounded reads", async () => {
  const coaches = Array.from({ length: 251 }, (_, i) => coach(String(i).padStart(3, "0")));
  const archives = coaches.map((c, i) => archive(`old-${i}`, c.sourceCoachId, `token-${i}`, 1));
  for (let i = 0; i < 251; i++) archives.push(archive(`null-${i}`, coaches[0].sourceCoachId, null, 10));
  const f = fixture(coaches, archives);
  const summary = await backfillCoachAccessTokens(f.db, { apply: true });
  assert.equal(summary.updatedTokens, 251);
  assert.equal(f.persisted[250].accessToken, "token-250");
  assert.ok(f.reads.length > 4);
  assert.ok(f.reads.every(r => r.take === 250 && r.size <= 250));
});

test("a write failure rolls back the complete run", async () => {
  const f = fixture([coach("a"), coach("b")], [archive("1", "source-a", "a", 1), archive("2", "source-b", "b", 1)], true);
  await assert.rejects(backfillCoachAccessTokens(f.db, { apply: true }));
  assert.deepEqual(f.persisted.map(c => c.accessToken), [null, null]);
});

test("malformed non-string token fails without disclosing its value", async () => {
  const f = fixture([coach("a")], [archive("1", "source-a", { secret: "fixture-value" }, 1)]);
  await assert.rejects(backfillCoachAccessTokens(f.db, { apply: true }), { message: "Archive token must be a string." });
  assert.equal(f.updateCount(), 0);
});

test("CLI defaults to dry-run and rejects unknown, conflicting or unconfirmed writes", () => {
  assert.deepEqual(parseCoachTokenBackfillArgs([]), { apply: false });
  assert.deepEqual(parseCoachTokenBackfillArgs(["--dry-run"]), { apply: false });
  for (const args of [["--apply"], ["--apply", "--backup-confirmed"], ["--apply", "--dry-run"], ["--aply"]]) {
    assert.throws(() => parseCoachTokenBackfillArgs(args));
  }
  assert.deepEqual(parseCoachTokenBackfillArgs(["--apply", "--backup-confirmed", "--maintenance-confirmed"]), { apply: true });
});

test("encrypted repository decrypts archive JSON and writes ciphertext plus blind index", async () => {
  const { randomBytes } = await import("node:crypto");
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  const { encryptData, decryptRow, withPrivacyDatabase } = await import("../privacy/database");
  const { indexField } = await import("../privacy/fields");
  const storedCoach = encryptData("Coach", coach("a"));
  const storedArchive = encryptData("CoachdbArchiveRow", { id: "archive-a", rowKey: "source-a", rowData: { access_token: "fixture-token" } });
  let writes = 0;
  const rawTx = {
    coach: {
      async findMany() { return [storedCoach]; },
      async update(args: { data: Record<string, unknown> }) {
        writes++;
        assert.notEqual(args.data.accessToken, "fixture-token");
        assert.equal(args.data.accessTokenPiiIndex, indexField("Coach", "accessToken", "fixture-token"));
        assert.deepEqual(decryptRow("Coach", args.data), { accessToken: "fixture-token" });
        return { id: "a" };
      },
    },
    coachdbArchiveRow: {
      async findMany(args: { where: Record<string, unknown> }) {
        assert.equal("rowKey" in args.where, false);
        assert.deepEqual(args.where.rowKeyPiiIndex, { in: [indexField("CoachdbArchiveRow", "rowKey", "source-a")] });
        return [storedArchive];
      },
    },
  };
  const rawDb = { async $transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(rawTx); } };
  const db = withPrivacyDatabase(rawDb as unknown as PrismaClient);
  const result = await backfillCoachAccessTokens(db, { apply: true });
  assert.equal(result.updatedTokens, 1);
  assert.equal(writes, 1);
});

test("CLI entry point rejects invalid flags before env loading or DB access without raw errors", async () => {
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-loader", "./scripts/ts-loader.mjs", "scripts/backfill-coach-access-tokens.ts", "--invalid"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /^\[backfill-coach-access-tokens\] 실패\./);
  assert.doesNotMatch(child.stderr, /SyntaxError|Error:|\bat .*\(/);
});
