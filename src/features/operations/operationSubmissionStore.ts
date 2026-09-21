import type { OperationSubmission, OperationSubmissionStore } from "./operationSubmission";

type DraftSession = { status: string; ownerId: string | null; generation: number };
type DraftRuntime = {
  getSnapshot(): DraftSession;
  getSubject(): string | null;
  readVersioned<T>(kind: string, id: string): Promise<{ value: T | null; revision: string | null }>;
  writeIfUnchanged(kind: string, id: string, value: unknown, expectedRevision: string | null): Promise<string>;
  removeIfUnchanged(kind: string, id: string, expectedRevision: string | null): Promise<void>;
};

/** Captures the owner and key generation used to recover/commit this exact submission. */
export function operationSubmissionStore(runtime: DraftRuntime, session: DraftSession, team: string, expectedSubject: string): OperationSubmissionStore {
  if (session.status !== "ready" || !session.ownerId || !expectedSubject.startsWith("google:") || runtime.getSubject() !== expectedSubject) throw new Error("본인 계정으로 로그인한 뒤 등록 정보를 복구해주세요.");
  const owner = session.ownerId;
  const generation = session.generation;
  const assertCurrent = () => {
    const current = runtime.getSnapshot();
    if (current.status !== "ready" || current.ownerId !== owner || current.generation !== generation || runtime.getSubject() !== expectedSubject) {
      throw new Error("로그인 또는 저장 키가 변경되었습니다. 기존 등록 정보를 보존했습니다. 본인 계정으로 다시 연결해주세요.");
    }
  };
  let revision: string | null | undefined;
  const checkedRevision = () => {
    assertCurrent();
    if (revision === undefined) throw new Error("이전 등록 정보를 먼저 확인해주세요.");
    return revision;
  };
  const conflict = (error: unknown): never => {
    if (error instanceof Error && error.name === "DraftConflictError") {
      throw new Error("다른 탭의 등록 정보가 변경되었습니다. 기존 정보를 보존했습니다. 새로고침 후 원래 등록을 이어가세요.");
    }
    throw error;
  };
  return {
    owner, expectedSubject, assertCurrent,
    read: async () => {
      assertCurrent();
      const record = await runtime.readVersioned<OperationSubmission>("operation-submission", team);
      assertCurrent();
      revision = record.revision;
      return record.value;
    },
    write: async (value) => {
      try {
        const next = await runtime.writeIfUnchanged("operation-submission", team, value, checkedRevision());
        assertCurrent();
        revision = next;
      } catch (error) { conflict(error); }
    },
    clear: async () => {
      try {
        await runtime.removeIfUnchanged("operation-submission", team, checkedRevision());
        assertCurrent();
        revision = null;
      } catch (error) { conflict(error); }
    }
  };
}
