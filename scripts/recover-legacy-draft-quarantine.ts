/** Offline operator tool. This does not establish authorship or import into any account. */
import { open, readFile, unlink } from "node:fs/promises";
import { recoverLegacyDraftQuarantine } from "../src/lib/privacy/legacyDraftQuarantine.server";
import { isLegacyDraftQuarantineRecord } from "../src/lib/privacy/legacyDraftQuarantine";
async function main() {
  const [input, output, acknowledgement, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || acknowledgement !== "--authorized-offline-recovery") throw new Error();
  const file = await open(input, "r");
  let raw: string;
  try {
    if ((await file.stat()).size > 12 * 1024 * 1024) throw new Error();
    raw = await readFile(file, "utf8");
  } finally { await file.close(); }
  const record: unknown = JSON.parse(raw);
  if (!isLegacyDraftQuarantineRecord(record)) throw new Error();
  const recovered = recoverLegacyDraftQuarantine(record);
  const destination = await open(output, "wx", 0o600);
  try { await destination.writeFile(JSON.stringify(recovered), "utf8"); await destination.sync(); }
  catch { await destination.close(); await unlink(output).catch(() => undefined); throw new Error(); }
  await destination.close();
  process.stdout.write("Recovered to the requested restricted file. Authorship remains unverified.\n");
}
main().catch(() => { process.stderr.write("Offline recovery failed; no account assignment was performed.\n"); process.exitCode = 1; });
