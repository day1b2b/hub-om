# 코치 관리 API repository 경계

`/api/coaches` GET/POST와 `/api/coaches/[id]` GET/PUT/PATCH/DELETE는 `CoachManagementRepository`를 호출한다. 기존 route의 `requireWorkspaceSession`·`withActivity`와 HTTP 상태/한국어 오류 문구는 유지한다. 기본 factory는 `PrismaCoachManagementRepository`이므로 운영 DB 선택은 바뀌지 않는다.

## PG와 Mongo 선택

- context가 없으면 PG. 기존 쿼리·select·DTO·입력 파싱·`logProfileEdit`를 Prisma adapter로 이동했다.
- 검증용 `runWithDataRepositories({ coachManagement: mongo }, work)` 안에서는 미리 open한 Mongo adapter만 사용한다. context가 있는데 이 adapter가 빠지면 실패하며 PG로 우회하지 않는다.
- `MongoCoachManagementRepository`는 기존 Mongo 쓰기 adapter를 호출하며 관리 API 전용 조회를 구현한다. schedule/dashboard용 CoachRepository DTO와 다르다.
- Mongo prepare는 관리용 10모델(기존 업무 7개+ActivityChange+CoachEngagement+CoachSchedule)의 validator/index를 준비한다. 명시 write gate와 shadow namespace만 허용한다. 정상 open은 DDL을 실행하지 않는다.

## 조회 계약

- 삭제 코치는 목록/상세에서 제외하고, 목록 status 미지정/잘못된 값이면 PENDING 제외. 명시 status는 active/inactive/pending을 지원한다.
- 검색은 이름/workType의 대소문자 무시 부분일치, field는 태그 이름 정확 일치.
- 페이지·limit·total, enum 순서와 normalizedName 이름 정렬, `{id,name}` 태그, 전체 engagementCount·최근 engagement, 상세 scheduleCount 유지.
- 관리 상세에는 archive fallback을 적용하지 않으며 기존 선택 필드와 null 날짜를 그대로 반환한다. PrivateProfile이나 token을 DTO에 추가하지 않는다.
- Mongo 조회는 snapshot transaction으로 관계를 함께 읽고, 각 scan에 기존 2만행/32MiB 한계가 적용된다. 이 한계를 초과하는 실데이터 조회는 아직 해결되지 않았다.

## 쓰기 감사

Mongo 쓰기는 Coach/PrivateProfile/태그 master/태그 link 변경과 ActivityChange를 같은 transaction에 기록한다. 태그 교체에서 삭제된 링크도 감사한다. Profile의 targetId는 coachId, 태그 연결은 PG JSONB 표현과 같은 복합 식별자를 사용한다. EDIT_HISTORY 자체의 중복 activity 기록은 기존 migration처럼 제외한다. ContentEntry 프로필 수정 기록은 계속 원자 처리한다.

인가된 session에서 actor 정보를 만든 뒤 전달한다. 요청 전체 ActivityRequest 처리와 private-read audit는 공통 경계가 담당하며, 이 문서의 개별 route 테스트는 auth/activity wrapper를 mock한다.

## 검증 범위

- unit: 실제 PG adapter vs Mongo 관리 DTO/filter/page 비교, 실제 HTTP handler의 Mongo context 주입, Prisma fallback 금지, 인증 거부 시 쓰기 미실행.
- 기존 쓰기 unit: 실제 route를 통해 기존 입력/HTTP 계약 비교, 원자 감사 실패 rollback, profile/tag targetId와 EDIT_HISTORY 중복 제외.
- native API suite: `MONGODB_COACH_WRITE_TEST_URI` 명시 loopback replica에서 synthetic 데이터로 HTTP handler 6개(목록/생성/상세/수정/상태/삭제), 암호화 감사, 400/404, 인증 거부를 검증한다. PostgreSQL client는 실패하는 mock으로 대체한다.
- URI 없는 로컬 검사는 native skip이다. 실제 엔진 실행 여부는 총괄 결과를 따른다. 운영 환경 선택·실데이터 이전·배포는 이 변경에 포함되지 않는다.
