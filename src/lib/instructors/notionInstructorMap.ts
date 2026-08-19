// 노션 강사 페이지 → InstructorNote 매핑 (순수 함수, IO 없음).
// 노션 API/DB/인증에 의존하지 않으므로 단위 테스트가 쉽다. 동기화(fetch·DB)는 notionInstructorSync가 담당.
//
// 개인정보(연락처·이메일·생년월일)는 여기서 담되 마지막에 stripPiiFromNote가 걷어내 DB에는 넣지 않는다.
import type { InstructorNote, InstructorNotionProfile } from "@/lib/data/instructorNoteRepository";
import { stripPiiFromNote } from "@/lib/data/instructorNotePii";

export type JsonObject = Record<string, unknown>;

// 노션 강사 페이지 1건 → { 강사명, InstructorNote }. 이름 없으면 null(건너뜀).
export function mapPageToInstructor(page: JsonObject): { name: string; note: InstructorNote } | null {
  const properties = isObject(page.properties) ? page.properties : {};
  const name = getText(properties["강사명"]).trim();
  if (!name) return null;

  const categories = getMultiSelect(properties["카테고리"]);
  const lectureTopics = getMultiSelect(properties["담당 강의 정보"]);

  const profile: InstructorNotionProfile = {
    syncedAt: nowIso(),
    affiliation: emptyToUndef(getText(properties["소속정보"])),
    categories: categories.length > 0 ? categories : undefined,
    lectureTopics: lectureTopics.length > 0 ? lectureTopics : undefined,
    baseFee: getNumber(properties["기본 강사료"]),
    feeNote: emptyToUndef(getText(properties["강사료 특이사항"])),
    memo: emptyToUndef(getText(properties["메모"])),
    recruitAvoid: readRecruitAvoid(properties["섭외지양 여부"]),
    birthDate: emptyToUndef(getText(properties["생년월일"])),
    demoCheckUrl: emptyToUndef(getUrlOrFile(properties["시범강의 점검표"])),
    // PII — stripPiiFromNotionProfile에서 제거된다. 원천 규칙을 명시적으로 남긴다.
    contact: emptyToUndef(getText(properties["연락처"])),
    contact2: emptyToUndef(getText(properties["연락처2"])),
    email: emptyToUndef(getText(properties["이메일 주소"])),
    email2: emptyToUndef(getText(properties["이메일 주소 (2)"]))
  };
  for (const key of Object.keys(profile) as (keyof InstructorNotionProfile)[]) {
    if (profile[key] === undefined) delete profile[key];
  }

  const note: InstructorNote = {
    notionId: typeof page.id === "string" ? page.id.replace(/-/g, "") : undefined,
    recruitAvoid: profile.recruitAvoid === true,
    notion: profile
  };

  return { name, note: stripPiiFromNote(note) };
}

// ---- 노션 속성 파서 (코치 동기화와 동일 규칙 + 강사 DB용 보강) --------------------

function getText(prop: unknown): string {
  if (!isObject(prop)) return "";
  if (prop.type === "title" && Array.isArray(prop.title)) return richTextToPlain(prop.title);
  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) return richTextToPlain(prop.rich_text);
  if (prop.type === "multi_select" && Array.isArray(prop.multi_select)) {
    return prop.multi_select
      .map((item) => (isObject(item) && typeof item.name === "string" ? item.name : ""))
      .filter(Boolean)
      .join(", ");
  }
  if (prop.type === "select" && isObject(prop.select) && typeof prop.select.name === "string") return prop.select.name;
  if (prop.type === "status" && isObject(prop.status) && typeof prop.status.name === "string") return prop.status.name;
  if (prop.type === "date" && isObject(prop.date) && typeof prop.date.start === "string") return prop.date.start;
  if (prop.type === "url" && typeof prop.url === "string") return prop.url;
  if (prop.type === "email" && typeof prop.email === "string") return prop.email;
  if (prop.type === "phone_number" && typeof prop.phone_number === "string") return prop.phone_number;
  if (prop.type === "number" && typeof prop.number === "number") return String(prop.number);
  return "";
}

function getMultiSelect(prop: unknown): string[] {
  if (!isObject(prop) || prop.type !== "multi_select" || !Array.isArray(prop.multi_select)) return [];
  return prop.multi_select
    .map((item) => (isObject(item) && typeof item.name === "string" ? item.name.trim() : ""))
    .filter(Boolean);
}

function getNumber(prop: unknown): number | undefined {
  if (isObject(prop) && prop.type === "number" && typeof prop.number === "number") return prop.number;
  return undefined;
}

function getUrlOrFile(prop: unknown): string {
  if (!isObject(prop)) return "";
  if (prop.type === "url" && typeof prop.url === "string") return prop.url;
  if (prop.type === "files" && Array.isArray(prop.files)) {
    for (const file of prop.files) {
      if (!isObject(file)) continue;
      if (isObject(file.external) && typeof file.external.url === "string") return file.external.url;
      if (isObject(file.file) && typeof file.file.url === "string") return file.file.url;
    }
  }
  return "";
}

// 섭외지양: 체크박스면 그대로, 아니면 텍스트에 "지양"/O/Y/예 등이 있으면 true.
function readRecruitAvoid(prop: unknown): boolean {
  if (isObject(prop) && prop.type === "checkbox") return prop.checkbox === true;
  const value = getText(prop).trim().toLowerCase();
  if (!value) return false;
  return value.includes("지양") || ["o", "y", "예", "yes", "true"].includes(value);
}

function richTextToPlain(items: unknown[]): string {
  return items.map((item) => (isObject(item) && typeof item.plain_text === "string" ? item.plain_text : "")).join("");
}

function emptyToUndef(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
