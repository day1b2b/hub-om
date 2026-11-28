import { randomUUID } from "node:crypto";
import { generateCoachAccessToken, normalizeCoachName } from "./accessToken";
import { mapPageToCoachRecord, type JsonObject, type NotionCoachRecord } from "./notionCoachMap";
import { emptySyncResult, type SyncResult } from "./syncTypes";
import type { CoachNotionSyncReader, CoachNotionSyncRepository, CoachNotionSyncTransaction, NotionSyncCoach, NotionSyncPrivateProfile } from "../data/coachNotionSyncRepository";

export interface CoachMatch { coach: NotionSyncCoach | null; by: "notionNo" | "name" | "duplicateRow"; sameNameExists: boolean }
export async function findNotionCoach(reader: CoachNotionSyncReader, record: NotionCoachRecord): Promise<CoachMatch> {
  if (record.notionNo !== null) {
    const coach = await reader.findByNotionNo(record.notionNo);
    if (coach) return { coach, by: "notionNo", sameNameExists: false };
  }
  const candidates = await reader.listByNormalizedName(normalizeCoachName(record.name));
  const unkeyed = candidates.find(coach => record.notionNo === null || coach.notionNo === null);
  if (unkeyed) return { coach: unkeyed, by: "name", sameNameExists: true };
  const duplicate = candidates.find(coach =>
    Boolean(record.phone && record.phone === coach.privateProfile?.phone) ||
    Boolean(record.birthDate && coach.privateProfile?.birthDate && record.birthDate.getTime() === coach.privateProfile.birthDate.getTime()));
  return { coach: duplicate ?? null, by: duplicate ? "duplicateRow" : "name", sameNameExists: candidates.length > 0 };
}

export async function runNotionCoachSync(pages: JsonObject[], repository: CoachNotionSyncRepository, dryRun: boolean): Promise<SyncResult> {
  const result = emptySyncResult(dryRun); result.totalRows = pages.length;
  for (const page of pages) {
    const record = mapPageToCoachRecord(page);
    if (!record?.name) { result.skipped++; continue; }
    try {
      if (dryRun) {
        const matched = await findNotionCoach(repository, record);
        result.changes?.push({ coachName: record.name, action: matched.coach ? "update_notion" : "create_notion", details: describeDryRun(matched, record) });
        if (matched.coach) result.updated++; else result.created++;
        continue;
      }
      const { created } = await applyOneNotionCoach(record, repository);
      if (created) result.created++; else result.updated++;
    } catch {
      result.errors++;
      result.errorDetail.push("COACH_NOTION_ROW_FAILED");
    }
  }
  return result;
}

/**
 * 노션 코치 1건(한 행/한 페이지)을 멱등 반영한다. 전체 동기화의 '한 행 처리'이자, S2 '링크로 한 명 추가'의 단건 진입점.
 * notionNo→이름→중복행 순으로 기존 코치를 찾아 있으면 patch, 없으면 create. 락 안에서 재조회해 동시 변경을 막는다.
 * 반환 coachId로 운영현황 타입어헤드가 바로 그 코치를 선택할 수 있다.
 */
export async function applyOneNotionCoach(record: NotionCoachRecord, repository: CoachNotionSyncRepository): Promise<{ coachId: string; created: boolean }> {
  return repository.transaction(async (tx) => {
    const initial = await findNotionCoach(tx, record);
    const id = initial.coach?.id ?? randomUUID();
    await tx.lockCoaches([id]);
    const matched = await findNotionCoach(tx, record);
    if ((matched.coach?.id ?? null) !== (initial.coach?.id ?? null)) throw new Error("COACH_NOTION_MATCH_CHANGED");
    const existing = matched.coach, duplicate = matched.by === "duplicateRow";
    if (existing) await tx.patchCoach(id, duplicate ? fillEmptyCoachUpdate(existing, record) : publicCoachUpdate(record));
    else await tx.createCoach({ id, sourceCoachId: record.notionNo === null ? `notion:${normalizeCoachName(record.name)}` : `notion:no-${record.notionNo}`, accessToken: generateCoachAccessToken(), name: record.name, normalizedName: normalizeCoachName(record.name), ...publicCoachUpdate(record) });
    await writePrivateProfile(tx, id, record, duplicate ? existing?.privateProfile ?? null : null);
    if (record.fields.length && !(duplicate && existing?.fields.length)) await tx.replaceTags(id, "fields", record.fields);
    if (record.curriculums.length && !(duplicate && existing?.curriculums.length)) await tx.replaceTags(id, "curriculums", record.curriculums);
    return { coachId: id, created: !existing };
  });
}

