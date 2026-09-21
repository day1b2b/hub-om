import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as submission from "@/features/operations/operationSubmission";
import { operationSubmissionStore } from "@/features/operations/operationSubmissionStore";
import * as rounds from "@/features/operations/parsePastedRounds";

type Element = { type: unknown; props: Record<string, unknown> };
type Session = { status: string; ownerId: string | null; generation: number };
const snapshot = (): submission.OperationSubmission => ({ version: 2, owner: "opaque-fixture-owner", expectedSubject: "google:fixture", team: "team_1", id: "fixture-submission-12345", hasResultReport: "Y", payloads: [
  { companyName: "가상기업", courseName: "복구과정", roundNo: "1", startDate: "2026-09-21", endDate: "2026-09-23", educationDates: "2026-09-21, 2026-09-23" },
  { roundNo: "2", startDate: "2026-09-24", endDate: "2026-09-24", educationDates: "2026-09-24" }
] });

function harness(options: { pending?: submission.OperationSubmission; readFailure?: boolean; legacy?: boolean; expectedSubject?: string | null; runtimeSubject?: string; write?: () => Promise<void>; request?: (index: number) => Promise<Response> } = {}) {
  let session: Session = { status: "ready", ownerId: "opaque-fixture-owner", generation: 1 };
  let subject = options.runtimeSubject ?? "google:fixture";
  let ciphertext = "existing-encrypted-fixture";
  let revision: string | null = "fixture-revision-0";
  let storedValue = options.pending ?? null;
  function checkRevision(expected: string | null) {
    if (expected !== revision) { const error = new Error("fixture CAS conflict"); error.name = "DraftConflictError"; throw error; }
  }
  const calls: { body: string; key: string; subject: string | null }[] = [];
  const writes: submission.OperationSubmission[] = [];
  const removals: string[] = [];
  const locations: string[] = [];
  let reads = 0;
  let plaintextReads = 0;
  const runtime = {
    getSnapshot: () => session,
    getSubject: () => subject,
    readVersioned: async () => { reads++; if (options.readFailure) throw new Error("fixture decrypt failure"); return { value: storedValue, revision }; },
    writeIfUnchanged: async (_kind: string, _team: string, value: submission.OperationSubmission, expected: string | null) => {
      await options.write?.(); checkRevision(expected);
      writes.push(value); storedValue = value; ciphertext = "new-encrypted-fixture"; revision = `fixture-revision-${writes.length}`;
      return revision;
    },
    removeIfUnchanged: async (kind: string, team: string, expected: string | null) => {
      checkRevision(expected); removals.push(`${kind}:${team}`); ciphertext = ""; storedValue = null; revision = null;
    }
  };
  const states: unknown[] = [];
  const memos: { deps: unknown[]; value: unknown }[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  let dirty = false;
  let effectQueue: (() => void)[] = [];
  let tree: Element;
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next: unknown) => { const value = typeof next === "function" ? next(states[index]) : next; if (!Object.is(value, states[index])) { states[index] = value; dirty = true; } }];
    },
    useRef: (initial: unknown) => { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
    useMemo: (run: () => unknown, deps: unknown[]) => { const index = cursor++; if (!memos[index] || !same(memos[index].deps, deps)) memos[index] = { deps, value: run() }; return memos[index].value; },
    useEffect: (run: () => (() => void) | void, deps: unknown[]) => {
      const index = cursor++;
      if (!effects[index] || !same(effects[index].deps, deps)) {
        const previous = effects[index]; effects[index] = { deps };
        effectQueue.push(() => { previous?.cleanup?.(); effects[index].cleanup = run() || undefined; });
      }
    }
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    "react": react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { default: "a" }, "next/navigation": { useRouter: () => ({ push: (url: string) => locations.push(url) }) },
    "@/features/operations/operationCreateTemplate": { buildOperationCreateTemplateCsv: () => "" },
    "@/features/operations/operationSubmission": submission,
    "@/features/operations/operationSubmissionStore": { operationSubmissionStore },
    "@/lib/privacy/browserDraftRuntime": { browserDrafts: runtime },
    "@/components/BrowserDraftProvider": { useBrowserDraftSession: () => session },
    "@/components/MultiDateCalendar": { MultiDateCalendar: "calendar" },
    "@/features/operations/parsePastedRounds": rounds,
    "@/lib/data/operationCalculations": { enumerateDateRange: () => [] },
    "@/lib/teamScope": { teamScopeSearchParam: () => "?team=team_1" }
  };
  const source = readFileSync(new URL("./OperationCreateForm.tsx", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { OperationCreateForm?: (props: unknown) => Element } = {};
  const fetch = async (_url: unknown, init: RequestInit) => {
    calls.push({ subject: new Headers(init.headers).get("X-Operation-Submission-Subject"), body: String(init.body), key: new Headers(init.headers).get("Idempotency-Key") ?? "" });
    return options.request ? options.request(calls.length) : Response.json({ ok: true, operation: { operationId: `fixture-${calls.length}` } });
  };
  const sessionStorage = { length: options.legacy ? 1 : 0, key: () => "hub-om:operation-submission:v1:legacy:team_1", getItem: () => { plaintextReads++; throw new Error("legacy values must not be read"); }, removeItem: () => { throw new Error("legacy must not be deleted"); } };
  new Function("require", "exports", "fetch", "window", "crypto", javascript)((name: string) => { if (!(name in modules)) throw new Error(`unexpected import ${name}`); return modules[name]; }, exports, fetch, { sessionStorage }, { randomUUID: () => "fixture-new-submission-12345" });
  function render() {
    cursor = 0; dirty = false;
    tree = exports.OperationCreateForm!({ expectedSubject: options.expectedSubject === null ? undefined : options.expectedSubject ?? "google:fixture", initialValues: { companyName: "가상기업", courseName: "입력과정", startDate: "2026-09-21", endDate: "2026-09-21" }, personOptions: { om: [], ld: [] }, teamScope: "team_1" });
    const pending = effectQueue; effectQueue = []; pending.forEach((run) => run());
  }
  async function settle() { for (let index = 0; index < 14; index++) { if (dirty) render(); await Promise.resolve(); } if (dirty) render(); }
  function elements(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!node || typeof node !== "object" || !("props" in node)) return []; const value = node as Element; return [value, ...elements(value.props.children)]; }
  function text(node: unknown): string { if (Array.isArray(node)) return node.map(text).join(""); if (node && typeof node === "object" && "props" in node) return text((node as Element).props.children); return typeof node === "string" || typeof node === "number" ? String(node) : ""; }
  function button(label: string) { const found = elements(tree).find((element) => element.type === "button" && text(element) === label); assert.ok(found, label); return found; }
  render();
  return { settle, calls, writes, removals, locations, button, click: (label: string) => (button(label).props.onClick as () => Promise<void>)(), text: () => text(tree), inputValues: () => elements(tree).filter((element) => element.type === "input").map((element) => element.props.value), subject: (next: string) => { subject = next; dirty = true; }, session: (next: Partial<Session>) => { session = { ...session, ...next }; dirty = true; }, otherTabWrite: () => { revision = "fixture-other-tab-revision"; ciphertext = "other-tab-encrypted-fixture"; }, ciphertext: () => ciphertext, reads: () => reads, plaintextReads: () => plaintextReads };
}

