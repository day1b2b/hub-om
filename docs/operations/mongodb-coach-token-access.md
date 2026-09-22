# 코치 링크 인증 및 본인 조회 경계

`coachTokenAuth.validateCoachToken`과 `/api/coach/me`는 `CoachTokenRepository`를 사용한다. context 없는 기본 운영은 기존 PostgreSQL adapter이며 Mongo 선택을 환경변수나 HTTP 입력으로 노출하지 않는다. 검증 context에 `coachToken`이 없으면 실패하며 PG로 우회하지 않는다.

- `findByToken`은 기존 내부 PublicCoachTokenContext 형식을 유지한다. sourceCoachId/accessToken이 들어 있는 내부 객체를 HTTP 응답으로 직렬화하면 안 된다.
- `getOwnProfile`은 token을 다시 확인하고 본인 공개 DTO만 반환한다. token, 원천 ID, 연락처 등 PrivateProfile은 응답하지 않는다. 반환하는 이름·상태·업무유형·태그·가능 일정 설명은 기존 화면 계약이다.
- 쿼리의 공백 제거 후 token이 우선한다. 없으면 정확히 `Bearer `로 시작하는 헤더를 사용한다. token 대소문자를 바꾸지 않는다. 잘못된 쿼리 token에 유효한 헤더가 있어도 401이다.
- 기존 인증은 `deletedAt:null`만 확인한다. PENDING/INACTIVE/isActive:false도 유효한 링크이면 접근할 수 있는 기존 동작을 유지한다.
- 본인 조회 availabilityDetail은 public/coaches의 동일 rowKey에 대한 **최신 completed snapshot** 값만 사용한다. Coach 테이블 값을 대신 사용하지 않으며 공백 문자열은 null이다.
- 본인 조회 200/401 응답에 `Cache-Control: private, no-store`를 지정한다.

Mongo adapter는 shadow DB/namespace와 validator/index 준비 및 replica/session을 요구한다. 준비 함수만 DDL을 실행하며 open/조회는 쓰지 않는다. 토큰 및 archive rowKey를 blind index로 검색한 다음, 전체 행을 인증 복호화하고 정확한 원문 일치를 확인한다. token 확인·태그·archive를 하나의 snapshot에서 읽는다. 완료된 재발급/삭제 이후 새 요청은 거절된다. 이미 진행 중인 snapshot 요청까지 후속 재발급이 취소한다고 보장하지 않는다.

검증용 모델은 Coach/CoachField/CoachFieldMaster/CoachCurriculum/CoachCurriculumMaster/CoachdbArchiveRow/CoachdbArchiveSnapshot 7개다. PrivateProfile을 읽지 않는다. 각 scan의 기존 2만행/32MiB 한계는 유지한다. 드라이버·복호화 오류에 토큰이나 원문이 포함돼도 공개 오류는 일반 코드로 치환한다.

단위 검사는 실제 PG adapter의 mocked delegate 결과와 비교하고 실제 me handler, 토큰 추출 우선순위, 상태/삭제·오류·응답 범위·context 분리를 검사한다. native는 `MONGODB_COACH_ACCESS_TEST_URI`에 명시한 자격증명 없는 loopback replica에서 임의 새 DB와 합성 키/데이터만 사용한다. 실제 withActivity와 Mongo 요청감사, 암호문 검색·읽기 중 쓰기 없음·namespace·회전/삭제·변조를 검사하고 종료 시 해당 새 DB를 제거한다. 실제 실행 결과는 총괄 증거를 따르며 운영 데이터 검증이나 서비스 전환 완료를 뜻하지 않는다.

`/api/coach/schedule/[yearMonth]`는 공유 tokenAuth 경계를 사용하지만 이후 일정 조회/수정 자체는 아직 PG 직접 접근이다. 이 경로 전체를 Mongo로 전환한 것은 아니다.