async function writePrivateProfile(tx: CoachNotionSyncTransaction, coachId: string, record: NotionCoachRecord, current: NotionSyncPrivateProfile | null) {
  const patch: Partial<Omit<NotionSyncPrivateProfile, "employeeId">> = {};
  if (record.phone && !current?.phone) patch.phone = record.phone;
  if (record.email && !current?.email) patch.email = record.email;
  if (record.birthDate && !current?.birthDate) patch.birthDate = record.birthDate;
  if (record.affiliation && !current?.affiliation) patch.affiliation = record.affiliation;
  await tx.upsertPrivateProfile(coachId, { employeeId: record.employeeNo, phone: record.phone, email: record.email, birthDate: record.birthDate, affiliation: record.affiliation }, patch);
}

function publicCoachUpdate(record: NotionCoachRecord) {
  // 이름(name·normalizedName)은 노션 값으로 덮지 않는다. 계약시트 동기화가 코치를 이름으로 찾기 때문에
  // 여기서 이름을 바꾸면 시트 쪽에서 같은 사람을 새 코치로 또 만든다. 이름 차이는 미리보기에만 표시한다.
  return {
    ...(record.employeeNo !== null ? { employeeNo: record.employeeNo } : {}),
    ...(record.notionNo !== null ? { notionNo: record.notionNo } : {}),
    ...(record.notionPageId ? { notionPageId: record.notionPageId } : {}),
    ...(record.workType ? { workType: record.workType } : {}),
    ...(record.portfolioUrl ? { portfolioUrl: record.portfolioUrl } : {}),
    ...(record.selfNote ? { selfNote: record.selfNote } : {}),
    ...(record.availabilityDetail ? { availabilityDetail: record.availabilityDetail } : {})
  };
}

function fillEmptyCoachUpdate(coach: NotionSyncCoach, record: NotionCoachRecord) {
  const isEmpty = (value: string | null) => value === null || value === "";
  return {
    ...(record.employeeNo !== null && isEmpty(coach.employeeNo) ? { employeeNo: record.employeeNo } : {}),
    ...(record.notionPageId && isEmpty(coach.notionPageId) ? { notionPageId: record.notionPageId } : {}),
    ...(record.workType && isEmpty(coach.workType) ? { workType: record.workType } : {}),
    ...(record.portfolioUrl && isEmpty(coach.portfolioUrl) ? { portfolioUrl: record.portfolioUrl } : {}),
    ...(record.selfNote && isEmpty(coach.selfNote) ? { selfNote: record.selfNote } : {}),
    ...(record.availabilityDetail && isEmpty(coach.availabilityDetail)
      ? { availabilityDetail: record.availabilityDetail }
      : {})
  };
}

// 미리보기 문구. 무엇을 기준으로 연결됐는지(ID/이름)와 이름 차이를 운영자가 볼 수 있게 남긴다.
function describeDryRun(matched: CoachMatch, record: NotionCoachRecord): string {
  const existing = matched.coach;
  const idText = record.notionNo === null ? "ID 없음" : `ID ${record.notionNo}`;

  if (!existing) {
    // 같은 이름이 이미 있는데 새로 만든다면 동명이인이거나 노션에 같은 사람이 두 행으로 있는 경우다.
    return matched.sameNameExists ? `신규 코치 (${idText}) · 동명 코치 있음 — 노션 중복 행인지 확인` : `신규 코치 (${idText})`;
  }

  const parts: string[] = [];
  if (matched.by === "notionNo") parts.push(`${idText}로 연결`);
  else if (matched.by === "duplicateRow") {
    // 이전 행 ID를 그대로 쓰고 빈 칸만 채운다. 노션에서 중복 행을 지우면 이 줄이 사라진다.
    parts.push(`노션 중복 행(${idText}) — 이전 행 ID ${existing.notionNo ?? "없음"} 코치에 합침(빈 칸만 채움)`);
  } else if (record.notionNo !== null) parts.push(`${idText} 연결(이름으로 찾은 예전 행)`);
  else parts.push("이름으로 연결 (노션에 ID 없음)");

  if (existing.name !== record.name) {
    parts.push(`노션 이름 ${existing.name} → ${record.name} (사이트 이름은 유지)`);
  }

  const diffs = diffRecord(existing, record);
  parts.push(diffs.length > 0 ? diffs.join(", ") : "변경 없음");
  return parts.join(" / ");
}

function diffRecord(existing: NotionSyncCoach, record: NotionCoachRecord): string[] {
  const diffs: string[] = [];
  if (record.phone && record.phone !== existing.privateProfile?.phone) diffs.push("연락처");
  if (record.email && record.email !== existing.privateProfile?.email) diffs.push("이메일");
  if (record.affiliation && record.affiliation !== existing.privateProfile?.affiliation) diffs.push("소속");
  if (record.workType && record.workType !== existing.workType) diffs.push("근무유형");
  if (record.portfolioUrl && record.portfolioUrl !== existing.portfolioUrl) diffs.push("포트폴리오");
  if (record.selfNote && record.selfNote !== existing.selfNote) diffs.push("특이사항");
  if (record.availabilityDetail && record.availabilityDetail !== existing.availabilityDetail) diffs.push("가용정보");
  return diffs;
}