test("신규등록 UI는 암호화 write commit을 기다린 뒤에만 첫 POST를 시작한다", async () => {
  let release!: () => void;
  const ui = harness({ write: () => new Promise<void>((resolve) => { release = resolve; }) });
  await ui.settle();
  const saving = ui.click("저장");
  await ui.settle();
  assert.equal(ui.calls.length, 0);
  release(); await saving; await ui.settle();
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].key, `${ui.writes[0].id}:0`);
});

test("암호화 quota/read 오류는 POST·삭제 없이 기존 입력과 ciphertext를 보존한다", async () => {
  for (const options of [{ write: async () => { throw new Error("fixture quota"); } }, { readFailure: true }]) {
    const ui = harness(options); await ui.settle();
    if (!("readFailure" in options)) { await ui.click("저장"); await ui.settle(); }
    else assert.equal(ui.button("저장").props.disabled, true);
    assert.equal(ui.calls.length, 0); assert.equal(ui.removals.length, 0);
    assert.equal(ui.ciphertext(), "existing-encrypted-fixture");
    assert.ok(ui.inputValues().includes("입력과정"));
  }
});

test("복구 snapshot의 owner/team/key/body와 회차 순서를 유지한다", async () => {
  const pending = snapshot(); const ui = harness({ pending }); await ui.settle();
  assert.match(ui.text(), /복구과정/);
  await ui.click("원래 등록 계속하기"); await ui.settle();
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(ui.calls.map((call) => call.key), [`${pending.id}:0`, `${pending.id}:1`]);
  assert.deepEqual(ui.calls.map((call) => JSON.parse(call.body)), pending.payloads);
  assert.deepEqual(ui.removals, ["operation-submission:team_1"]);
});

