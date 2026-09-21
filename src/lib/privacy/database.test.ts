import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { withPrivacyDatabase } from "./database";
import { encryptField, indexField } from "./fields";

process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ test: randomBytes(32).toString("base64") });
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
process.env.PII_ALLOW_PLAINTEXT_READS = "false";
type Row = Record<string, unknown>;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [v];
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
function matches(row: Row, where: unknown): boolean {
  if (!object(where)) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return list(value).every(v => matches(row, v));
    if (key === "OR") return list(value).some(v => matches(row, v));
    if (key === "NOT") return list(value).every(v => !matches(row, v));
    if (value === undefined) return true;
    if (!object(value)) return row[key] === value;
    return Object.entries(value).every(([op, v]) => {
      if (v === undefined) return true;
      if (op === "in") return list(v).includes(row[key]);
      if (op === "notIn") return !list(v).includes(row[key]);
      if (op === "equals") return row[key] === v;
      if (op === "not") return row[key] !== v;
      throw new Error(`Unexpected fixture operator ${op}`);
    });
  });
}
function fixture(rows: Row[]) {
  const calls: Row[] = [];
  const transactions: unknown[] = [];
  const delegate = { async findMany(args: Row = {}) {
    calls.push(args);
    const filtered = rows.filter(row => matches(row, args.where));
    const page = filtered.slice(Number(args.skip ?? 0), args.take === undefined ? undefined : Number(args.skip ?? 0) + Number(args.take));
    return page.map(row => object(args.select)
      ? Object.fromEntries(Object.entries(row).filter(([k]) => (args.select as Row)[k]))
      : Object.fromEntries(Object.entries(row).filter(([k]) => !(object(args.omit) && args.omit[k]))));
  }, async findFirstOrThrow(_args: Row) { void _args; throw new Error("Unexpected direct findFirst"); } };
  const tx = { coach: delegate };
  const raw = { ...tx, async $transaction(callback: (client: typeof tx) => Promise<unknown>, options: unknown) {
    transactions.push(options); return callback(tx);
  } };
  return { db: withPrivacyDatabase(raw), calls, transactions };
}
function coach(id: string, name: string | null, active = true): Row {
  return { id, name: encryptField("Coach", "name", name), namePiiIndex: indexField("Coach", "name", name), isActive: active };
}

test("large tables narrow substring candidates by ordinary AND filters, with no plaintext query", async () => {
  const repeated = coach("unused", "가상 제외", false);
  const rows = [...Array.from({ length: 20_001 }, (_, i) => ({ ...repeated, id: `inactive-${i}` })), coach("a", "가상 Alpha"), coach("b", "가상 Beta")];
  const { db, calls } = fixture(rows);
  assert.deepEqual(await db.coach.findMany({ where: { AND: [{ isActive: true }, { name: { contains: "Alpha" } }] }, select: { id: true } }), [{ id: "a" }]);
  assert.deepEqual(calls[0].where, { AND: [{ isActive: true }] });
  assert.deepEqual(calls[0].select, { name: true });
  assert.ok(!JSON.stringify(calls).includes("Alpha"));
});

test("OR, private NOT and multiple predicates preserve the plaintext result set", async () => {
  const plain = [{ id: "a", name: "Alpha", active: true }, { id: "b", name: "Beta", active: false }, { id: "c", name: "Gamma", active: true }];
  const scenarios = [
    { where: { OR: [{ isActive: false }, { name: { contains: "Alpha" } }] }, expected: plain.filter(v => !v.active || v.name.includes("Alpha")) },
    { where: { NOT: { isActive: true, name: { contains: "Alpha" } } }, expected: plain.filter(v => !(v.active && v.name.includes("Alpha"))) },
    { where: { AND: [{ name: { contains: "a", mode: "insensitive" } }, { name: { not: { contains: "mm" } } }] }, expected: plain.filter(v => v.name.toLowerCase().includes("a") && !v.name.includes("mm")) }
  ];
  for (const { where, expected } of scenarios) {
    const { db } = fixture(plain.map(v => coach(v.id, v.name, v.active)));
    assert.deepEqual(await db.coach.findMany({ where, select: { id: true } }), expected.map(v => ({ id: v.id })));
  }
});

test("text predicates, insensitive mode and null have explicit semantics", async () => {
  for (const [filter, expected] of [
    [{ startsWith: "Al" }, ["a"]], [{ endsWith: "ta" }, ["b"]],
    [{ contains: "ALP", mode: "insensitive" }, ["a"]], [{ contains: "" }, ["a", "b"]]
  ] as const) {
    const { db } = fixture([coach("a", "Alpha"), coach("b", "Beta"), coach("c", null)]);
    assert.deepEqual(await db.coach.findMany({ where: { name: filter }, select: { id: true } }), expected.map(id => ({ id })));
  }
});

