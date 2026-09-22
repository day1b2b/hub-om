# Mongo 코치 관리 쓰기 준비

`MongoCoachWriteRepository`는 `/api/coaches` POST와 `/api/coaches/[id]` PUT/PATCH/DELETE의 기존 계약을 구현한다. 코치 관리 라우트는 이제 별도 `CoachManagementRepository` 경계를 호출한다. PG가 기본이며 검증 context에서만 이 Mongo adapter가 선택된다. 자세한 경계는 `mongodb-coach-management-boundary.md`를 참고한다. 실제 PG 운영 데이터·설정·키를 변경하지 않는다.

## 허용 범위와 준비

- `MongoCoachWriteRepository.open`은 명시적 `allowShadowWrites: true`, 검증용 DB/namespace, replica set/session, 8개 모델 validator/index 준비를 요구한다.
- `prepareMongoCoachWriteStore`만 collection/index를 준비한다. 정상 open과 업무 쓰기에서 DDL을 실행하지 않는다.
- 모델: Coach, CoachPrivateProfile, CoachField, CoachFieldMaster, CoachCurriculum, CoachCurriculumMaster, CoachContentEntry, ActivityChange.
- 인증·권한·요청 activity는 호출자 책임이다. `CoachWriteAuthor`는 클라이언트 본문이 아닌 검증한 서버 session에서 가져와야 한다.

## 기존 계약과 원자성

| 메서드 | 계약 |
| --- | --- |
| createCoach | 이름 필수/trim, normalizedName 기존 함수, 랜덤 accessToken, status 기본 ACTIVE, isActive 기본 true. PrivateProfile과 중복 제거한 태그를 원자 생성. POST의 employeeId/isActive 입력은 기존처럼 무시. |
| updateCoach | 생략/undefined 보존, 명시 null은 해당 nullable 값을 지움. 필드/커리큘럼 배열을 해당 관계 전체와 교체. private profile 없으면 생성. |
| updateCoachStatus | active/inactive만 허용. isActive는 별도 값으로 보존. |
| deleteCoach | deletedAt/deletedBy만 설정. 관계 데이터 보존. 이미 삭제한 대상은 COACH_NOT_FOUND. |

생성/수정/삭제는 snapshot transaction 및 majority+journal commit을 사용한다. 전체 문서를 교체하기 전에 transaction 안에서 최신 값을 복호화하므로 충돌 시 driver의 transient 재시도가 다시 읽고 병합한다. 같은 태그 master를 동시에 생성한 unique 충돌은 제한된 횟수로 전체 transaction을 다시 시작한다.

프로필 내용 감사의 필드 목록·문구는 기존 `logProfileEdit`와 같다. 기존 PG가 프로필 commit 후 별도로 기록하던 감사는 **같은 transaction으로 묶어 감사 실패 시 전체 변경도 rollback**한다. 기존 정책과 동일하게 private-only/status-only 변경은 이 content 감사 목록에 포함되지 않는다. 요청 전체의 activity 감사는 공통 경계에서 처리한다. ActivityChange는 Coach/PrivateProfile/태그 master/link 쓰기와 같은 transaction에 기록하며 EDIT_HISTORY 중복 기록은 제외한다.

Coach/Profile/ContentEntry는 기존 runtime codec으로 암호화하고, DTO는 id/name 또는 id/status/isActive만 반환한다. codec/driver 실패는 개인정보를 포함하지 않는 오류 코드로 치환한다. 같은 호출을 반복하면 별도 코치를 만들 수 있으며, 원래 POST 계약에도 멱등키가 없다.

## 검증과 한계

- 단위: 실제 기존 route 코드에 mocked Prisma를 연결해 POST/PUT/PATCH/DELETE 파싱·기본값·생략/null·태그·감사 문구 비교. 실제 PostgreSQL 엔진 비교는 아니다.
- 단위: 생성중 실패·감사 실패 시 전체 rollback, unique collision retry, 암호문 저장/응답 범위, 변조 차단.
- native: `MONGODB_COACH_WRITE_TEST_URI`의 명시 loopback replica만 허용. 임의 새 DB와 synthetic 키/데이터만 사용하며 종료 시 drop한다. audit validator 실패 rollback, 동시 disjoint patch 보존, 공유 tag race, namespace 분리·변조·soft delete를 검증한다.
- 해당 URI가 없으면 native는 skip이다. 이 문서는 native 실행 성공을 주장하지 않는다. 실제 실행 여부와 DB 버전은 총괄 실행 보고에서 별도 확인한다.
- 실서비스 Mongo 선택, 요청 activity 통합 검증, 실제 데이터 복사/복원/전환은 남아 있다.

## 총괄 실제 엔진 검증 (2026-09-22)
MongoDB 7.0.43 격리 replica set에서 이 native suite를 실행해 통과했다(신규3suite 전체3pass/0fail/0skip). 실행근거는 `.claude/plans/mongodb-write-repositories/execution-manifest.md`. 대상8.0/실제데이터/생산API 연결 검증은 별도다.
