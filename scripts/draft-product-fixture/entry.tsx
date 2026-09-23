import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Providers } from "../../src/components/Providers";
import { LectureManagementNoteRow } from "../../src/features/operations/LectureManagementNoteRow";
import { IssueReviewEditor } from "../../src/features/operations/IssueReviewEditor";
import { DriveImportPanel } from "../../src/features/operations/DriveImportPanel";
import { OperationCreateForm } from "../../src/app/operations/new/OperationCreateForm";
import type { OperationSession } from "../../src/lib/data/operationTypes";
import { BrowserDraftRuntime, browserDrafts, lockBrowserDrafts } from "../../src/lib/privacy/browserDraftRuntime";
import { fixtureSession } from "./auth-mock";
import { countLegacyDrafts, LEGACY_DRAFT_PREFIXES, LEGACY_REGISTRATION_UNRESOLVED } from "../../src/lib/privacy/legacyDraftSources";
import { IndexedDbLegacyQuarantineStore } from "../../src/lib/privacy/legacyDraftQuarantineStore";
const operation = new Proxy({ operationId: "synthetic-product-op", startDate: "2026-09-21", educationDates: ["2026-09-21"], specialNotes: "", operationIssue: "", omUpdate: "", driveLink: "" }, { get: (target, field) => field in target ? target[field as keyof typeof target] : "" }) as OperationSession;
function App() {
  const [report, setReport] = useState("");
  async function login(account: "A" | "B") {
    setReport(""); const response = await fetch(`/fixture-account?account=${account}`, { method: "POST" }); const value = await response.json(); fixtureSession(value.subject);
  }
  async function reconnect() { const response = await fetch("/api/browser-drafts/keyring", { method: "POST" }); const value = await response.json(); fixtureSession(value.subject); await browserDrafts.unlock(value.subject).catch(() => {}); }
  async function logout() { setReport(""); lockBrowserDrafts(); fixtureSession(null); await fetch("/fixture-account?account=logout", { method: "POST" }); }
  return <><h1>실제 초안 컴포넌트 합성 검증</h1><p>제품 컴포넌트·Provider·runtime·IndexedDB를 사용하며 로그인과 업무 API만 가짜입니다. 실제 데이터는 입력하지 않습니다.</p>
    <button onClick={() => void login("A")}>가상 A 로그인</button><button onClick={() => void login("B")}>가상 B 로그인</button><button onClick={() => void reconnect()}>현재 계정 재연결</button><button onClick={() => void logout()}>모든 탭 로그아웃</button><button onClick={() => fixtureSession(null)}>세션 조회 네트워크 실패 모의</button>
    <button onClick={async () => { const values = await Promise.all(["lecture-note", "issue-review", "drive-import"].map(async kind => [kind, await browserDrafts.read(kind, "synthetic-product-op")])); setReport(JSON.stringify(values)); }}>현재 가짜 초안 검사</button>
    <button onClick={async () => { await fetch("/fixture-mode?mode=fail-next", { method: "POST" }); setReport("다음 생성 요청503"); }}>다음 생성 실패</button>
    <button onClick={async () => { await fetch("/fixture-mode?mode=lose-next-response", { method: "POST" }); setReport("다음 생성 commit 후 응답유실"); }}>다음 생성 응답 유실</button>
    <button onClick={async () => { setReport(JSON.stringify(await (await fetch("/fixture-stats")).json())); }}>가상 생성 통계</button>
    <button onClick={() => {
      for (const prefix of LEGACY_DRAFT_PREFIXES.slice(0, 3)) localStorage.setItem(`${prefix}synthetic`, "합성격리비밀-local");
      sessionStorage.setItem(`${LEGACY_DRAFT_PREFIXES[3]}synthetic@example.invalid:team_1`, "합성격리비밀-session");
      window.dispatchEvent(new Event("focus")); setReport("합성 이전 초안 준비 완료");
    }}>합성 이전 초안 준비</button>
    <button onClick={async () => { await fetch("/fixture-mode?mode=fail-quarantine-verify", { method: "POST" }); setReport("합성 격리 검증 실패 모드"); }}>격리 검증 실패 모의</button>
    <button onClick={async () => { await fetch("/fixture-mode?mode=normal", { method: "POST" }); setReport("합성 격리 검증 정상 모드"); }}>격리 검증 정상 복구</button>
    <button onClick={() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name === "hub-om-legacy-quarantine-v1" && args[1] === "readwrite") { IDBDatabase.prototype.transaction = original; throw new DOMException("Synthetic quota", "QuotaExceededError"); }
        return original.apply(this, args);
      };
      setReport("다음 격리 저장 실패 모의");
    }}>격리 저장 실패 모의</button>
    <button onClick={async () => {
      const request = indexedDB.open("hub-om-legacy-quarantine-v1", 1);
      const records: unknown[] = await new Promise((resolve, reject) => { request.onerror = reject; request.onsuccess = () => {
        const db = request.result; const tx = db.transaction("records"); const get = tx.objectStore("records").getAll(); let rows: unknown[] = [];
        get.onsuccess = () => { rows = get.result; }; tx.oncomplete = () => { db.close(); resolve(rows); }; tx.onabort = reject;
      }; });
      const text = JSON.stringify(records);
      let immutable = true;
      if (records.length) { try { await new IndexedDbLegacyQuarantineStore().add(records[0] as Parameters<IndexedDbLegacyQuarantineStore["add"]>[0]); immutable = false; } catch { /* Existing immutable id must reject. */ } }
      setReport(JSON.stringify({ sources: countLegacyDrafts(), records: records.length, plaintextPresent: text.includes("합성격리비밀"), sourceKeyPresent: text.includes("example.invalid") || text.includes("hub-om:"), immutable, unresolved: localStorage.getItem(LEGACY_REGISTRATION_UNRESOLVED) !== null }));
    }}>격리 결과 검사</button>
    <button onClick={async () => {
      const second = new BrowserDraftRuntime(); await second.unlock(browserDrafts.getSubject()!);
      const id = `cas-${crypto.randomUUID()}`;
      const [a, b] = await Promise.all([browserDrafts.readVersioned("cas-fixture", id), second.readVersioned("cas-fixture", id)]);
      const writes = await Promise.allSettled([browserDrafts.writeIfUnchanged("cas-fixture", id, { text: "first" }, a.revision), second.writeIfUnchanged("cas-fixture", id, { text: "second" }, b.revision)]);
      const saved = await browserDrafts.readVersioned("cas-fixture", id);
      const next = await browserDrafts.writeIfUnchanged("cas-fixture", id, { text: "latest" }, saved.revision);
      let staleDeleteRejected = false; try { await second.removeIfUnchanged("cas-fixture", id, saved.revision); } catch { staleDeleteRejected = true; }
      const latest = await browserDrafts.readVersioned<{text:string}>("cas-fixture", id);
      setReport(JSON.stringify({ atomicOneWinner: writes.filter(v=>v.status === "fulfilled").length === 1, staleDeleteRejected, latestPreserved: latest.value?.text === "latest", latestRevisionMatches: latest.revision === next })); second.lock();
    }}>실제 IDB 동시 저장 충돌 검사</button>
    <button onClick={async () => {
      const rows: unknown[] = await new Promise((resolve,reject)=>{ const request = indexedDB.open("hub-om-account-drafts-v2",1); request.onerror=reject; request.onsuccess=()=>{const db=request.result;const tx=db.transaction("drafts");const get=tx.objectStore("drafts").getAll();let data:unknown[]=[];get.onsuccess=()=>{data=get.result;};tx.oncomplete=()=>{db.close();resolve(data);};tx.onabort=reject;};});
      const raw=JSON.stringify(rows); setReport(JSON.stringify({records:rows.length, plaintextMarkerPresent:raw.includes("합성비밀"), rawKeyPresent:/keyBase64|wrappedKey|secret/.test(raw), localOnlyLockMarker:Object.keys(localStorage).every(key=>key==="hub-om:draft-lock-epoch:v2"),sessionStorageEmpty:sessionStorage.length===0}));
    }}>영속 암호문 검사</button>
    <p id="fixture-navigation" /><pre aria-label="합성 검사 결과">{report}</pre>
    <Providers isAdmin={false}>
      {new URLSearchParams(window.location.search).get("form") === "create" ? <OperationCreateForm expectedSubject="google:fixture-A" initialValues={{companyName:"가상기업",courseName:"재개 검증",startDate:"2026-09-21",endDate:"2026-09-21"}} personOptions={{ om: ["가상 OM"], ld: ["가상 LD"] }} teamScope="team_1" /> : <>
        <table><tbody><LectureManagementNoteRow operationId={operation.operationId} startDate="2026-09-21" educationDates={["2026-09-21"]} done={false} value="" /></tbody></table>
        <IssueReviewEditor operation={operation} /><DriveImportPanel operation={operation} />
      </>}
    </Providers></>;
}
createRoot(document.getElementById("root")!).render(<App />);
