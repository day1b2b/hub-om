import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { encodePrivateJson, decodePrivateJson } from "../privacy/crypto";

let failure: "write" | "rename" | undefined;
mock.module("node:fs/promises", { namedExports: {
  ...fs,
  open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    const write = handle.writeFile.bind(handle);
    handle.writeFile = async (data, options) => {
      assert.ok(typeof data === "string" && data.startsWith("pii:v1:"), "temp must only contain ciphertext");
      if (failure === "write") {
        await write(data.slice(0, 24), options);
        throw new Error("fixture partial write failure");
      }
      return write(data, options);
    };
    return handle;
  },
  rename: async (...args: Parameters<typeof fs.rename>) => {
    if (failure === "rename") throw new Error("fixture rename failure");
    return fs.rename(...args);
  }
} });
const { LocalJsonOperationRepository } = await import("./localJsonOperationRepository");

for (const stage of ["write", "rename"] as const) test(`${stage} 실패 시 원본 유지, 암호문 임시파일 정리, 재시도 가능`, async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "hub-om-atomic-write-"));
  const cwd = process.cwd();
  const names = ["PII_ACTIVE_KEY_ID", "PII_ENCRYPTION_KEYS", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  process.chdir(root);
  process.env.PII_ACTIVE_KEY_ID = "fixture";
  process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ fixture: randomBytes(32).toString("base64") });
  process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
  process.env.PII_ALLOW_PLAINTEXT_READS = "false";
  try {
    await fs.mkdir(".local");
    const before = encodePrivateJson({ operations: [], creationReceipts: {} }, "local:operations");
    await fs.writeFile(".local/operations.json", before);
    const repo = new LocalJsonOperationRepository("operations.json");
    failure = stage;
    await assert.rejects(repo.deleteOperation("missing"), /fixture .*failure/);
    assert.equal(await fs.readFile(".local/operations.json", "utf8"), before);
    assert.deepEqual(await fs.readdir(".local"), ["operations.json"]);
    failure = undefined;
    await repo.deleteOperation("missing");
    assert.deepEqual(decodePrivateJson(await fs.readFile(".local/operations.json", "utf8"), "local:operations"), { operations: [], creationReceipts: {} });
    assert.equal((await fs.stat(".local/operations.json")).mode & 0o777, 0o600);
  } finally {
    failure = undefined;
    process.chdir(cwd);
    for (const key of names) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await fs.rm(root, { recursive: true, force: true });
  }
});
