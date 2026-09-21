// Isolated fake-data fixture only. No app/API/DB imports or environment loading.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
const root = process.cwd();
const port = Number(process.argv[2] ?? 41873);
if (![41873, 41874].includes(port)) throw new Error("Use a reserved fixture port.");
const fixture = path.join(root, "scripts/privacy-browser-fixture");
const files = new Map([
  ["/", ["index.html", "text/html"]], ["/index.html", ["index.html", "text/html"]],
  ["/harness.js", ["harness.js", "text/javascript"]], ["/sw.js", ["sw.js", "text/javascript"]],
]);
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    let body, type;
    if (/^\/modules\/browserDraft(?:Crypto|Store)\.js$/.test(url)) {
      const filename = path.basename(url, ".js") + ".ts";
      const source = await readFile(path.join(root, "src/lib/privacy", filename), "utf8");
      body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
        .replaceAll('"./browserDraftCrypto"', '"./browserDraftCrypto.js"');
      type = "text/javascript";
    } else if (files.has(url)) {
      const [filename, mime] = files.get(url);
      body = await readFile(path.join(fixture, filename)); type = mime;
    } else { res.writeHead(404); res.end("No application API in this fixture."); return; }
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  } catch { res.writeHead(503); res.end("Fixture module unavailable."); }
}).listen(port, "127.0.0.1", () => console.log(`Fake-data fixture: http://127.0.0.1:${port}`));
