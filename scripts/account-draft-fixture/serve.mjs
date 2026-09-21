// Synthetic isolated origin only. No environment, app auth, DB, or real key configuration.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
const sourceRoot = process.cwd();
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const serverModule = transpile(await readFile(path.join(sourceRoot, "src/lib/privacy/browserDraftKeyring.server.ts"), "utf8"));
const { deriveBrowserDraftKeyring } = await import(`data:text/javascript;base64,${Buffer.from(serverModule).toString("base64")}`);
const fakeEnvironment = { BROWSER_DRAFT_ACTIVE_KEY_ID: "fixture", BROWSER_DRAFT_MASTER_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 31).toString("base64") }), BROWSER_DRAFT_OWNER_KEY: Buffer.alloc(32, 32).toString("base64") };
const modules = new Set(["browserDraftRuntime", "browserDraftCrypto", "accountDraftStore"]);
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:41875");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/fixture-account" && req.method === "POST") {
    const account = url.searchParams.get("account");
    if (!["A", "B", "logout"].includes(account)) { res.writeHead(400).end(); return; }
    res.setHeader("Set-Cookie", `fixtureAccount=${account}; Path=/; HttpOnly; SameSite=Strict`);
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ subject: account === "logout" ? null : `google:fixture-${account}` })); return;
  }
  if (url.pathname === "/api/browser-drafts/keyring" && req.method === "POST") {
    const account = /(?:^|;\s*)fixtureAccount=([AB])(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
    if (!account) { res.writeHead(401).end(); return; }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(deriveBrowserDraftKeyring(`google:fixture-${account}`, fakeEnvironment))); return;
  }
  try {
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(await readFile(path.join(sourceRoot, "scripts/account-draft-fixture/index.html"))); return; }
    if (url.pathname === "/harness.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(path.join(sourceRoot, "scripts/account-draft-fixture/harness.js"))); return; }
    const name = /^\/modules\/(\w+)\.js$/.exec(url.pathname)?.[1];
    if (name && modules.has(name)) {
      const source = await readFile(path.join(sourceRoot, `src/lib/privacy/${name}.ts`), "utf8");
      res.setHeader("Content-Type", "text/javascript"); res.end(transpile(source).replace(/from "\.\/(\w+)"/g, 'from "./$1.js"')); return;
    }
    res.writeHead(404).end();
  } catch { res.writeHead(503).end("Synthetic fixture unavailable."); }
}).listen(41875, "127.0.0.1", () => console.log("Synthetic account draft fixture http://127.0.0.1:41875"));
