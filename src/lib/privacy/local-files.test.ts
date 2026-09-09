import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodePrivateJson } from "./crypto";

process.env.PII_ENCRYPTION_KEYS = JSON.stringify({ test: randomBytes(32).toString("base64") });
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_INDEX_KEY = randomBytes(32).toString("base64");
process.env.PII_ALLOW_PLAINTEXT_READS = "false";
test("local-file migration is read-only by default, atomic, private and repeatable", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "hub-om-pii-file-test-"));
  const file = path.join(directory, "fixture.json");
  const data = [{ name: "가상 사용자", email: "test@example.test" }];
  const args = ["--experimental-strip-types", "--experimental-loader", "./scripts/ts-loader.mjs", "scripts/encrypt-private-file.ts", `--file=${file}`, "--purpose=team-users"];
  try {
    writeFileSync(file, JSON.stringify(data));
    execFileSync(process.execPath, [...args], { stdio: "pipe" });
    assert.equal(readFileSync(file, "utf8"), JSON.stringify(data));
    assert.throws(() => execFileSync(process.execPath, [...args, "--apply"], { stdio: "pipe" }));
    execFileSync(process.execPath, [...args, "--apply", "--backup-confirmed"], { stdio: "pipe" });
    const encrypted = readFileSync(file, "utf8");
    assert.ok(!encrypted.includes("test@example.test"));
    assert.deepEqual(decodePrivateJson(encrypted, "local:team-users"), data);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    execFileSync(process.execPath, [...args, "--apply", "--backup-confirmed"], { stdio: "pipe" });
    assert.equal(readFileSync(file, "utf8"), encrypted);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
