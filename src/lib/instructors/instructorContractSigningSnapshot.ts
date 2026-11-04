// 강사 계약 진행상태 스냅샷(시트 요청·발송 + 모두싸인 서명). 08:00·12:00 예약 작업이 만들고,
// 교육상세는 이 스냅샷을 읽어 화면을 열자마자 단계를 보여준다(핫 페이지라 그때 외부 API를 부르지 않는다).
//
// 저장 위치: DB 테이블이 아니라 암호화 파일(reminderSentLog와 같은 방식). 내용은 모두싸인·시트의 사본(캐시)이라
// 원본은 저쪽에 있고, 컨테이너 재시작으로 사라져도 다음 조회 때 다시 만든다(ensureSigningSnapshot).
// 이메일·서명자 이름은 저장하지 않는다 — (코스ID × 강사명) 키, 단계, 역할별 서명 여부, 시각만.
import { encodePrivateJson, decodePrivateJson } from "@/lib/privacy/crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { normalizeCourseId } from "@/lib/data/operationCalculations";
import { listModusignDocuments, odataString, readModusignConfig, type ModusignConfig, type ModusignDocument } from "@/lib/modusign/modusignClient";
import { readInstructorContractRecords, type InstructorContractRecord } from "./instructorContractSheet";
import { normalizeInstructorName } from "./instructorContractMatch";
import { matchSigningDocuments, parseSheetTimestamp, type SigningSummary } from "./instructorContractSigning";

const FILE_CONTEXT = "local:instructor-contract-signing";
// 모두싸인 조회 기간. 계약은 교육 전에 끝나니 반년이면 진행 중인 건은 다 들어온다.
const LOOKBACK_DAYS = 180;

export interface ContractProgressEntry {
  requested: boolean;
  sent: boolean;
  signing?: SigningSummary;
}

export interface ContractProgressSnapshot {
  /** 마지막 동기화 시각(ISO). */
  syncedAt: string;
  /** 모두싸인을 읽었는지(키 미설정·오류면 false — 그땐 시트 단계만 있다). */
  modusignSynced: boolean;
  entries: Record<string, ContractProgressEntry>;
}

/** (정규화 코스ID × 정규화 강사명). instructorContractRequests의 statusKey와 같은 규칙. */
export function progressKey(courseId: string, instructorName: string): string {
  return `${normalizeCourseId((courseId ?? "").trim())}\u0000${normalizeInstructorName(instructorName)}`;
}

function snapshotFile(): string {
  return process.env.INSTRUCTOR_CONTRACT_SIGNING_FILE?.trim() || path.join(os.tmpdir(), "hub-om-instructor-contract-signing.json");
}

export function readSigningSnapshot(): ContractProgressSnapshot | null {
  const file = snapshotFile();
  if (!fs.existsSync(/* turbopackIgnore: true */ file)) return null;
  try {
    const parsed = decodePrivateJson(fs.readFileSync(/* turbopackIgnore: true */ file, "utf-8"), FILE_CONTEXT) as ContractProgressSnapshot;
    return parsed && typeof parsed === "object" && parsed.entries ? parsed : null;
  } catch {
    // 키가 바뀌었거나 깨진 파일 — 없는 것으로 보고 다음 동기화가 다시 쓴다.
    return null;
  }
}

function writeSigningSnapshot(snapshot: ContractProgressSnapshot): void {
  fs.writeFileSync(snapshotFile(), encodePrivateJson(snapshot, FILE_CONTEXT), { encoding: "utf-8", mode: 0o600 });
}

/** 같은 키의 시트 행이 여럿이면(재요청) 가장 늦게 제출된 행을 쓴다. 코스ID·강사명이 없는 행은 뺀다. */
export function latestRecordByKey(records: InstructorContractRecord[]): Map<string, InstructorContractRecord> {
  const byKey = new Map<string, InstructorContractRecord>();
  for (const record of records) {
    if (!(record.courseId ?? "").trim() || !normalizeInstructorName(record.instructorName)) continue;
    const key = progressKey(record.courseId, record.instructorName);
    const previous = byKey.get(key);
    if (!previous || (parseSheetTimestamp(record.requestedAt) ?? 0) >= (parseSheetTimestamp(previous.requestedAt) ?? 0)) {
      byKey.set(key, { ...record, contractSent: record.contractSent || Boolean(previous?.contractSent) });
    }
  }
  return byKey;
}

/** 시트 레코드 + 모두싸인 문서로 스냅샷 항목을 만든다(순수). 모두싸인은 발송된(C열) 행만 맞춘다. */
export function buildProgressEntries(
  records: InstructorContractRecord[],
  documents: ModusignDocument[] | null
): Record<string, ContractProgressEntry> {
  const byKey = latestRecordByKey(records);
  const signing = documents
    ? matchSigningDocuments(
        [...byKey].filter(([, record]) => record.contractSent).map(([key, record]) => ({ key, record })),
        documents
      )
    : new Map<string, SigningSummary>();
  const entries: Record<string, ContractProgressEntry> = {};
  for (const [key, record] of byKey) {
    const summary = signing.get(key);
    entries[key] = { requested: true, sent: record.contractSent, ...(summary ? { signing: summary } : {}) };
  }
  return entries;
}

