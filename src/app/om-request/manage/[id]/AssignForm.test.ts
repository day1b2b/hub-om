import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
type Call = { method: string; body: Record<string, unknown> };
const preview = { token: "fixture-confirmation-token", count: 2, assignedOm: "기존 담당", nextOm: "가상 담당", operations: [
  { operationId: "fixture-1", roundNo: "1", omName: "현재 담당", omUserId: "fixture-user-1" },
  { operationId: "fixture-2", roundNo: "2", omName: null, omUserId: "fixture-user-2" }
] };

function harness(respond: (call: Call) => Promise<Response>) {
  const states: unknown[] = [];
  let cursor = 0;
  let refreshes = 0;
  const calls: Call[] = [];
  const hook = (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value: unknown) => { states[index] = value; }];
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const source = readFileSync(new URL("./AssignForm.tsx", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { AssignForm?: (props: unknown) => Element } = {};
  const require = (name: string) => {
    if (name === "./AssignForm.module.css") return { default: { dialog: "assignment-dialog-fixture" } };
    if (name === "react") return { useState: hook, useRef: (value: unknown) => hook({ current: value })[0], useEffect: () => {}, useMemo: (run: () => unknown) => run() };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshes++; } }) };
    throw new Error(`unexpected import: ${name}`);
  };
  const fetch = async (_url: string, init: RequestInit) => {
    const call = { method: init.method!, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    return respond(call);
  };
  new Function("require", "exports", "fetch", javascript)(require, exports, fetch);
  function render() { cursor = 0; return exports.AssignForm!({ request: { id: "fixture-request", assignedOm: "가상 담당", status: "배정완료" }, omRoster: ["가상 담당"] }); }
  function elements(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const element = node as Element;
    return [element, ...elements(element.props.children)];
  }
  function text(node: unknown): string {
    if (Array.isArray(node)) return node.map(text).join("");
    if (node && typeof node === "object" && "props" in node) return text((node as Element).props.children);
    return typeof node === "string" || typeof node === "number" ? String(node) : "";
  }
  function button(label: string) {
    const match = elements(render()).find((element) => element.type === "button" && text(element) === label);
    assert.ok(match, `button ${label}`);
    return match;
  }
  return { calls, button, text: () => text(render()), click: (label: string) => (button(label).props.onClick as () => Promise<void> | void)(), refreshes: () => refreshes };
}

test("배정 저장은 영향 회차/현재 이름/ID 배정을 보여준 뒤 승인 token으로만 쓴다", async () => {
  const ui = harness(async (call) => call.method === "POST" ? Response.json({ preview }) : Response.json({ ok: true }));
  await ui.click("저장");
  assert.deepEqual(ui.calls.map((call) => call.method), ["POST"]);
  assert.match(ui.text(), /이 요청 접수 시 생성된 연결 회차 2개/);
  assert.match(ui.text(), /현재 담당: 현재 담당/);
  assert.match(ui.text(), /현재 담당: 계정 지정 담당자\(이름 확인 불가\)/);
  assert.match(ui.text(), /가상 담당\(으\)로 변경/);
  await ui.click("확인 후 배정");
  assert.deepEqual(ui.calls[1], { method: "PATCH", body: { id: "fixture-request", assignedOm: "가상 담당", confirmationToken: preview.token } });
  assert.equal(ui.refreshes(), 1);
});

test("배정 취소 미리보기에서 돌아가기는 쓰지 않고 승인하면 null로 보낸다", async () => {
  const ui = harness(async (call) => call.method === "POST" ? Response.json({ preview: { ...preview, nextOm: null } }) : Response.json({ ok: true }));
  await ui.click("배정 취소");
  assert.match(ui.text(), /모두 비웁니다/);
  await ui.click("돌아가기");
  assert.deepEqual(ui.calls.map((call) => call.method), ["POST"]);
  await ui.click("배정 취소");
  await ui.click("확인 후 배정 취소");
  assert.equal(ui.calls.at(-1)!.body.assignedOm, null);
  assert.equal(ui.calls.at(-1)!.body.confirmationToken, preview.token);
});

test("409는 확인 팝업을 닫고 새로운 미리보기를 요구한다", async () => {
  const ui = harness(async (call) => call.method === "POST" ? Response.json({ preview }) : Response.json({ error: "stale" }, { status: 409 }));
  await ui.click("저장");
  await ui.click("확인 후 배정");
  assert.doesNotMatch(ui.text(), /확인 후 배정/);
  assert.match(ui.text(), /다시 눌러 현재 회차와 담당자를 확인/);
  assert.equal(ui.refreshes(), 0);
  await ui.click("저장");
  assert.equal(ui.calls.at(-1)!.method, "POST");
});

test("네트워크 오류는 재시도 가능하고 같은 렌더의 중복 확인 클릭은 한 번만 쓴다", async () => {
  let rejectPreview = true;
  let finishWrite: (() => void) | undefined;
  const ui = harness(async (call) => {
    if (call.method === "POST") {
      if (rejectPreview) { rejectPreview = false; throw new Error("fixture network"); }
      return Response.json({ preview });
    }
    await new Promise<void>((resolve) => { finishWrite = resolve; });
    return Response.json({ ok: true });
  });
  await ui.click("저장");
  assert.match(ui.text(), /fixture network/);
  await ui.click("저장");
  const confirm = ui.button("확인 후 배정").props.onClick as () => Promise<void>;
  const pending = confirm();
  await confirm();
  assert.equal(ui.calls.filter((call) => call.method === "PATCH").length, 1);
  assert.ok(finishWrite);
  finishWrite();
  await pending;
  assert.equal(ui.refreshes(), 1);
});

test("확인 후 쓰기 네트워크 오류는 팝업과 token을 유지해 재시도한다", async () => {
  let failWrite = true;
  const ui = harness(async (call) => {
    if (call.method === "POST") return Response.json({ preview });
    if (failWrite) { failWrite = false; throw new Error("fixture write failure"); }
    return Response.json({ ok: true });
  });
  await ui.click("저장");
  await ui.click("확인 후 배정");
  assert.match(ui.text(), /fixture write failure/);
  assert.match(ui.text(), /확인 후 배정/);
  assert.equal(ui.refreshes(), 0);
  await ui.click("확인 후 배정");
  assert.deepEqual(ui.calls.filter((call) => call.method === "PATCH").map((call) => call.body.confirmationToken), [preview.token, preview.token]);
  assert.equal(ui.refreshes(), 1);
});