test("exact lookup uses the blind index without scanning", async () => {
  const { db, calls } = fixture([coach("a", "Alpha")]);
  assert.deepEqual(await db.coach.findMany({ where: { name: "Alpha" }, select: { id: true } }), [{ id: "a" }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { namePiiIndex: indexField("Coach", "name", "Alpha") });
});

test("scan boundaries reject excess rows before attempting decryption and never truncate", async () => {
  const repeated = coach("unused", "Alpha");
  const { db } = fixture(Array.from({ length: 20_000 }, (_, i) => ({ ...repeated, id: String(i) })));
  assert.deepEqual(await db.coach.findMany({ where: { name: { contains: "missing" } }, select: { id: true } }), []);
  const over = fixture(Array.from({ length: 20_001 }, (_, i) => ({ id: String(i), name: "not ciphertext" })));
  await assert.rejects(over.db.coach.findMany({ where: { name: { contains: "secret-query" } } }), /search is too broad/);
  assert.equal(over.calls.length, 1);
  await assert.rejects(fixture([{ id: "a", name: "x".repeat(32 * 1024 * 1024) }]).db.coach.findMany({ where: { name: { contains: "secret" } } }), /byte limit/);
});

test("private sorting reads keys first, pages before payload, and preserves projection and stable ties", async () => {
  const { db, calls, transactions } = fixture([coach("c", "Beta"), coach("b", "Alpha"), coach("a", "Alpha")]);
  const result = await db.coach.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], skip: 1, take: 1, select: { name: true } });
  assert.deepEqual(result, [{ name: "Alpha" }]);
  assert.deepEqual(calls[0].select, { id: true, name: true });
  assert.deepEqual(calls[1].where, { AND: [{}, { id: { in: ["b"] } }] });
  assert.deepEqual(transactions, [{ isolationLevel: "RepeatableRead" }]);
  assert.ok(!JSON.stringify(result).includes("PiiIndex"));
});

test("private sorting excludes omitted PK, retains null ordering, and rejects unsupported pagination", async () => {
  const { db } = fixture([coach("null", null), coach("a", "Alpha")]);
  assert.deepEqual(await db.coach.findMany({ orderBy: { name: "asc" }, take: 1, omit: { id: true, isActive: true } }), [{ name: "Alpha" }]);
  assert.deepEqual(await db.coach.findMany({ orderBy: { name: "desc" }, take: 1, select: { id: true } }), [{ id: "null" }]);
  await assert.rejects(db.coach.findMany({ orderBy: { name: "asc" }, cursor: { id: "a" } }), /cursors/);
  await assert.rejects(db.coach.findMany({ orderBy: { name: "asc" }, take: -1 }), /Negative take/);
  await assert.rejects(fixture([]).db.coach.findFirstOrThrow({ orderBy: { name: "asc" } }), { code: "P2025" });
});

test("private sorting accepts 20,000 keys but rejects 20,001 before decrypting payload", async () => {
  const repeated = coach("same", "Alpha");
  const under = fixture(Array.from({ length: 20_000 }, (_, i) => ({ ...repeated, id: String(i) })));
  assert.equal((await under.db.coach.findMany({ orderBy: { name: "asc" }, take: 1, select: { id: true } })).length, 1);
  const over = fixture(Array.from({ length: 20_001 }, (_, i) => ({ id: String(i), name: "invalid" })));
  await assert.rejects(over.db.coach.findMany({ orderBy: { name: "asc" }, take: 1 }), /ordering exceeds/);
  assert.equal(over.calls.length, 1);
});

test("undefined and empty private AND branches never narrow an OR candidate set", async () => {
  for (const branch of [
    { isActive: undefined, name: { contains: "Alpha" } },
    { AND: [{ name: { contains: "Alpha" } }] },
    { id: { equals: undefined }, name: { contains: "Alpha" } }
  ]) {
    const { db, calls } = fixture([coach("a", "Alpha"), coach("b", "Beta")]);
    assert.deepEqual(await db.coach.findMany({ where: { OR: [branch, { id: "b" }] }, select: { id: true } }), [{ id: "a" }, { id: "b" }]);
    // Prisma removes undefined predicates; do not pass a seemingly nonempty
    // branch which collapses inside OR and changes the candidate set.
    assert.deepEqual(calls[0].where, {});
  }
});

test("caller-owned transactions retain one payload read for private sorting", async () => {
  const { db, calls } = fixture([coach("b", "Beta"), coach("a", "Alpha")]);
  const rows = await db.$transaction(async tx => tx.coach.findMany({ orderBy: { name: "asc" }, select: { id: true }, take: 1 }), {});
  assert.deepEqual(rows, [{ id: "a" }]);
  assert.equal(calls.length, 1);
});
