// 노션 코치 DB → coaches 동기화 (서버 실행). 매핑은 notionCoachMap이 담당한다.
//
// 연결 키는 ID다. 이름은 노션에서 바뀔 수 있고 동명이인도 있어 키로 쓸 수 없다.
// 1순위 사번(현재 연동 DB "실습코치/운영조교 DB (26.08 ver)"의 사람 단위 ID, 계약시트와 같은 값),
// 2순위 노션 "No ID"(레거시 코치 DB의 auto increment, 예: CH-51),
// 둘 다 없는 행만 예전처럼 이름으로 찾는다.
import { CoachStatus, type Prisma } from "@prisma/client";
import { generateCoachAccessToken, normalizeCoachName } from "./accessToken";
import { mapPageToCoachRecord, isObject, type JsonObject, type NotionCoachRecord } from "./notionCoachMap";
import type { SyncResult } from "./syncTypes";
import { emptySyncResult } from "./syncTypes";
import { getPrismaClient } from "@/lib/data/prisma";

const NOTION_VERSION = "2022-06-28";

const COACH_INCLUDE = {
  privateProfile: true,
  fields: { include: { tag: true } },
  curriculums: { include: { tag: true } }
} as const;

type ExistingCoach = Prisma.CoachGetPayload<{ include: typeof COACH_INCLUDE }>;

export async function syncNotionCoaches(dryRun: boolean): Promise<SyncResult> {
  const config = readNotionConfig();
  const pages = await fetchAllNotionPages(config);
  const result = emptySyncResult(dryRun);
  result.totalRows = pages.length;

  const prisma = getPrismaClient();

  for (const page of pages) {
    const record = mapPageToCoachRecord(page);
    if (!record?.name) {
      result.skipped++;
      continue;
    }

    const matched = await findCoach(prisma, record);
    const existing = matched.coach;

    if (dryRun) {
      result.changes?.push({
        coachName: record.name,
        action: existing ? "update_notion" : "create_notion",
        details: describeDryRun(matched, record)
      });
      if (existing) result.updated++;
      else result.created++;
      continue;
    }

    if (existing) {
      await prisma.$transaction(async (tx) => {
        await tx.coach.update({
          where: { id: existing.id },
          data: publicCoachUpdate(record)
        });
        await upsertPrivateProfile(tx, existing.id, record);
        if (record.fields.length > 0) await replaceFields(tx, existing.id, record.fields);
        if (record.curriculums.length > 0) await replaceCurriculums(tx, existing.id, record.curriculums);
      });
      result.updated++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const coach = await tx.coach.create({
        data: {
          sourceCoachId: newSourceCoachId(record),
          accessToken: generateCoachAccessToken(),
          name: record.name,
          normalizedName: normalizeCoachName(record.name),
          status: CoachStatus.ACTIVE,
          isActive: true,
          ...publicCoachUpdate(record)
        }
      });
      await upsertPrivateProfile(tx, coach.id, record);
      if (record.fields.length > 0) await replaceFields(tx, coach.id, record.fields);
      if (record.curriculums.length > 0) await replaceCurriculums(tx, coach.id, record.curriculums);
    });
    result.created++;
  }

  return result;
}

function readNotionConfig(): { token: string; databaseId: string } {
  const token = process.env.NOTION_TOKEN?.trim() || process.env.NOTION_API_KEY?.trim() || "";
  const databaseId =
    process.env.COACH_NOTION_DATABASE_ID?.trim() ||
    process.env.NOTION_DATABASE_ID?.trim() ||
    process.env.NOTION_IMPORT_DATABASE_ID?.trim() ||
    "";

  if (!token) throw new Error("NOTION_TOKEN 또는 NOTION_API_KEY env가 필요합니다.");
  if (!databaseId) throw new Error("COACH_NOTION_DATABASE_ID 또는 NOTION_DATABASE_ID env가 필요합니다.");
  return { token, databaseId };
}

