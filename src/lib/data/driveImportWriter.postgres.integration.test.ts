/** Parent executes. Technical original gates, not writer implementation/parity acceptance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runTechnicalGate,verifyGateIndependence } from "./driveImportWriterGateHarness.fixture.ts";
test("Drive writer immutable original PG technical gates",{skip:process.env.PG_DRIVE_WRITER_GATE!=="1",timeout:300_000,concurrency:false},async t=>{
 assert.equal(process.env.TZ,"UTC","supervisor timezone must be fixed; CLI timezone is varied in separate children");
 await verifyGateIndependence();
 // Sequential awaits: any failure stops all later gates. Parent is the only executor.
 await runTechnicalGate(t,"legacy","UTC");
 await runTechnicalGate(t,"legacy","Asia/Seoul");
 await runTechnicalGate(t,"no_defaults","UTC");
 await runTechnicalGate(t,"current","UTC");
 t.diagnostic("TECHNICAL_GATES_ONLY; no product/full-parity acceptance");
});

/** Separate opt-in: never starts or changes the technical gate. Parent is sole executor. */
test("Drive writer full immutable legacy/current/native parity",{skip:process.env.DRIVE_IMPORT_WRITER_PARITY!=="1",timeout:1_500_000,concurrency:false},async t=>{
 assert.equal(process.env.TZ,"UTC");
 const {runFullParity}=await import("./driveImportWriterParityHarness.fixture.ts");
 await runFullParity(t);
});
