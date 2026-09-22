/** Explicitly authorized, temporary loopback replica-set setup/stop only.
 * No dotenv, production URI, key loading, dependency installation or test invocation.
 * Verify the official archive checksum before supplying --binary.
 */
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const prefix = "/private/tmp/hub-om-mongo-runtime-";
const fail = () => { throw new Error("TEMP_RUNTIME_HELPER_FAILED"); };
function ownedPath(path) {
  const value = realpathSync(path);
  if (!value.startsWith(prefix)) fail();
  return value;
}
async function stop(statePath) {
  const file = ownedPath(statePath);
  const state = JSON.parse(readFileSync(file, "utf8"));
  const root = ownedPath(dirname(file));
  if (state.owner !== "hub-om-synthetic-mongo-v1" || state.root !== root || state.dbpath !== join(root, "data") || !Number.isInteger(state.pid) || state.pid < 2) fail();
  const binary = ownedPath(state.binary);
  let command;
  try { command = execFileSync("/bin/ps", ["-p", String(state.pid), "-o", "command="], { encoding: "utf8" }).trim(); }
  catch { return { stopped: true, alreadyExited: true, root }; }
  if (!command.startsWith(binary + " ") || !command.includes(`--dbpath ${state.dbpath} `) || !command.includes("--bind_ip 127.0.0.1 ")) fail();
  process.kill(state.pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    try { process.kill(state.pid, 0); } catch { return { stopped: true, root, filesRetained: true }; }
    await delay(100);
  }
  throw new Error("OWNED_PROCESS_STOP_TIMEOUT");
}
async function start(binaryPath) {
  const binary = ownedPath(binaryPath);
  if (!binary.endsWith("/bin/mongod")) fail();
  const { MongoClient } = await import("mongodb");
  const root = realpathSync(mkdtempSync("/tmp/hub-om-mongo-runtime-"));
  const dbpath = join(root, "data"); mkdirSync(dbpath);
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const replset = "hubOmSynthetic";
  const uri = `mongodb://127.0.0.1:${port}/?replicaSet=${replset}&directConnection=true`;
  const child = spawn(binary, ["--dbpath", dbpath, "--port", String(port), "--bind_ip", "127.0.0.1", "--replSet", replset, "--logpath", join(root, "mongod.log"), "--wiredTigerCacheSizeGB", "0.25"], { detached: true, stdio: "ignore", env: { PATH: "/usr/bin:/bin" } });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  const statePath = join(root, "owner.json");
  writeFileSync(statePath, JSON.stringify({ owner: "hub-om-synthetic-mongo-v1", root, dbpath, binary, pid: child.pid, port, uri }, null, 2), { mode: 0o600 });
  const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 3000 });
  try {
    // Check the listener's OS owner before sending any MongoDB commands.
    let listening = false;
    for (let i = 0; i < 100; i++) {
      process.kill(child.pid, 0);
      let owners = "";
      try { owners = execFileSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* No listener yet. */ }
      if (owners) {
        if (owners !== String(child.pid)) throw new Error("PORT_OWNERSHIP_MISMATCH");
        listening = true; break;
      }
      await delay(100);
    }
    if (!listening) throw new Error("OWNED_LISTENER_TIMEOUT");
    await client.connect();
    await client.db("admin").command({ replSetInitiate: { _id: replset, members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let i = 0; i < 100; i++) {
      const hello = await client.db("admin").command({ hello: 1 });
      if (hello.isWritablePrimary) return { ready: true, uri, pid: child.pid, statePath, root };
      await delay(200);
    }
    throw new Error("PRIMARY_ELECTION_TIMEOUT");
  } catch (error) {
    await stop(statePath);
    throw error;
  } finally { await client.close(); }
}
try {
  const [mode, flag, value, ...extra] = process.argv.slice(2);
  if (mode === "--help") console.log("start --binary VERIFIED_TEMP_MONGOD | stop --state TEMP_OWNER_JSON (retains files; no tests run)");
  else if (!value || extra.length || !((mode === "start" && flag === "--binary") || (mode === "stop" && flag === "--state"))) fail();
  else console.log(JSON.stringify(mode === "start" ? await start(value) : await stop(value)));
} catch { console.error("TEMP_RUNTIME_HELPER_FAILED (inspect only the owned temporary log)"); process.exitCode = 1; }
