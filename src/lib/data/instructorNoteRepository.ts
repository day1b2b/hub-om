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
  /**
   * 노션 강사 DB의 ID(화면상 "NO"). 노션↔사이트를 잇는 키다.
   * 강사명은 노션에서 바뀌고 동명이인도 있어 키로 쓸 수 없다(예: 김준범 NO=185 / NO=746).
   * 노션에 없는 강사(운영현황 표기만 있는 경우)는 undefined이며 그때만 이름으로 식별한다.
   */
  notionNo?: number;
  /** 노션에서 온 강사명. 동명이인이 각각 한 행을 가지므로 고유하지 않다. */
  instructorName?: string;
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
  /** 이름으로 조회. 노션에 없는 강사(운영현황 표기)나 예전 경로용. 동명이인은 첫 행이 나온다. */
  getNote(name: string): Promise<InstructorNote>;
  /** 노션 NO로 조회. 동명이인까지 정확히 구분되는 정식 경로다. */
  getNoteByNotionNo(notionNo: number): Promise<InstructorNote>;
  /**
   * 전체 노트를 배열로 돌려준다.
   * 이름 키 Record였을 때는 동명이인 두 행 중 하나가 사라졌다. 배열이어야 둘 다 보인다.
   */
  listNotes(): Promise<InstructorNote[]>;
  /** 보낸 필드만 병합 저장한다. 섭외지양 토글·폼 저장이 각각 일부만 보내기 때문. */
  saveNote(name: string, patch: InstructorNote): Promise<InstructorNote>;
  /** 노션 NO 기준 병합 저장. 동기화와 NO 기반 화면이 쓴다. */
  saveNoteByNotionNo(notionNo: number, patch: InstructorNote): Promise<InstructorNote>;
}
