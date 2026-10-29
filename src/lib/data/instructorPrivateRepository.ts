// 강사 민감(PII) 전용 repository. 연락처·이메일·생년월일만 다룬다.
// 권한 게이팅 + 감사는 호출부(piiReveal) 책임이다. 코치 CoachPrivateRepository 미러.
// 공개 타입/화면에 노출 금지.
export interface InstructorPrivateProfileView {
  instructorNoteId: string;
  contact: string | null;
  contact2: string | null;
  email: string | null;
  email2: string | null;
  birthDate: string | null;
}

export interface InstructorPrivateRepository {
  getPrivateProfile(instructorNoteId: string): Promise<InstructorPrivateProfileView | null>;
}
