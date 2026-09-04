// 노션 코치 페이지 → 코치 레코드 매핑 (순수 함수, IO 없음).
// 노션 API/DB/인증에 의존하지 않으므로 단위 테스트가 쉽다. 동기화(fetch·DB)는 notionCoachSync가 담당한다.
// 강사 쪽(notionInstructorMap)과 같은 구조다.
import { parseBirthDate } from "./dateParse";
import { normalizeWorkTypeString } from "./workType";

export type JsonObject = Record<string, unknown>;

const EXCLUDED_TYPE_TAGS = new Set(["기존", "신규", "취소"]);

// 노션 코치 DB의 사번을 담은 속성 후보. 연결 키는 아니고 값으로만 담는다.
// 계약시트(조교실습코치_일반계약요청)도 같은 사번을 쓰므로 나중에 원천을 이어 붙일 때 필요하다.
const EMPLOYEE_NO_PROPERTY_NAMES = ["사번", "사원번호"];

// 노션 코치 DB의 auto increment ID를 담은 속성 후보. 연결 키다(강사 DB와 같은 방식).
// 2026-09-04 연동 DB에 "ID" 속성을 만들어 66행 전부 값이 붙었다(225~290).
// 운영자가 화면에서 속성 이름을 바꿔도 끊기지 않게 후보를 두고, 그래도 못 찾으면
// unique_id 타입 속성을 찾아 쓴다.
const NOTION_NO_PROPERTY_NAMES = ["No ID", "ID", "NO", "No"];

export interface NotionCoachRecord {
  name: string;
  // 노션 코치 DB의 사번. 연결 키는 아니고 값으로만 담는다(계약시트와 같은 값).
  // 발급 전인 행("0"·공란)은 null이다.
  employeeNo: string | null;
  // 노션 코치 DB의 ID(auto increment, 화면상 "No ID"). 노션↔사이트 연결 키다.
  // 이름은 노션에서 바뀔 수 있고 동명이인도 있어 키로 쓸 수 없다.
  // 노션 행에 ID가 없으면 null이며, 그 경우에만 이름으로 식별한다.
  notionNo: number | null;
  notionPageId: string | null;
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

// 노션 코치 페이지 1건 → 코치 레코드. 이름이 없으면 null(건너뜀).
export function mapPageToCoachRecord(page: JsonObject): NotionCoachRecord | null {
  const properties = isObject(page.properties) ? page.properties : {};
  const name = getText(properties["이름"]).trim();
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
    employeeNo: readEmployeeNo(properties),
    notionNo: readNotionNo(properties),
    notionPageId: typeof page.id === "string" ? page.id : null,
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

/**
 * 사번. 노션에서는 number 타입이라 91000176처럼 온다. 문자열로 담는다.
 * 0과 공란은 "아직 발급 안 됨"이라 값이 없는 것으로 본다(2026-09-04 확인: 66행 중 15행이 이 상태).
 * "91000176-2"(재계약 차수)·"91000176 (취소)" 같은 표기는 계약시트와 같은 규칙으로 정리한다.
 */
export function readEmployeeNo(properties: JsonObject): string | null {
  for (const key of EMPLOYEE_NO_PROPERTY_NAMES) {
    const prop = properties[key];
    if (!isObject(prop)) continue;
    if (prop.type === "number") {
      const value = prop.number;
      if (typeof value === "number" && value > 0) return String(value);
      continue;
    }
    const digits = getText(prop).replace(/\(.*?\)/g, "").trim().replace(/-\d+$/, "").trim();
    if (/^\d+$/.test(digits) && Number(digits) > 0) return digits;
  }
  return null;
}

/**
 * 노션 auto increment ID. API에서는 unique_id 타입으로 { prefix, number } 형태로 온다.
 * 강사 DB처럼 접두어 없이 숫자만 쓴다(접두어가 붙어도 숫자만 연결 키로 본다).
 */
export function readNotionNo(properties: JsonObject): number | null {
  for (const key of NOTION_NO_PROPERTY_NAMES) {
    const value = getUniqueIdNumber(properties[key]);
    if (value !== null) return value;
  }
  // 속성 이름이 바뀐 경우를 위한 마지막 수단: unique_id 타입 속성을 찾는다.
  for (const prop of Object.values(properties)) {
    const value = getUniqueIdNumber(prop);
    if (value !== null) return value;
  }
  return null;
}

function getUniqueIdNumber(prop: unknown): number | null {
  if (!isObject(prop) || prop.type !== "unique_id" || !isObject(prop.unique_id)) return null;
  const value = prop.unique_id.number;
  return typeof value === "number" ? value : null;
}

// ---- 노션 속성 파서 -------------------------------------------------------

export function getText(prop: unknown): string {
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

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
