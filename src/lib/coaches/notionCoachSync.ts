// 노션 코치 DB → coaches 동기화 (서버 실행). 매핑은 notionCoachMap이 담당한다.
//
// 연결 키는 노션 코치 DB의 ID(auto increment, 강사 DB와 같은 방식)다. 이름은 노션에서 바뀔 수 있고
// 동명이인도 있어 키로 쓸 수 없다. ID는 모든 행에 자동으로 붙으므로(2026-09-04 66행 전부 확인)
// 이름으로 찾는 경로는 아직 ID가 안 붙은 기존 코치 행을 이어 붙일 때만 쓴다.
//
// 사번은 키로 쓰지 않고 값으로만 담는다. 계약시트도 같은 사번을 쓰므로 나중에 원천을 이어 붙일 때 필요하다.
//
// 노션에 같은 사람이 두 행으로 등록된 경우(이름·연락처·생년월일 동일)는 이전 행(사번 있는 원본) ID를
// 기준으로 두고 한 코치에 합친다. 자세한 규칙은 findCoach 주석에 있다.
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

    // 한 행이 실패해도 나머지는 계속 넣는다(강사 동기화와 같은 방식). 사번·ID unique 충돌처럼
    // 노션 데이터 문제로 한 건이 막힐 때 동기화 전체가 죽으면 원인을 찾기 어렵다.
    try {
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
        // 노션 중복 행은 이전 행 값을 덮지 않는다. 어느 행이 먼저 처리되느냐에 따라 결과가 달라지면
        // 안 되고, 기준은 이전 행(사번 있는 원본)이기 때문이다. 빈 칸만 채운다.
        const isDuplicateRow = matched.by === "duplicateRow";
        await prisma.$transaction(async (tx) => {
          await tx.coach.update({
            where: { id: existing.id },
            data: isDuplicateRow ? fillEmptyCoachUpdate(existing, record) : publicCoachUpdate(record)
          });
          await upsertPrivateProfile(tx, existing.id, record, isDuplicateRow ? existing.privateProfile : null);
          if (record.fields.length > 0 && !(isDuplicateRow && existing.fields.length > 0)) {
            await replaceFields(tx, existing.id, record.fields);
          }
          if (record.curriculums.length > 0 && !(isDuplicateRow && existing.curriculums.length > 0)) {
            await replaceCurriculums(tx, existing.id, record.curriculums);
          }
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
        await upsertPrivateProfile(tx, coach.id, record, null);
        if (record.fields.length > 0) await replaceFields(tx, coach.id, record.fields);
        if (record.curriculums.length > 0) await replaceCurriculums(tx, coach.id, record.curriculums);
      });
      result.created++;
    } catch (error) {
      result.errors++;
      result.errorDetail.push(
        `ID ${record.notionNo ?? "없음"} ${record.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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

interface CoachMatch {
  coach: ExistingCoach | null;
  // notionNo: ID로 찾음 / name: 아직 ID가 안 붙은 동명 행에 이어 붙임 /
  // duplicateRow: 노션에 같은 사람이 두 번 등록된 행이라 먼저 붙은 코치에 합침
  by: "notionNo" | "name" | "duplicateRow";
  // 못 찾았지만 같은 이름의 코치가 이미 있는 경우(동명이인으로 보고 새로 만든다).
  sameNameExists: boolean;
}

/**
 * 코치 1명을 찾는다. 노션 ID → 아직 ID 없는 동명 행 → 노션 중복 행 순서다.
 *
 * ID로 못 찾았을 때 이름으로 한 번 더 찾는 이유는 backfill이다. 기존 코치 행에는 아직 ID가 없으므로
 * 첫 동기화가 이름으로 찾아 ID를 채운다(별도 스크립트가 필요 없다). 이때 "아직 ID가 안 붙은 행"만
 * 보는 이유는, 이미 다른 ID가 붙은 행을 가져오면 남의 코치를 덮어쓰기 때문이다.
 *
 * 마지막 단계는 노션 자체의 중복 행 처리다. 노션 코치 DB에는 같은 사람이 두 행으로 등록된 경우가
 * 있다(2026-09-04 확인: 5쌍. 8/11 원본 + 8/19 재등록, 쌍마다 연락처·생년월일이 동일). ID로는 서로
 * 다른 사람이라 그대로 두면 코치가 2건 생기므로, 이름이 같고 연락처 또는 생년월일까지 같으면 같은
 * 사람으로 보고 먼저 붙은 코치(사번이 있는 이전 행)에 합친다. 연락처가 다르면 진짜 동명이인이라
 * 새 코치로 만든다.
 */
async function findCoach(
  prisma: ReturnType<typeof getPrismaClient>,
  record: NotionCoachRecord
): Promise<CoachMatch> {
  if (record.notionNo !== null) {
    const coach = await prisma.coach.findFirst({ where: { notionNo: record.notionNo }, include: COACH_INCLUDE });
    if (coach) return { coach, by: "notionNo", sameNameExists: false };
  }

  const normalizedName = normalizeCoachName(record.name);
  const unkeyed = await prisma.coach.findFirst({
    where: {
      normalizedName,
      ...(record.notionNo !== null ? { notionNo: null } : {})
    },
    include: COACH_INCLUDE,
    orderBy: { createdAt: "asc" }
  });
  if (unkeyed) return { coach: unkeyed, by: "name", sameNameExists: true };

  const identityFilters = [
    ...(record.phone ? [{ phone: record.phone }] : []),
    ...(record.birthDate ? [{ birthDate: record.birthDate }] : [])
  ];
  if (identityFilters.length > 0) {
    const duplicate = await prisma.coach.findFirst({
      where: { normalizedName, privateProfile: { is: { OR: identityFilters } } },
      include: COACH_INCLUDE,
      orderBy: { createdAt: "asc" }
    });
    if (duplicate) return { coach: duplicate, by: "duplicateRow", sameNameExists: true };
  }

  const sameNameExists = (await prisma.coach.count({ where: { normalizedName } })) > 0;
  return { coach: null, by: "name", sameNameExists };
}

// 새로 만드는 코치의 sourceCoachId. ID가 있으면 이름이 바뀌어도 안 흔들리는 ID를 쓴다.
function newSourceCoachId(record: NotionCoachRecord): string {
  return record.notionNo === null ? `notion:${normalizeCoachName(record.name)}` : `notion:no-${record.notionNo}`;
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

// current를 주면(노션 중복 행) 이미 값이 있는 항목은 그대로 두고 빈 항목만 채운다.
async function upsertPrivateProfile(
  tx: Prisma.TransactionClient,
  coachId: string,
  record: NotionCoachRecord,
  current: ExistingCoach["privateProfile"] | null
) {
  const fillEmptyOnly = current !== null;
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
      ...(record.phone && !(fillEmptyOnly && current?.phone) ? { phone: record.phone } : {}),
      ...(record.email && !(fillEmptyOnly && current?.email) ? { email: record.email } : {}),
      ...(record.birthDate && !(fillEmptyOnly && current?.birthDate) ? { birthDate: record.birthDate } : {}),
      ...(record.affiliation && !(fillEmptyOnly && current?.affiliation) ? { affiliation: record.affiliation } : {})
    }
  });
}

/**
 * 노션 중복 행이 들어올 때의 코치 갱신 값. 연결 키(notionNo)는 이전 행 ID를 유지하려고 아예 넣지
 * 않고, 나머지는 코치에 값이 없을 때만 채운다.
 */
function fillEmptyCoachUpdate(coach: ExistingCoach, record: NotionCoachRecord) {
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