function lookbackFilter(now: Date): string {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // 강사 계약서 제목엔 "(B2B)"가 들어간다 — 회사 전체 문서 중 B2B 계약만 읽는다.
  return `contains(title, ${odataString("(B2B)")}) and createdAt ge ${odataString(since)}`;
}

async function readDocuments(config: ModusignConfig | null, now: Date): Promise<ModusignDocument[] | null> {
  if (!config) return null;
  try {
    return await listModusignDocuments(config, { filter: lookbackFilter(now) });
  } catch {
    // 키 만료·권한·한도 초과. 원인 값(키 등)은 로그에 남기지 않는다.
    console.error("[instructor-contract-signing] 모두싸인 목록 읽기 실패");
    return null;
  }
}

export interface SigningSyncResult {
  ok: true;
  syncedAt: string;
  modusignSynced: boolean;
  contractCount: number;
  signingMatched: number;
  completed: number;
  signing: number;
  ambiguous: number;
}

/** 시트 + 모두싸인을 읽어 스냅샷을 새로 쓴다(예약 작업·관리자 실행). 시트를 못 읽으면 던진다. */
export async function runSigningSync(now: Date = new Date()): Promise<SigningSyncResult> {
  const records = await readInstructorContractRecords();
  const documents = await readDocuments(readModusignConfig(), now);
  const entries = buildProgressEntries(records, documents);
  const snapshot: ContractProgressSnapshot = { syncedAt: now.toISOString(), modusignSynced: documents !== null, entries };
  writeSigningSnapshot(snapshot);

  const summaries = Object.values(entries).flatMap((entry) => (entry.signing ? [entry.signing] : []));
  return {
    ok: true,
    syncedAt: snapshot.syncedAt,
    modusignSynced: snapshot.modusignSynced,
    contractCount: Object.keys(entries).length,
    signingMatched: summaries.length,
    completed: summaries.filter((summary) => summary.phase === "completed").length,
    signing: summaries.filter((summary) => summary.phase === "signing").length,
    ambiguous: summaries.filter((summary) => summary.phase === "ambiguous").length
  };
}

let inFlight: Promise<unknown> | null = null;

/**
 * 스냅샷이 없으면(배포·재시작 직후) 백그라운드로 한 번 만든다. 기다리지 않는다 — 이번 화면은 "불러오는 중"으로
 * 두고 다음 열람부터 보인다. 동시에 여러 번 불려도 한 번만 돈다.
 */
export function ensureSigningSnapshot(): void {
  if (inFlight || readSigningSnapshot()) return;
  if (!process.env.INSTRUCTOR_CONTRACT_SHEET_ID?.trim()) return;
  inFlight = runSigningSync()
    .catch(() => console.error("[instructor-contract-signing] 첫 동기화 실패"))
    .finally(() => {
      inFlight = null;
    });
}

/** 한 과정의 강사들에 대한 스냅샷 항목(교육상세용). 스냅샷이 없으면 null. */
export function readCourseProgress(
  pairs: { courseId: string; instructorName: string }[]
): { syncedAt: string; modusignSynced: boolean; entries: Record<string, ContractProgressEntry> } | null {
  const snapshot = readSigningSnapshot();
  if (!snapshot) return null;
  const entries: Record<string, ContractProgressEntry> = {};
  for (const pair of pairs) {
    const entry = snapshot.entries[progressKey(pair.courseId, pair.instructorName)];
    if (entry) entries[progressKey(pair.courseId, pair.instructorName)] = entry;
  }
  return { syncedAt: snapshot.syncedAt, modusignSynced: snapshot.modusignSynced, entries };
}

/** 버튼 "지금 새로고침" 결과를 스냅샷에 덮어쓴다(그 과정 강사 키만). 스냅샷이 없으면 아무것도 안 한다. */
export function mergeIntoSnapshot(entries: Record<string, ContractProgressEntry>): void {
  const snapshot = readSigningSnapshot();
  if (!snapshot) return;
  try {
    writeSigningSnapshot({ ...snapshot, entries: { ...snapshot.entries, ...entries } });
  } catch {
    console.error("[instructor-contract-signing] 스냅샷 갱신 실패");
  }
}

/** 버튼 새로고침용: 이 강사들 이름이 제목에 들어간 문서만 모두싸인에서 읽는다(전체 목록보다 가볍다). */
export async function readDocumentsForInstructors(names: string[], now: Date = new Date()): Promise<ModusignDocument[] | null> {
  const config = readModusignConfig();
  const unique = Array.from(new Set(names.map((name) => normalizeInstructorName(name)).filter(Boolean)));
  if (!config || unique.length === 0) return null;
  try {
    const documents: ModusignDocument[] = [];
    for (const name of unique) {
      const filter = `${lookbackFilter(now)} and contains(title, ${odataString(name)})`;
      documents.push(...(await listModusignDocuments(config, { filter, maxPages: 2 })));
    }
    return documents;
  } catch {
    console.error("[instructor-contract-signing] 모두싸인 목록 읽기 실패");
    return null;
  }
}
