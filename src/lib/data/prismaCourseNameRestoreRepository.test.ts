import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { CourseNameRestoreConflict } from "./courseNameRestoreRepository";
import { PrismaCourseNameRestoreRepository } from "./prismaCourseNameRestoreRepository";

const adapterError = (name: string, kind: string, originalCode: string) => Object.assign(new Error("Synthetic private driver details"), { name, cause: { kind, originalCode } });
const repository = (error: Error) => new PrismaCourseNameRestoreRepository({ $transaction: async () => { throw error; } } as unknown as PrismaClient);
test("course restore maps adapter-pg COMMIT conflicts to requery while preserving unrelated internal failures", async () => {
  for (const code of ["40001", "40P01"]) await assert.rejects(repository(adapterError("DriverAdapterError", "TransactionWriteConflict", code))
    .applyCourseNameRestore("synthetic", ["synthetic-session"], "a".repeat(64), null), error => {
      assert.ok(error instanceof CourseNameRestoreConflict); assert.ok(!error.message.includes("private")); return true;
    });
  for (const error of [new Error("serialization text alone"), adapterError("OtherError", "TransactionWriteConflict", "40001"),
    adapterError("DriverAdapterError", "OtherKind", "40001"), adapterError("DriverAdapterError", "TransactionWriteConflict", "XX000")]) {
    await assert.rejects(repository(error).applyCourseNameRestore("synthetic", ["synthetic-session"], "a".repeat(64), null), thrown => thrown === error);
  }
});
