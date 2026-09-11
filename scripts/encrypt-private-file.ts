import { readFile, rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { assertPrivacyConfiguration, decodePrivateJson, encodePrivateJson, isEncrypted } from "../src/lib/privacy/crypto";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => a.startsWith("--file="))?.slice(7);
  const purpose = args.find(a => a.startsWith("--purpose="))?.slice(10);
  const apply = args.includes("--apply");
  if (!file || !purpose || !["operations", "team-users", "om-requests", "instructor-wiki", "reminder-sent"].includes(purpose)) throw new Error("Specify --file=PATH and a supported --purpose.");
  if (apply && !args.includes("--backup-confirmed")) throw new Error("Confirm a recoverable backup before replacing a file.");
  assertPrivacyConfiguration();
  const context = `local:${purpose}`;
  const raw = (await readFile(file, "utf8")).trimEnd();
  const encrypted = isEncrypted(raw);
  const parsed = encrypted ? decodePrivateJson(raw, context) : JSON.parse(raw);
  if (apply && !encrypted) {
    const temporary = `${file}.${randomUUID()}.encrypted-tmp`;
    try {
      await writeFile(temporary, encodePrivateJson(parsed, context), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", alreadyEncrypted: encrypted, verified: true }));
}
main().catch(() => { console.error("Private file conversion failed. No file contents are logged."); process.exitCode = 1; });
