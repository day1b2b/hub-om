/* global document, window, indexedDB */
import { browserDrafts, connectDraftLockEvents, lockBrowserDrafts } from "/modules/browserDraftRuntime.js";
connectDraftLockEvents();
const draft = document.getElementById("draft"), status = document.getElementById("status"), result = document.getElementById("result");
let generation = -1;
browserDrafts.subscribe(() => { const snapshot = browserDrafts.getSnapshot(); if (snapshot.generation !== generation) { draft.value = ""; generation = snapshot.generation; } draft.disabled = snapshot.status !== "ready"; status.textContent = snapshot.status; });
function button(id, run) { document.getElementById(id).addEventListener("click", async () => { try { await run(); } catch { status.textContent = "작업 실패 — 기존 암호문 보존"; } }); }
async function login(account) { lockBrowserDrafts(); const response = await fetch(`/fixture-account?account=${account}`, { method: "POST" }); const value = await response.json(); await browserDrafts.unlock(value.subject); }
button("a", () => login("A")); button("b", () => login("B"));
button("connect", async () => { const response = await fetch("/api/browser-drafts/keyring", { method: "POST" }); const value = await response.json(); await browserDrafts.unlock(value.subject); });
button("logout", async () => { lockBrowserDrafts(); await fetch("/fixture-account?account=logout", { method: "POST" }); });
button("save", async () => { await browserDrafts.write("lecture-note", "synthetic-op", { text: draft.value }); status.textContent = "암호문 commit 완료"; });
button("load", async () => { const value = await browserDrafts.read("lecture-note", "synthetic-op"); draft.value = value?.text ?? ""; status.textContent = value ? "본인 초안 복구 완료" : "이 계정 초안 없음"; });
button("inspect", async () => {
  const records = await new Promise((resolve, reject) => { const req = indexedDB.open("hub-om-account-drafts-v2", 1); req.onerror = reject; req.onsuccess = () => { const db = req.result; const tx = db.transaction("drafts"); const get = tx.objectStore("drafts").getAll(); let rows; get.onsuccess = () => { rows = get.result; }; tx.oncomplete = () => { db.close(); resolve(rows); }; tx.onabort = reject; }; });
  const serialized = JSON.stringify(records);
  result.textContent = JSON.stringify({ encryptedRecordCount: records.length, onlyCiphertext: records.every(row => row.version === 2 && row.envelope.algorithm === "AES-GCM"), rawKeyPresent: /keyBase64|wrappedKey|secret/.test(serialized), syntheticTextPresent: serialized.includes("합성비밀"), localStorageOnlyLockMarker: Object.keys(window.localStorage).every(key => key === "hub-om:draft-lock-epoch:v2") });
});
