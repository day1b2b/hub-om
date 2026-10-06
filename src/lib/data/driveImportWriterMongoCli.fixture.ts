/** Synthetic source seam for the actual Drive CLI Mongo child process. */
import fs from "node:fs";
import { registerHooks } from "node:module";
import { basename } from "node:path";
import { mock } from "node:test";
import type { DriveImportOperation } from "./driveImportWriterRepository";

const observer = process.env.DRIVE_IMPORT_MONGO_CLI_OBSERVER;
if (!observer) throw new Error("DRIVE_IMPORT_MONGO_CLI_OBSERVER_REQUIRED");
const record = (event: string, value: unknown) => fs.appendFileSync(observer, `${JSON.stringify({ event, value })}\n`);
const existsSync = fs.existsSync.bind(fs);
mock.method(fs, "existsSync", ((path: Parameters<typeof fs.existsSync>[0]) => {
  if (typeof path === "string" && [".env", ".env.local"].includes(basename(path))) {
    record("env-check", basename(path));
    throw new Error("DRIVE_IMPORT_MONGO_CLI_ENV_ACCESS_BLOCKED");
  }
  return existsSync(path);
}) as typeof fs.existsSync);
const source = Object.freeze({
  async scan(value: string) {
    record("scan", value);
    return { candidates: [], files: [], folderId: null, folderTitle: null, folderUrl: null, issues: [], scannedAt: "2099-01-01T00:00:00.000Z" };
  },
  async search(operation: DriveImportOperation) {
    record("search", operation.operationId);
    return { candidates: [], issues: [], searchedAt: "2099-01-01T00:00:00.000Z" };
  },
});
const globalProbe = globalThis as typeof globalThis & { __driveImportMongoCliSource?: typeof source };
globalProbe.__driveImportMongoCliSource = source;
const repository = new URL("../../../", import.meta.url);
const sourceUrl = new URL("driveImportSource.ts", import.meta.url).href.replace(/\.ts$/, "");
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(repository.href) && specifier.startsWith(".")) {
      const target = new URL(specifier, context.parentURL).href.replace(/\.ts$/, "");
      if (target === sourceUrl) return { url: "data:text/javascript,export const getDriveImportSource=()=>globalThis.__driveImportMongoCliSource;", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