test("회차 요청 사이 runtime owner/status/generation 변경은 다음 POST와 정리를 차단한다", async () => {
  for (const changed of [{ ownerId: "other-owner" }, { status: "locked" }, { generation: 2 }]) {
    const ui: ReturnType<typeof harness> = harness({ pending: snapshot(), request: async () => { ui.session(changed); return Response.json({ ok: true, operation: { operationId: "fixture-first" } }); } });
    await ui.settle(); await ui.click("원래 등록 계속하기"); await ui.settle();
    assert.equal(ui.calls.length, 1); assert.equal(ui.removals.length, 0); assert.equal(ui.locations.length, 0);
    assert.equal(ui.ciphertext(), "existing-encrypted-fixture");
  }
});

test("legacy 키 존재 시 값 읽기·삭제·암호화 draft 조회 없이 신규등록을 차단한다", async () => {
  const ui = harness({ legacy: true }); await ui.settle();
  assert.equal(ui.button("저장").props.disabled, true);
  assert.match(ui.text(), /자동으로 가져오거나 삭제하지 않았습니다/);
  assert.equal(ui.plaintextReads(), 0); assert.equal(ui.reads(), 0); assert.equal(ui.removals.length, 0); assert.equal(ui.calls.length, 0);
});

test("page subject 누락·불일치는 숨기고 요청 중 subject 전환도 다음 POST를 막는다", async () => {
  for (const options of [{ expectedSubject: null }, { runtimeSubject: "google:other" }]) {
    const ui = harness(options); await ui.settle();
    assert.match(ui.text(), /본인 계정으로 로그인/);
    assert.deepEqual(ui.inputValues(), []);
    assert.equal(ui.reads(), 0); assert.equal(ui.calls.length, 0);
  }
  const ui: ReturnType<typeof harness> = harness({ pending: snapshot(), request: async () => { ui.subject("google:other"); return Response.json({ ok: true, operation: { operationId: "fixture-first" } }); } });
  await ui.settle(); await ui.click("원래 등록 계속하기"); await ui.settle();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].subject, "google:fixture");
  assert.equal(ui.removals.length, 0); assert.equal(ui.locations.length, 0);
});

test("복구 후 후속회차 응답 유실에서도 동일 키·본문·순서로 안전하게 재시도한다", async () => {
  const ui = harness({ pending: snapshot(), request: async (index) => {
    if (index === 2) throw new TypeError("fixture committed response lost");
    return Response.json({ ok: true, operation: { operationId: "fixture-first" } });
  } });
  await ui.settle(); await ui.click("원래 등록 계속하기"); await ui.settle();
  assert.equal(ui.removals.length, 0);
  await ui.click("원래 등록 계속하기"); await ui.settle();
  assert.deepEqual(ui.calls.slice(0, 2), ui.calls.slice(2));
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.locations.length, 1);
});

test("다른 탭의 write 충돌은 기존 암호문을 보존하고 첫 POST를 차단한다", async () => {
  const ui = harness(); await ui.settle();
  ui.otherTabWrite();
  await ui.click("저장"); await ui.settle();
  assert.equal(ui.calls.length, 0); assert.equal(ui.writes.length, 0); assert.equal(ui.removals.length, 0);
  assert.equal(ui.ciphertext(), "other-tab-encrypted-fixture");
  assert.match(ui.text(), /다른 탭의 등록 정보가 변경되었습니다/);
  assert.ok(ui.inputValues().includes("입력과정"));
});

test("서버 성공 후 clear 충돌은 다른 탭 암호문을 삭제하지 않는다", async () => {
  const ui: ReturnType<typeof harness> = harness({ request: async () => {
    ui.otherTabWrite();
    return Response.json({ ok: true, operation: { operationId: "fixture-created" } });
  } });
  await ui.settle(); await ui.click("저장"); await ui.settle();
  assert.equal(ui.calls.length, 1); assert.equal(ui.writes.length, 1); assert.equal(ui.removals.length, 0);
  assert.equal(ui.ciphertext(), "other-tab-encrypted-fixture");
  assert.match(ui.text(), /다른 탭의 등록 정보가 변경되었습니다/);
  assert.equal(ui.locations.length, 0);
});
