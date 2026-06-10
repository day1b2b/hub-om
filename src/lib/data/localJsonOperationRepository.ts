import { readFile } from "node:fs/promises";
import path from "node:path";
import { summarizeOperations } from "./operationCalculations";
import type { OperationRepository } from "./operationRepository";
import type { OperationSession } from "./operationTypes";

interface LocalOperationPayload {
  operations?: OperationSession[];
}

export class LocalJsonOperationRepository implements OperationRepository {
  constructor(private readonly fileName = process.env.OPERATION_DATA_FILE ?? "operations.json") {}

  async listOperations(): Promise<OperationSession[]> {
    const localDir = path.join(process.cwd(), ".local");
    const localFileName = path.normalize(this.fileName.replace(/^\.local[\/\\]/, ""));
    const absolutePath = path.resolve(localDir, localFileName);

    if (!absolutePath.startsWith(`${localDir}${path.sep}`)) {
      throw new Error(`OPERATION_DATA_FILE must resolve inside ${localDir}.`);
    }

    try {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw) as LocalOperationPayload | OperationSession[];
      const operations = Array.isArray(parsed) ? parsed : parsed.operations;

      if (!Array.isArray(operations)) {
        throw new Error("Local operation data must be an array or an object with an operations array.");
      }

      return [...operations].sort(compareOperationSessions);
    } catch (error) {
      if (isFileMissingError(error)) {
        return [];
      }

      throw error;
    }
  }

  async getOperationById(operationId: string): Promise<OperationSession | null> {
    const operations = await this.listOperations();
    return operations.find((operation) => operation.operationId === operationId) ?? null;
  }

  async getSummary() {
    return summarizeOperations(await this.listOperations());
  }
}

function isFileMissingError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function compareOperationSessions(a: OperationSession, b: OperationSession): number {
  if (a.startDate === b.startDate) {
    return a.operationId.localeCompare(b.operationId);
  }

  return a.startDate.localeCompare(b.startDate);
}
