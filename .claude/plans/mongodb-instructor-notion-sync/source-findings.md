`3dfa025` 기준 조사 완료했습니다. **핵심은 NO 우선 연결, 행별 부분 성공, 수동 필드 보존입니다. 기존 Mongo writer에는 별도 동기화 guard가 없습니다.** 파일 수정·실원천·DB 접속은 하지 않았습니다.

1. **동기화는 전체 원자 작업이 아닙니다.**
   - Notion 페이지를 전부 받은 뒤 원천 순서대로 처리합니다. 정렬·중복 제거·누락된 강사 삭제는 없습니다.
   - 각 행의 DB 오류는 `errors/errorDetail`에 누적하고 다음 행을 계속 처리합니다. 앞선 성공은 유지됩니다.
   - 매핑은 행별 `try` 밖에 있습니다. 설정·fetch·매핑·초기 Prisma 획득 오류는 전체 요청 실패 경로입니다.
   - 동일 NO가 반복되면 apply는 앞 행의 저장 결과를 보지만 dry-run은 가상 저장하지 않습니다. 따라서 **dry-run과 apply의 created/updated 수가 달라도 기존 동작**입니다.
   [notionInstructorSync.ts:29](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/instructors/notionInstructorSync.ts:29)

2. **선택·갱신 규칙을 일반 수동 save로 대체하면 안 됩니다.**
   - `notionNo` 일치가 최우선입니다. 없을 때만 **이름 완전 일치 + notionNo:null**인 legacy 행을 찾습니다.
   - legacy `findFirst`에는 정렬이 없습니다. 동명 null 행이 여러 개일 때 특정 승자를 PG 계약으로 고정하면 안 됩니다.
   - 갱신 필드는 NO·이름·truthy notionId·recruitAvoid OR·프로필 전체·동기화 시각입니다. `displayName/notes/partnerId/createdAt`은 보존합니다.
   - 프로필은 merge가 아닌 교체이며, notionId가 없거나 빈 문자열이면 기존 연결을 지우지 않습니다.
   - 값이 같아도 `updated++`입니다. 매핑 때마다 `syncedAt`도 새로 생기므로 재실행을 “변경 0”으로 기대하면 틀립니다.
   [notionInstructorSync.ts:46](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/instructors/notionInstructorSync.ts:46)

3. **매핑에는 의도적으로 느슨한 경계가 있습니다.**
   - 이름은 trim하지만 내부 공백·대소문자는 정규화하지 않습니다.
   - NO는 `unique_id.number`의 `typeof number`만 검사합니다. 양수·정수·Int32 검증을 새로 넣으면 skip과 DB 오류 분류가 바뀝니다.
   - page ID는 하이픈만 제거합니다. UUID 검증·소문자화는 없습니다.
   - rich text는 `plain_text`만 연결하고, 카테고리·강의 목록은 순서와 중복을 유지합니다. 파일 URL은 처음 발견한 유효 URL을 사용합니다.
   - 섭외지양 텍스트는 `"지양"` 포함이면 true이므로 `"지양 아님"`도 true입니다.
   - 연락처·이메일·생년월일은 제거하고, 자유문자열 마스킹은 notes/feeNote/memo에 한정됩니다. 모든 텍스트·URL을 정화하는 정책은 아닙니다.
   [notionInstructorMap.ts:13](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/instructors/notionInstructorMap.ts:13), [instructorNotePii.ts:25](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/instructorNotePii.ts:25)

4. **수동 writer 경합은 세 종류를 구분해야 합니다.**
   - 같은 기존 행: Mongo 수동 writer는 snapshot transaction에서 다시 읽고 **문서 전체 replace**합니다. 실제 같은 문서 쓰기 충돌·retry로 최신 수동 필드 보존을 검증해야 합니다. 무관 ciphertext까지 항상 동일하다고 기대할 수는 없습니다.
   - 같은 NO 최초 생성: unique 충돌을 최대 5회 외부 재시도로 처리합니다. 각 시도에 30초 transaction을 새로 주므로 **전체 30초 보장은 아닙니다.**
   - 같은 이름 최초 생성: 이름은 unique가 아니어서 여러 행 생성이 허용됩니다. NO guard만으로 이름 기반 삽입까지 직렬화됐다고 주장하면 안 됩니다.

   추가로 `getNote(name)`은 null-NO 행 우선이지만, `saveNote(name)`은 번호 오름차순·NULLS LAST의 첫 행을 갱신합니다. 동기화 legacy 선택과도 다릅니다. sync-only guard를 추가해도 기존 수동 writer가 참여하지 않으면 그 경합을 막지 못합니다.
   [mongoInstructorNoteRepository.ts:71](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoInstructorNoteRepository.ts:71), [prismaInstructorNoteRepository.ts:111](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/prismaInstructorNoteRepository.ts:111)

5. **recruitAvoid의 OR는 현재 동시성 안전 보장이 아닙니다.**
   기존 PG는 조회와 update가 분리되어 있어, 조회 뒤 수동 토글이 커밋되면 오래된 값으로 덮을 수 있습니다. 새 Mongo가 transaction 재조회로 이를 개선한다면 **순차 계약 보존과 동시성 강화**를 구분해야 합니다. 수동 writer 자체는 false 설정을 허용하므로 “한번 true면 영구 true” 정책도 아닙니다.

6. **인증·응답·감사는 실제 GET/POST 기준으로 고정해야 합니다.**
   - 정확히 일치하는 Bearer secret이면 통과하고, 불일치는 관리자 세션으로 fallback합니다. secret 길이 제한은 없습니다.
   - 인증 함수가 반환한 actor 문자열은 동기화에서 사용하지 않습니다. 감사 actor는 `withActivity` context이며, Authorization 헤더가 있으면 세션 fallback 성공이어도 `token_request`로 기록됩니다.
   - GET은 업무 쓰기 없는 preview지만 **요청 감사까지 0 write는 아닙니다.**
   - 행별 오류가 있어도 정상 반환이면 HTTP 200·`ok:true`입니다. 바깥 예외는 `syncJsonResponse`의 500입니다.
   - 업무 감사는 행 쓰기와 원자적이고 요청 감사는 별도입니다. PG `notionProfile`에는 HMAC이 없어 동일 JSON 재암호화도 감사 차이를 만들 수 있습니다. Mongo의 논리값 비교와 **동일값·nullable create 감사 parity를 실PG로 확인**해야 합니다.
   [sync route](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/api/admin/sync-notion-instructors/route.ts:7), [request.ts:49](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/request.ts:49), [field-policy.json:374](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/field-policy.json:374)

**독립 oracle 필수 사례**

- baseline 매핑·선택·update/create 로직을 동결하고 새 mapper/adapter를 기대값 생성에 공유하지 않기.
- 기존 NO 우선, legacy 연결, 동명 다른 NO, 중복 원천 NO의 dry/apply 차이, 이름 변경·빈 notionId·프로필 필드 제거.
- 수동 필드 유지, OR 네 조합, 행 실패 후 다음 행 성공, 감사 실패 시 해당 행만 원복.
- 실제 수동 writer와 양방향 barrier: notes/연결 변경, recruitAvoid 토글, NO 변경, 같은 NO 최초 생성. 동명 최초 생성에는 unique 보장을 요구하지 않기.
- 합성 fetch로 pagination·잘못된 payload·중간 fetch 실패를 검증하고, 실제 handler로 secret/session fallback·200 부분 실패·500 전체 실패·요청 감사를 분리 검증하기.