async function fetchAllNotionPages(config: { token: string; databaseId: string }): Promise<JsonObject[]> {
  const pages: JsonObject[] = [];
  let cursor: string | undefined;

  do {
    const response = await fetch(`https://api.notion.com/v1/databases/${config.databaseId}/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "notion-version": NOTION_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });

    if (!response.ok) throw new Error(`Notion API error (${response.status}): ${await response.text()}`);
    const payload = (await response.json()) as JsonObject;
    const results = Array.isArray(payload.results) ? payload.results.filter(isObject) : [];
    pages.push(...results);
    cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : undefined;
  } while (cursor);

  return pages;
}

type MatchedBy = "employeeNo" | "notionNo" | "name";

interface CoachMatch {
  coach: ExistingCoach | null;
  by: MatchedBy;
}

/**
 * 코치 1명을 찾는다. 사번 → No ID → 이름 순서다.
 *
 * ID로 못 찾았을 때 이름으로 한 번 더 찾는 이유는 backfill이다. 기존 행에는 아직 ID가 없으므로
 * 첫 동기화가 이름으로 찾아 ID를 채운다(별도 스크립트가 필요 없다). 이때는 "아직 ID가 안 붙은 행"만
 * 본다. 이미 다른 ID가 붙은 행을 가져오면 남의 코치를 덮어쓰기 때문이다.
 *
 * 노션 행에 ID가 아예 없으면(사번 발급 전) 예전처럼 이름만으로 찾는다. 이 조건을 빼면
 * 사번 있는 행과 사번 없는 행이 같은 이름으로 있을 때(2026-09-04 노션 5건) 같은 사람이
 * 코치 목록에 두 번 생긴다.
 */
async function findCoach(
  prisma: ReturnType<typeof getPrismaClient>,
  record: NotionCoachRecord
): Promise<CoachMatch> {
  if (record.employeeNo !== null) {
    const coach = await prisma.coach.findFirst({ where: { employeeNo: record.employeeNo }, include: COACH_INCLUDE });
    if (coach) return { coach, by: "employeeNo" };
  }

  if (record.notionNo !== null) {
    const coach = await prisma.coach.findFirst({ where: { notionNo: record.notionNo }, include: COACH_INCLUDE });
    if (coach) return { coach, by: "notionNo" };
  }

  const hasId = record.employeeNo !== null || record.notionNo !== null;
  const coach = await prisma.coach.findFirst({
    where: {
      normalizedName: normalizeCoachName(record.name),
      ...(hasId ? { employeeNo: null, notionNo: null } : {})
    },
    include: COACH_INCLUDE,
    orderBy: { createdAt: "asc" }
  });
  return { coach, by: "name" };
}

// 새로 만드는 코치의 sourceCoachId. ID가 있으면 이름이 바뀌어도 안 흔들리는 ID를 쓴다.
function newSourceCoachId(record: NotionCoachRecord): string {
  if (record.employeeNo !== null) return `notion:emp-${record.employeeNo}`;
  if (record.notionNo !== null) return `notion:no-${record.notionNo}`;
  return `notion:${normalizeCoachName(record.name)}`;
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

async function upsertPrivateProfile(tx: Prisma.TransactionClient, coachId: string, record: NotionCoachRecord) {
  await tx.coachPrivateProfile.upsert({
    where: { coachId },
    create: {
      coachId,
      // 계약시트도 같은 사번을 여기에 담는다. 이미 값이 있으면 시트 쪽 값을 덮지 않는다(update에 없음).
      employeeId: record.employeeNo,
      phone: record.phone,
      email: record.email,
      birthDate: record.birthDate,
      affiliation: record.affiliation
    },
    update: {
      ...(record.phone ? { phone: record.phone } : {}),
      ...(record.email ? { email: record.email } : {}),
      ...(record.birthDate ? { birthDate: record.birthDate } : {}),
      ...(record.affiliation ? { affiliation: record.affiliation } : {})
    }
  });
}

async function replaceFields(tx: Prisma.TransactionClient, coachId: string, fields: string[]) {
  await tx.coachField.deleteMany({ where: { coachId } });
  for (const name of fields) {
    const tag = await tx.coachFieldMaster.upsert({ where: { name }, create: { name }, update: {} });
    await tx.coachField.create({ data: { coachId, tagId: tag.id } });
  }
}

async function replaceCurriculums(tx: Prisma.TransactionClient, coachId: string, curriculums: string[]) {
  await tx.coachCurriculum.deleteMany({ where: { coachId } });
  for (const name of curriculums) {
    const tag = await tx.coachCurriculumMaster.upsert({ where: { name }, create: { name }, update: {} });
    await tx.coachCurriculum.create({ data: { coachId, tagId: tag.id } });
  }
}

// 미리보기 문구. 무엇을 기준으로 연결됐는지(사번/No ID/이름)와 이름 차이를 운영자가 볼 수 있게 남긴다.
function describeDryRun(matched: CoachMatch, record: NotionCoachRecord): string {
  const existing = matched.coach;
  if (!existing) return record.employeeNo === null ? "신규 코치 (사번 없음)" : `신규 코치 (사번 ${record.employeeNo})`;

  const parts: string[] = [];
  if (matched.by === "employeeNo") parts.push(`사번 ${record.employeeNo}로 연결`);
  else if (matched.by === "notionNo") parts.push(`No ID ${record.notionNo}로 연결`);
  else if (record.employeeNo !== null) parts.push(`사번 ${record.employeeNo} 연결(이름으로 찾은 예전 행)`);
  else if (record.notionNo !== null) parts.push(`No ID ${record.notionNo} 연결(이름으로 찾은 예전 행)`);
  else parts.push("이름으로 연결 (노션에 사번 없음)");

  if (existing.name !== record.name) {
    parts.push(`노션 이름 ${existing.name} → ${record.name} (사이트 이름은 유지)`);
  }

  const diffs = diffRecord(existing, record);
  parts.push(diffs.length > 0 ? diffs.join(", ") : "변경 없음");
  return parts.join(" / ");
}

function diffRecord(existing: ExistingCoach, record: NotionCoachRecord): string[] {
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
