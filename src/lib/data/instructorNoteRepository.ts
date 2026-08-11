// 강사위키 강사별 메모 저장소 계약.
// 로컬(dev)은 .local 파일, 배포는 PostgreSQL을 쓰지만 화면은 이 인터페이스만 본다.

// 노션 강사 DB에서 긁어온 스냅샷. 자동 채움 값이라 OM이 직접 입력한 값과 섞지 않고 따로 둔다.
// (섞으면 다음 번 가져오기 때 OM이 고친 내용이 덮인다.) 화면에서는 OM 입력값이 우선.
// 계좌·사업자등록증·신분증은 가져오지 않는다. 생년월일만 계약 날인용으로 포함.
export interface InstructorNotionProfile {
  syncedAt?: string;        // 가져온 시각(ISO) — 화면에 "언제 기준 값인지" 표시용
  contact?: string;         // 연락처
  contact2?: string;        // 연락처2
  email?: string;
  email2?: string;
  affiliation?: string;     // 소속정보
  categories?: string[];    // 카테고리 → 전문분야
  lectureTopics?: string[]; // 담당 강의 정보
  baseFee?: number;         // 기본 강사료
  feeNote?: string;         // 강사료 특이사항
  memo?: string;            // 메모
  recruitAvoid?: boolean;   // 섭외지양 여부
  birthDate?: string;       // 생년월일
  demoCheckUrl?: string;    // 시범강의 점검표
}

export interface InstructorNote {
  displayName?: string;   // 강사명 수정값
  notionId?: string;      // 노션 강사 페이지 고유 ID(또는 전체 URL) — 연결값
  partnerId?: string;
  notes?: string;         // 강사 특이사항
  recruitAvoid?: boolean; // 섭외 지양
  contact?: string;       // 연락처
  email?: string;
  notion?: InstructorNotionProfile; // 노션 자동 채움값(읽기 전용)
}

export interface InstructorNoteRepository {
  getNote(name: string): Promise<InstructorNote>;
  getAllNotes(): Promise<Record<string, InstructorNote>>;
  /** 보낸 필드만 병합 저장한다. 섭외지양 토글·폼 저장이 각각 일부만 보내기 때문. */
  saveNote(name: string, patch: InstructorNote): Promise<InstructorNote>;
}
