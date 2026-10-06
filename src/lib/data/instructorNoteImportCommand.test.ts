import assert from "node:assert/strict";
import test, { after } from "node:test";
import { runWithDataRepositories } from "./dataRepositoryContext";
import { parseInstructorNoteImportArgs, runInstructorNoteImportCommand } from "./instructorNoteImportCommand";
import type { InstructorNoteImportRepository } from "./instructorNoteImportRepository";
import { encodePrivateJson } from "../privacy/crypto";

const privacyNames = ["PII_ENCRYPTION_KEYS", "PII_ACTIVE_KEY_ID", "PII_INDEX_KEY", "PII_ALLOW_PLAINTEXT_READS"] as const;
const savedPrivacy = new Map(privacyNames.map(name => [name, process.env[name]]));
Object.assign(process.env, { PII_ENCRYPTION_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 1).toString("base64") }), PII_ACTIVE_KEY_ID: "fixture", PII_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"), PII_ALLOW_PLAINTEXT_READS: "false" });
after(() => { for (const name of privacyNames) { const value = savedPrivacy.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; } });

test("instructor note import requires explicit apply safety gates", () => {
  assert.deepEqual(parseInstructorNoteImportArgs([]), { apply: false });
  assert.deepEqual(parseInstructorNoteImportArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseInstructorNoteImportArgs(["--apply", "--backup-confirmed", "--maintenance-confirmed"]), { apply: true });
  for (const args of [["--apply"], ["--dry-run", "--apply"], ["--unknown"]]) assert.throws(() => parseInstructorNoteImportArgs(args));
});

test("scoped import strips private source fields and never loads PostgreSQL environment", async () => {
  let loaded = 0;
  const repository: InstructorNoteImportRepository = { async importNotes(entries, apply) {
    assert.equal(apply, false); assert.equal(entries.length, 2); const note = entries[0].note;
    assert.equal(entries[0].name, "Synthetic instructor"); assert.equal(note.notionNo, 185); assert.equal(entries[1].name, "Legacy instructor");
    assert.equal(note.contact, undefined); assert.equal(note.email, undefined); assert.equal(note.notion?.contact, undefined); assert.equal(note.notion?.email, undefined);
    assert.equal(note.notes, "call [연락처 비공개]"); assert.equal(note.notion?.memo, "mail [이메일 비공개]");
    return { total: 2, inserted: 2, updated: 0 };
  } };
  const result = await runWithDataRepositories({ instructorNoteImport: repository }, () => runInstructorNoteImportCommand([], () => { loaded++; }, {
    async readSource() { return encodePrivateJson({ "185": { notionNo: 185, instructorName: "Synthetic instructor", contact: "010-1234-5678", email: "private@example.test", notes: "call 010-1234-5678", notion: { contact: "010-9999-8888", email: "hidden@example.test", memo: "mail hidden@example.test" } }, "Legacy instructor": { notes: "legacy" } }, "local:instructor-wiki"); },
    getDefaultRepository() { throw new Error("default forbidden"); }, async closeDefaultRepository() { throw new Error("close forbidden"); },
  }));
  assert.equal(loaded, 0); assert.equal(result.result.inserted, 2);
});

test("default import closes its client and redacts source/repository/close errors", async () => {
  for (const failure of [null, "source", "repository", "close"] as const) {
    let loaded = 0, closed = 0;
    const repository: InstructorNoteImportRepository = { async importNotes() { if (failure === "repository") throw new Error("private"); return { total: 0, inserted: 0, updated: 0 }; } };
    const run = runInstructorNoteImportCommand([], () => { loaded++; }, {
      async readSource() { if (failure === "source") throw new Error("private"); return encodePrivateJson({}, "local:instructor-wiki"); }, getDefaultRepository: () => repository,
      async closeDefaultRepository() { closed++; if (failure === "close") throw new Error("private"); },
    });
    if (failure) await assert.rejects(run, /^Error: INSTRUCTOR_NOTE_IMPORT_FAILED$/); else await run;
    assert.equal(loaded, 1); assert.equal(closed, 1);
  }
});
