**동일 문서·동일 NO 경쟁은 기존 transaction과 unique retry로 처리할 수 있지만, 이름 기준 신규 생성 경쟁까지 막지는 못합니다.** 코드 기준 판단이며 실행 검증은 하지 않았습니다.

1. **같은 NO가 아직 없음**
   - sync S와 manual M이 모두 NO=10 없음 확인.
   - M이 먼저 생성·commit.
   - S의 insert는 NO unique 충돌 → 새 transaction에서 NO=10 재조회 → M의 수동값을 보존하며 갱신.
   - **새 guard 불필요.** 단, `applyMapped`가 매 retry마다 재매칭해야 합니다.

2. **동일 legacy 행을 서로 다른 NO가 선택**
   - S1(NO=10), S2(NO=20)가 같은 `L(notionNo=null)` 조회.
   - S1이 L을 NO=10으로 변경·commit.
   - S2는 같은 문서 쓰기 충돌 → 재조회하면 L은 legacy 후보에서 제외 → NO=20 신규 생성.
   - **전체 재매칭이면 안전.** 기존 `findMatch`의 L 또는 ID를 retry 바깥에서 재사용하면, 새 snapshot에서 L을 NO=20으로 덮어 NO=10 연결을 지우는 반례가 생깁니다.

3. **manual 값과 full-row replace**
   - S가 `notes=A` 읽음 → M이 `notes=B` 저장·commit → S가 이전 full row로 replace 시도.
   - 같은 snapshot의 쓰기라면 충돌하고, retry에서 B를 다시 읽어 보존합니다.
   - 그러나 **이전 row/완성 document를 callback 밖에 보관하면**, retry 후에도 A로 덮을 수 있습니다. `previous`, recruitAvoid OR 계산, 저장 document, 감사 diff 모두 callback 안에서 다시 만들어야 합니다. [현재 save/retry 구조](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoInstructorNoteRepository.ts:74)

4. **남는 반례: 같은 이름을 양쪽이 처음 생성**
   - 이름 X 행 없음.
   - S는 NO=10·legacy 모두 없음 확인.
   - M의 `saveNote(X)`도 없음 확인.
   - S는 `(X,10)`, M은 `(X,null)`을 서로 다른 ID로 생성 → **둘 다 commit 가능**.
   - 문서 충돌도 NO unique 충돌도 없습니다. 수동값은 null 행에 남고 sync 행에는 연결되지 않습니다. **기존 transaction만으로 방지 불가**이며, PG에도 같은 신규 생성 한계가 있습니다. 이름이 비고유인 현재 계약에서 이를 막겠다는 보장은 제외해야 합니다.

5. **명시적으로 제출된 profile·recruitAvoid는 retry로 보호되지 않음**
   - M이 이전 profile=P0을 가진 patch 준비 → S가 P1 저장 → M이 retry 후에도 명시 patch P0 저장.
   - 최종 P0은 stale full-row 유실이 아니라 **겹치는 필드의 후행 명시 쓰기**입니다. `patch.notion`을 받는 현재 manual 계약상 가능합니다.
   - 마찬가지로 S가 recruitAvoid=true 저장 후 M이 false를 명시 저장하면 false가 됩니다. sync의 OR는 **sync 적용 시점의 보존**이지 전 writer에 대한 영구 true 보장이 아닙니다.

6. **PG 원본은 더 약한 경쟁 보장**
   - S가 recruitAvoid=false 조회 → M이 true 저장 → S가 이전 false로 계산한 OR 결과 false 저장: true 유실 가능.
   - 두 sync가 동일 legacy를 서로 다른 NO로 조회한 뒤 ID update하면 후행 NO가 선행 연결을 덮을 수 있습니다.
   - 반면 수동 3필드는 원본 sync update에 포함되지 않아 보존됩니다. [PG 원본](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/instructors/notionInstructorSync.ts:48)

별도로 기존 retry는 **attempt마다 30초를 재설정**합니다. 이를 그대로 재사용하면 전체 30초 제한은 충족하지 않습니다. 파일 수정·DB 접근은 없었습니다.
