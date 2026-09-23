/* global document, window, navigator, crypto, indexedDB, caches, PublicKeyCredential, MessageChannel */
import { createVault, unlockVault, encryptDraft, decryptDraft } from "/modules/browserDraftCrypto.js";
import { IndexedDbDraftStore, migrateLegacyDraft } from "/modules/browserDraftStore.js";
const store = new IndexedDbDraftStore({ databaseName: "hub-om-pii-isolated-fixture-v1" });
const owner = document.getElementById("owner"), secret = document.getElementById("secret"), draft = document.getElementById("draft");
const results = document.getElementById("results"), status = document.getElementById("status");
let key = null, keyOwner = null, generation = 0;
const scope = () => ({ owner: owner.value, kind: "lecture", operationId: "fictional-operation" });
const report = value => { results.textContent = JSON.stringify(value, null, 2); };
const locked = () => { generation++; key = null; keyOwner = null; secret.value = ""; draft.value = ""; draft.disabled = true; status.textContent = "잠김 — 자동 복호화 없음"; };
const activeKey = () => { if (!key || keyOwner !== owner.value) throw new Error("locked"); return key; };
const action = (id, callback) => document.getElementById(id).addEventListener("click", async () => {
  try { await callback(); } catch { status.textContent = "작업 실패 — 기존 저장본 보존, 평문 fallback 없음"; }
});
owner.addEventListener("change", locked);
action("lock", locked);
action("create", async () => {
  const selected = owner.value, startedGeneration = generation;
  const created = await createVault(secret.value, selected);
  await store.createVault(selected, created.envelope);
  if (selected !== owner.value || startedGeneration !== generation) return;
  key = created.key; keyOwner = selected; secret.value = ""; draft.disabled = false; status.textContent = "가상 보관함 준비됨";
});
action("unlock", async () => {
  const selected = owner.value, entered = secret.value, startedGeneration = generation;
  const loaded = await store.readVault(selected);
  const recovered = await unlockVault(loaded, entered, selected);
  if (selected !== owner.value || startedGeneration !== generation) return;
  key = recovered; keyOwner = selected; secret.value = ""; draft.disabled = false; status.textContent = "잠금 해제됨 — 서버 인증을 의미하지 않음";
});
action("save", async () => {
  const captured = scope(), text = draft.value, currentKey = activeKey();
  const ciphertext = await encryptDraft(currentKey, captured, { text });
  await store.writeDraft(captured, ciphertext);
  if (captured.owner === owner.value && key === currentKey) status.textContent = "암호화 저장 완료 — IndexedDB commit 확인";
});
action("load", async () => {
  const captured = scope(), currentKey = activeKey();
  const encrypted = await store.readDraft(captured);
  const value = await decryptDraft(currentKey, captured, encrypted);
  if (captured.owner !== owner.value || key !== currentKey) return;
  draft.value = value.text; status.textContent = "초안 복구 완료 — 로컬 암호문 복호화";
});
action("offline", async () => {
  const expectedVersion = 3, expectedCache = "pii-fixture-shell-v3";
  status.textContent = "새 복구 화면 설치·활성화 확인 중";
  report({ expectedVersion, ready: false });
  const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  await registration.update();
  // ready can resolve to an older active worker during an update. Ask the actual
  // controller for its version and complete asset manifest instead.
  const deadline = Date.now() + 15_000;
  const probe = worker => new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = result => { window.clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(result); };
    const timer = window.setTimeout(() => finish(null), 500);
    channel.port1.onmessage = event => finish(event.data);
    try { worker.postMessage({ type: "fixture-shell-status" }, [channel.port2]); }
    catch { finish(null); }
  });
  while (Date.now() < deadline) {
    const worker = navigator.serviceWorker.controller;
    if (worker && worker === registration.active && worker.state === "activated" && !registration.installing && !registration.waiting) {
      const info = await probe(worker);
      if (worker === navigator.serviceWorker.controller && worker === registration.active
        && !registration.installing && !registration.waiting && info?.version === expectedVersion
        && info.cacheName === expectedCache && info.complete === true) {
        report({ expectedVersion, activeVersion: info.version, cachedShellOnly: info.assets, controllerReady: true });
        status.textContent = "v3 최소 복구 화면 준비 완료 — 이 격리 origin에서만 사용";
        return;
      }
    }
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  report({ expectedVersion, ready: false, previousCacheRetained: true });
  throw new Error("Fixture worker update not confirmed.");
});
action("offline-failure", async () => {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const previous = navigator.serviceWorker.controller;
  if (!registration?.active || !previous || registration.active !== previous) throw new Error("Prepare the shell first.");
  const before = (await caches.keys()).filter(name => name.startsWith("pii-fixture-shell-"));
  const cachedPaths = async names => Promise.all(names.map(async name => [name, (await (await caches.open(name)).keys()).map(request => request.url).sort()]));
  const previousContents = JSON.stringify(await cachedPaths(before));
  status.textContent = "후보 워커 설치 중간 실패 검증 중";
  const failed = new Promise(resolve => {
    let candidate;
    const finish = value => { window.clearTimeout(timer); registration.removeEventListener("updatefound", observe); candidate?.removeEventListener("statechange", changed); resolve(value); };
    const changed = () => { if (candidate?.state === "redundant") finish(true); else if (candidate?.state === "activated") finish(false); };
    const observe = () => { candidate = registration.installing; candidate?.addEventListener("statechange", changed); changed(); };
    const timer = window.setTimeout(() => finish(false), 10_000);
    registration.addEventListener("updatefound", observe);
  });
  try { await navigator.serviceWorker.register("/sw.js?fixture-install=fail", { updateViaCache: "none" }); }
  catch { /* Candidate rejection is expected; state and old controller are checked below. */ }
  const rejected = await failed;
  const after = await caches.keys();
  const retained = before.every(name => after.includes(name)) && previousContents === JSON.stringify(await cachedPaths(before));
  const controllerRetained = navigator.serviceWorker.controller === previous && registration.active === previous && previous.state === "activated";
  report({ failedCandidateRejected: rejected, previousControllerRetained: controllerRetained, previousCacheEntriesRetained: retained });
  if (!rejected || !retained || !controllerRetained) throw new Error("Failed update preservation not confirmed.");
  status.textContent = "설치 실패 후보 차단·기존 복구 화면 보존 확인 — 정상 준비 버튼으로 복원 가능";
});
action("inspect", async () => {
  const envelope = await store.readVault(owner.value), encrypted = await store.readDraft(scope());
  report({ owner: owner.value, locked: !key, vaultFields: envelope ? Object.keys(envelope) : [], draftFields: encrypted ? Object.keys(encrypted) : [], rawKeyFieldStored: envelope ? Object.keys(envelope).some(k => /^(key|rawKey|secret|password)$/.test(k)) : false, plaintextInRecord: encrypted ? JSON.stringify(encrypted).includes(draft.value || "impossible-fixture-marker") : false });
});
action("faults", async () => {
  const currentKey = activeKey(), captured = scope(), existing = await store.readDraft(captured);
  const checks = {};
  const mustReject = async callback => { try { await callback(); return false; } catch { return true; } };
  checks.wrongOwnerRejected = await mustReject(() => decryptDraft(currentKey, { ...captured, owner: "other" }, existing));
  const corrupt = { ...existing, ciphertext: (existing.ciphertext[0] === "A" ? "B" : "A") + existing.ciphertext.slice(1) };
  checks.tamperRejected = await mustReject(() => decryptDraft(currentKey, captured, corrupt));
  checks.nonextractable = await mustReject(() => crypto.subtle.exportKey("raw", currentKey));
  checks.wrongSecretRejected = await mustReject(async () => unlockVault(await store.readVault(captured.owner), "wrong-fixture-secret", captured.owner));
  const persistedVault = await store.readVault(captured.owner);
  checks.nativeDuplicateVaultAbort = await mustReject(() => store.createVault(captured.owner, persistedVault));
  const unavailable = new IndexedDbDraftStore({ databaseName: "hub-om-pii-isolated-fixture-v1", indexedDB: { open() { throw new DOMException("synthetic quota failure", "QuotaExceededError"); } } });
  checks.injectedQuotaFailureRejected = await mustReject(() => unavailable.writeDraft(captured, existing));
  checks.existingVaultPreserved = JSON.stringify(persistedVault) === JSON.stringify(await store.readVault(captured.owner));
  checks.existingCiphertextPreserved = JSON.stringify(existing) === JSON.stringify(await store.readDraft(captured));
  report(checks); status.textContent = "실패 조건 검증 완료";
});
action("legacy", async () => {
  const currentKey = activeKey(), migrationSecret = secret.value;
  secret.value = "";
  const captured = { ...scope(), operationId: "legacy-" + crypto.randomUUID() };
  const legacyKey = "pii-fixture-legacy-only", raw = JSON.stringify({ text: "합성 과거 초안" });
  window.localStorage.setItem(legacyKey, raw);
  let unknownRejected = false;
  try { await migrateLegacyDraft({ store, storage: window.localStorage, legacyKey, scope: captured, secret: migrationSecret }); } catch { unknownRejected = true; }
  const unknownPreserved = window.localStorage.getItem(legacyKey) === raw;
  await migrateLegacyDraft({ store, storage: window.localStorage, legacyKey, scope: captured, secret: migrationSecret, confirmedOwner: captured.owner });
  const value = await decryptDraft(currentKey, captured, await store.readDraft(captured));
  const recovery = await decryptDraft(currentKey, captured, await store.readRecovery(captured));
  report({ immutableRecoveryVerified: recovery.text === "합성 과거 초안", unknownOwnerRejected: unknownRejected, unknownOwnerOriginalPreserved: unknownPreserved, confirmedMigrationRecovered: value.text === "합성 과거 초안", plaintextRemovedAfterVerification: window.localStorage.getItem(legacyKey) === null });
  status.textContent = "가짜 기존 초안 전환 검증 완료";
});
action("nonextractable", async () => {
  const db = await new Promise((resolve, reject) => { const req = indexedDB.open("pii-fixture-nonextractable", 1); req.onupgradeneeded = () => req.result.createObjectStore("keys"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await new Promise((resolve, reject) => { const tx = db.transaction("keys", "readwrite"); tx.objectStore("keys").put(generated, "probe"); tx.oncomplete = resolve; tx.onabort = reject; });
  const loaded = await new Promise((resolve, reject) => { const req = db.transaction("keys").objectStore("keys").get("probe"); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, loaded, new TextEncoder().encode("synthetic"));
  const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, loaded, encrypted);
  let exportRejected = false; try { await crypto.subtle.exportKey("raw", loaded); } catch { exportRejected = true; }
  db.close(); report({ persistedNonextractable: !loaded.extractable, rawExportRejected: exportRejected, sameOriginCanDecryptWithoutAccountSecret: new TextDecoder().decode(decoded) === "synthetic" });
});
action("capabilities", async () => {
  const capabilities = typeof PublicKeyCredential !== "undefined" && PublicKeyCredential.getClientCapabilities ? await PublicKeyCredential.getClientCapabilities() : null;
  report({ secureContext: window.isSecureContext, webCrypto: !!crypto.subtle, indexedDB: !!indexedDB, prfClientAdvertised: capabilities?.["extension:prf"] ?? "unknown", authenticatorPrfTested: false, persisted: navigator.storage?.persisted ? await navigator.storage.persisted() : null });
});
