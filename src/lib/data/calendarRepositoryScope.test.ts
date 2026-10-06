import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as first from "./dataRepositoryContext";
import type { DataRepositories } from "./dataRepositoryContext";

// Independent API bundles can evaluate this module more than once. Execute a
// second real module instance, without sharing its module-local lexical state.
const source = readFileSync(new URL("./dataRepositoryContext.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const second = await import(`data:text/javascript,${encodeURIComponent(compiled + "\n// independent-scope-bundle")}`) as typeof first;
function ports() {
  return { operations: {}, calendarLock: {}, calendarPersistence: {} } as unknown as Partial<DataRepositories>;
}

test("separate module instance preserves registered port checks before callback", () => {
  const expected = ports();
  first.registerDataRepositoryScope(expected);
  let entered = 0;
  assert.throws(() => second.runWithDataRepositories({ ...expected, operations: ports().operations }, () => { entered++; }), /CALENDAR_SCOPE_MISMATCH/);
  const incomplete = { ...expected };
  delete incomplete.calendarLock;
  assert.throws(() => second.runWithDataRepositories(incomplete, () => { entered++; }), /CALENDAR_SCOPE_MISMATCH/);
  assert.equal(entered, 0);
  second.runWithDataRepositories(expected, () => assert.equal(first.getDataRepositoryOverride("operations"), expected.operations));
});

test("held scope across module instances rejects complete replacement before its work", () => {
  const a = ports(), b = ports();
  first.registerDataRepositoryScope(a);
  second.registerDataRepositoryScope(b);
  let beforeLockBusiness = 0;
  first.runWithDataRepositories(a, () => first.runWithLockedRepositoryScope(() => {
    assert.throws(() => second.runWithDataRepositories(b, () => { beforeLockBusiness++; }), /CALENDAR_SCOPE_MISMATCH/);
    second.runWithDataRepositories(a, () => assert.equal(second.getDataRepositoryOverride("calendarLock"), a.calendarLock));
    assert.throws(() => second.assertDefaultDatabaseAccess(), /DEFAULT_DATABASE_ACCESS_BLOCKED/);
  }));
  assert.equal(beforeLockBusiness, 0);
});

test("unregistered scopes retain legacy partial and missing-service behavior", () => {
  const value = ports().operations!;
  second.runWithDataRepositories({ operations: value }, () => {
    assert.equal(first.getDataRepositoryOverride("operations"), value);
    assert.throws(() => first.getDataRepositoryOverride("calendarLock"), /DATA_REPOSITORY_NOT_CONFIGURED/);
  });
  assert.equal(first.getDataRepositoryOverride("calendarLock"), undefined);
  first.assertDefaultDatabaseAccess();
});
