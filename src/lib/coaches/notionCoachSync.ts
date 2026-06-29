import { CoachStatus, type Prisma } from "@prisma/client";
import { generateCoachAccessToken, normalizeCoachName } from "./accessToken";
import { parseBirthDate } from "./dateParse";
import type { SyncResult } from "./syncTypes";
import { emptySyncResult } from "./syncTypes";
import { normalizeWorkTypeString } from "./workType";
import { getPrismaClient } from "@/lib/data/prisma";

const NOTION_VERSION = "2022-06-28";
const EXCLUDED_TYPE_TAGS = new Set(["기존", "신규", "취소"]);

type JsonObject = Record<string, unknown>;

interface NotionCoachRecord {
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: Date | null;
  affiliation: string | null;
  workType: string | null;
  fields: string[];
  curriculums: string[];
  portfolioUrl: string | null;
  selfNote: string | null;
  availabilityDetail: string | null;
}

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

    const existing = await prisma.coach.findFirst({
      where: { normalizedName: normalizeCoachName(record.name) },
      include: {
        privateProfile: true,
        fields: { include: { tag: true } },
        curriculums: { include: { tag: true } }
      }
    });

    if (dryRun) {
      const details = existing ? diffRecord(existing, record).join(", ") || "변경 없음" : "신규 코치";
      result.changes?.push({ coachName: record.name, action: existing ? "update_notion" : "create_notion", details });
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
          sourceCoachId: `notion:${normalizeCoachName(record.name)}`,
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

function mapPageToCoachRecord(page: JsonObject): NotionCoachRecord | null {
  const properties = isObject(page.properties) ? page.properties : {};
  const name = getText(properties["이름"]);
  if (!name) return null;

  const wtValues = normalizeTypeTags([
    ...parseTypeTags(properties["근무 유형"]),
    ...parseTypeTags(properties["근무유형"]),
    ...parseTypeTags(properties["유형"])
  ]);
  const period = getText(properties["근무 가능 기간"]);
  const detail = getText(properties["근무 가능 세부 내용"]);
  const availabilityParts = [period ? `근무 가능 기간: ${period}` : "", detail].filter(Boolean);

  return {
    name,
    phone: getText(properties["연락처"]) || null,
    email: getText(properties["이메일"]) || null,
    birthDate: parseBirthDate(getText(properties["생년월일"])),
    affiliation: getText(properties["소속"]) || null,
    workType: normalizeWorkTypeString(wtValues.join(", ")),
    fields: unique([...getMultiSelect(properties["교육 및 가능 분야"]), ...getMultiSelect(properties["전문 분야"])]),
    curriculums: unique(getMultiSelect(properties["가능 커리큘럼"])),
    portfolioUrl: getText(properties["이력서 및 포트폴리오"]) || null,
    selfNote: sanitizeHistoryNote(getText(properties[" 특이사항 / 히스토리"]) || getText(properties["특이사항 / 히스토리"])) || null,
    availabilityDetail: availabilityParts.join("\n") || null
  };
}

function publicCoachUpdate(record: NotionCoachRecord) {
  return {
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

function diffRecord(
  existing: Prisma.CoachGetPayload<{
    include: { privateProfile: true; fields: { include: { tag: true } }; curriculums: { include: { tag: true } } };
  }>,
  record: NotionCoachRecord
): string[] {
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

function getText(prop: unknown): string {
  if (!isObject(prop)) return "";
  if (prop.type === "title" && Array.isArray(prop.title)) return richTextToPlain(prop.title);
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) return richTextToPlain(prop.rich_text);
  if (prop.type === "multi_select" && Array.isArray(prop.multi_select)) {
    return prop.multi_select.map((item) => (isObject(item) && typeof item.name === "string" ? item.name : "")).filter(Boolean).join(", ");
  }
  if (prop.type === "select" && isObject(prop.select) && typeof prop.select.name === "string") return prop.select.name;
  if (prop.type === "date" && isObject(prop.date) && typeof prop.date.start === "string") return prop.date.start;
  if (prop.type === "url" && typeof prop.url === "string") return prop.url;
  if (prop.type === "email" && typeof prop.email === "string") return prop.email;
  if (prop.type === "phone_number" && typeof prop.phone_number === "string") return prop.phone_number;
  return "";
}

function getMultiSelect(prop: unknown): string[] {
  if (!isObject(prop) || prop.type !== "multi_select" || !Array.isArray(prop.multi_select)) return [];
  return prop.multi_select
    .map((item) => (isObject(item) && typeof item.name === "string" ? item.name.trim() : ""))
    .filter(Boolean);
}

function parseTypeTags(prop: unknown): string[] {
  if (isObject(prop) && prop.type === "multi_select") return getMultiSelect(prop);
  return getText(prop).split(/[,/\n]/).map((value) => value.trim()).filter(Boolean);
}

function normalizeTypeTags(values: string[]): string[] {
  return unique(values.filter((value) => !EXCLUDED_TYPE_TAGS.has(value.trim())));
}

function sanitizeHistoryNote(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/삼전\s*전용으로.*$/g, "").trim())
    .filter(Boolean)
    .filter((line) => !/컨택\s*가능/.test(line) && !/일정에\s*한해/.test(line) && !/일정을\s*받고/.test(line))
    .join("\n");
}

function richTextToPlain(items: unknown[]): string {
  return items.map((item) => (isObject(item) && typeof item.plain_text === "string" ? item.plain_text : "")).join("");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
