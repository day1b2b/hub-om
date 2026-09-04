// 노션 코치 DB → coaches 동기화 (서버 실행). 매핑은 notionCoachMap이 담당한다.
//
// 연결 키는 노션 코치 DB의 "No ID"(auto increment, 예: CH-51)다. 이름은 노션에서 바뀔 수 있고
// 동명이인도 있어 키로 쓸 수 없다. 노션 행에 No ID가 없을 때만 이름으로 찾는다.
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

    // 1순위: No ID로 찾는다.
    const matchedByNo =
      record.notionNo === null
        ? null
        : await prisma.coach.findFirst({ where: { notionNo: record.notionNo }, include: COACH_INCLUDE });

    // 2순위: No ID가 아직 안 붙은 행을 이름으로 찾아 이어 붙인다.
    // 이렇게 첫 동기화가 스스로 backfill 하므로 별도 스크립트가 필요 없다.
    // 노션 행에 No ID가 아예 없으면(예전 방식) 계속 이름으로만 찾는다.
    const matchedByName = matchedByNo
      ? null
      : await prisma.coach.findFirst({
          where: { normalizedName: normalizeCoachName(record.name), notionNo: null },
          include: COACH_INCLUDE
        });

    const existing = matchedByNo ?? matchedByName;

    if (dryRun) {
      result.changes?.push({
        coachName: record.name,
        action: existing ? "update_notion" : "create_notion",
        details: describeDryRun(existing, matchedByNo !== null, record)
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

// 새로 만드는 코치의 sourceCoachId. No ID가 있으면 이름이 바뀌어도 안 흔들리는 No ID를 쓴다.
function newSourceCoachId(record: NotionCoachRecord): string {
  return record.notionNo === null ? `notion:${normalizeCoachName(record.name)}` : `notion:no-${record.notionNo}`;
}

function publicCoachUpdate(record: NotionCoachRecord) {
  // 이름(name·normalizedName)은 노션 값으로 덮지 않는다. 계약시트 동기화가 코치를 이름으로 찾기 때문에
  // 여기서 이름을 바꾸면 시트 쪽에서 같은 사람을 새 코치로 또 만든다. 이름 차이는 미리보기에만 표시한다.
  return {
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
      employeeId: null,
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

// 미리보기 문구. 무엇을 기준으로 연결됐는지(No ID/이름)와 이름 차이를 운영자가 볼 수 있게 남긴다.
function describeDryRun(existing: ExistingCoach | null, matchedByNo: boolean, record: NotionCoachRecord): string {
  if (!existing) return record.notionNo === null ? "신규 코치" : `신규 코치 (No ID ${record.notionNo})`;

  const parts: string[] = [];
  if (matchedByNo) parts.push(`No ID ${record.notionNo}로 연결`);
  else if (record.notionNo !== null) parts.push(`No ID ${record.notionNo} 연결(예전 행)`);
  else parts.push("이름으로 연결 (노션에 No ID 없음)");

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
