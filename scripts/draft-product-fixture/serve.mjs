// Synthetic isolated origin only. No environment, app auth, DB, or real key configuration.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
const sourceRoot = process.cwd();
const port = Number(process.argv[2] ?? 41876);
if (![41876, 41877].includes(port)) throw new Error("Reserved fixture port required.");
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const serverModule = transpile(await readFile(path.join(sourceRoot, "src/lib/privacy/browserDraftKeyring.server.ts"), "utf8"));
const { deriveBrowserDraftKeyring } = await import(`data:text/javascript;base64,${Buffer.from(serverModule).toString("base64")}`);
const quarantineTypes = `data:text/javascript;base64,${Buffer.from(transpile(await readFile(path.join(sourceRoot, "src/lib/privacy/legacyDraftQuarantine.ts"), "utf8"))).toString("base64")}`;
const quarantineModule = transpile(await readFile(path.join(sourceRoot, "src/lib/privacy/legacyDraftQuarantine.server.ts"), "utf8")).replace('"./legacyDraftQuarantine"', JSON.stringify(quarantineTypes));
const { sealLegacyDraftQuarantine, verifyLegacyDraftQuarantine } = await import(`data:text/javascript;base64,${Buffer.from(quarantineModule).toString("base64")}`);
const fakeEnvironment = { BROWSER_DRAFT_ACTIVE_KEY_ID: "fixture", BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 31).toString("base64") }), BROWSER_DRAFT_OWNER_KEY: Buffer.alloc(32, 32).toString("base64") };
const quarantineEnvironment = { BROWSER_DRAFT_QUARANTINE_ACTIVE_KEY_ID: "fixture", BROWSER_DRAFT_QUARANTINE_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 33).toString("base64") }) };
const fixtureCookie = `fixtureAccount${port}`;
const fixtureAccount = req => new RegExp(`(?:^|;\\s*)${fixtureCookie}=([AB])(?:;|$)`).exec(req.headers.cookie ?? "")?.[1];
const receipts = new Map();
let behavior = "normal", attempts = 0;
function sendJson(res, data, status = 200) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:41876");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/fixture-mode" && req.method === "POST") { behavior = url.searchParams.get("mode") ?? "normal"; sendJson(res, { behavior }); return; }
  if (url.pathname === "/fixture-stats") { sendJson(res, { behavior, attempts, created: receipts.size, receipts: [...receipts].map(([key, value]) => ({ key, ...value })) }); return; }
  if (url.pathname.startsWith("/api/browser-drafts/quarantine/")) {
    const account = fixtureAccount(req);
    if (!account || req.method !== "POST") { sendJson(res, { ok: false }, 401); return; }
    try {
      let body = ""; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (url.pathname.endsWith("/seal")) sendJson(res, { record: sealLegacyDraftQuarantine(data.snapshot, `google:fixture-${account}`, quarantineEnvironment) });
      else if (behavior === "fail-quarantine-verify") sendJson(res, { ok: false }, 503);
      else sendJson(res, verifyLegacyDraftQuarantine(data.record, data.snapshot, `google:fixture-${account}`, quarantineEnvironment));
    } catch { sendJson(res, { ok: false }, 400); }
    return;
  }
  if (url.pathname === "/api/operations" || /^\/api\/operations\/[^/]+\/rounds$/.test(url.pathname)) {
    if (req.method !== "POST") { sendJson(res, { ok: false }, 503); return; }
    const account = fixtureAccount(req);
    if (!account || req.headers["x-operation-submission-subject"] !== `google:fixture-${account}`) { sendJson(res, { ok: false }, 409); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    attempts++;
    const id = `${account}:${req.headers["idempotency-key"]}`;
    if (behavior === "fail-next") { behavior = "normal"; sendJson(res, { ok: false }, 503); return; }
    const existing = receipts.get(id);
    if (existing && existing.body !== body) { sendJson(res, { ok: false }, 409); return; }
    const receipt = existing ?? { body, operationId: `fixture-${receipts.size + 1}` };
    receipts.set(id, receipt);
    if (behavior === "lose-next-response") { behavior = "normal"; req.socket.destroy(); return; }
    sendJson(res, { ok: true, operation: { operationId: receipt.operationId } }); return;
  }
  if (url.pathname.startsWith("/api/operations/")) { sendJson(res, { ok: false, error: "합성 업무 API 장애" }, 503); return; }
  if (url.pathname === "/fixture-account" && req.method === "POST") {
    const account = url.searchParams.get("account");
    if (!["A", "B", "logout"].includes(account)) { res.writeHead(400).end(); return; }
    res.setHeader("Set-Cookie", `${fixtureCookie}=${account}; Path=/; HttpOnly; SameSite=Strict`);
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ subject: account === "logout" ? null : `google:fixture-${account}` })); return;
  }
  if (url.pathname === "/api/browser-drafts/keyring" && req.method === "POST") {
    const account = fixtureAccount(req);
    if (!account) { res.writeHead(401).end(); return; }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(deriveBrowserDraftKeyring(`google:fixture-${account}`, fakeEnvironment))); return;
  }
  try {
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>실제 초안 컴포넌트 합성 검증</title><style>body{font-family:system-ui;padding:20px}textarea,input{min-width:260px}button{margin:4px}dialog{max-width:90vw}</style><div id="root"></div><script src="/bundle.js"></script></html>'); return; }
    if (url.pathname === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile("/tmp/hub-om-draft-product-fixture/bundle.js")); return; }
    res.writeHead(404).end();
  } catch { res.writeHead(503).end("Synthetic fixture unavailable."); }
}).listen(port, "127.0.0.1", () => console.log(`Synthetic product draft fixture http://127.0.0.1:${port}`));
