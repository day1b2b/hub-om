// 강사위키 값을 DB(instructor_notes)에 넣기 전에 개인정보를 걷어낸다.
//
// 로컬(dev)의 .local 파일에는 연락처·이메일·생년월일이 그대로 남는다. 그 파일은 gitignore이고
// 정선님 PC에만 있다. 반면 DB는 배포 환경에서 여러 사람이 접근하므로 개인정보를 두지 않는다.
// 배포 화면에서 연락처·이메일·생년월일 칸은 "—"로 비어 보이는 것이 의도된 동작이다.
//
// 자유 입력란(강사 특이사항·노션 메모·강사료 특이사항)에도 소속사 담당자 연락처 같은 값이
// 섞여 들어오므로 전화번호·이메일 패턴을 찾아 가린다. 원문은 노션과 로컬 파일에 남는다.
import type { InstructorNote, InstructorNotionProfile } from "./instructorNoteRepository";

const PHONE = /\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** 자유 텍스트에서 전화번호·이메일을 가린다. 문장 흐름은 그대로 둔다. */
export function redactFreeText(value: string | undefined): string | undefined {
  if (!value) return value;
  const redacted = value.replace(PHONE, "[연락처 비공개]").replace(EMAIL, "[이메일 비공개]");
  return redacted.trim() || undefined;
}

/** 노션 스냅샷에서 개인정보 항목을 빼고 자유 텍스트를 가린다. */
export function stripPiiFromNotionProfile(
  profile: InstructorNotionProfile | undefined
): InstructorNotionProfile | undefined {
  if (!profile) return undefined;

  // contact/contact2/email/email2/birthDate는 의도적으로 옮기지 않는다.
  const safe: InstructorNotionProfile = {
    syncedAt: profile.syncedAt,
    affiliation: profile.affiliation,
    categories: profile.categories,
    lectureTopics: profile.lectureTopics,
    baseFee: profile.baseFee,
    feeNote: redactFreeText(profile.feeNote),
    memo: redactFreeText(profile.memo),
    recruitAvoid: profile.recruitAvoid,
    demoCheckUrl: profile.demoCheckUrl
  };

  for (const key of Object.keys(safe) as (keyof InstructorNotionProfile)[]) {
    if (safe[key] === undefined) delete safe[key];
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** DB에 저장해도 되는 필드만 남긴다. 연락처·이메일은 컬럼 자체가 없다. */
export function stripPiiFromNote(note: InstructorNote): InstructorNote {
  const safe: InstructorNote = {};
  // 연결 키(노션 NO)와 이름은 개인정보가 아니라 식별값이라 그대로 넘긴다.
  // 허용 목록 방식이라 여기 빠지면 저장 단계에서 조용히 사라진다.
  if (note.notionNo !== undefined) safe.notionNo = note.notionNo;
  if (note.instructorName !== undefined) safe.instructorName = note.instructorName;
  if (note.displayName !== undefined) safe.displayName = note.displayName;
  if (note.notionId !== undefined) safe.notionId = note.notionId;
  if (note.partnerId !== undefined) safe.partnerId = note.partnerId;
  if (note.notes !== undefined) safe.notes = redactFreeText(note.notes) ?? "";
  if (note.recruitAvoid !== undefined) safe.recruitAvoid = note.recruitAvoid;
  if (note.notion !== undefined) safe.notion = stripPiiFromNotionProfile(note.notion);
  return safe;
}
