# MongoDB 팀 명단 쓰기 준비

`MongoTeamUserRepository`는 격리 shadow 저장소에서 팀 명단을 조회·등록·수정하는 어댑터다. 현재 서비스의 공개 함수 경계에는 요청 단위 주입 경로를 연결했다. 운영 기본 선택은 계속 기존 local/PostgreSQL이고 MongoDB를 자동 선택하지 않는다. 인증과 역할 변경 권한은 기존 호출 계층 책임이며 이 어댑터가 권한을 부여하지 않는다. 활동 context가 있으면 변경 감사 기록을 동일한 Mongo 트랜잭션에서 저장한다.

## 제공 기능과 호환성

- `listTeamUsers`: 생성일 내림차순, `team`/`role` null은 기존 DTO처럼 undefined.
- `findTeamUsersByEmail`: trim/lowercase 비교, 기존 대소문자·공백 표기와 중복 행을 모두 확인. 빈 비교값은 빈 배열.
- `createTeamUser`: 기존 입력 표기를 저장하고 정규화 비교만 수행한다. UUID와 생성일을 생성하며 이름·이메일·Slack ID는 기존 runtime codec으로 암호화한다.
- `updateTeamUserTeam`: nullable team 교체. 없는 ID만 null이며 DB·복호화 오류를 없는 행으로 숨기지 않는다.
- `updateTeamUsersRole`: 중복 입력 ID는 한 번만 계산하고 존재하는 행 수를 반환. 모든 대상 행을 하나의 트랜잭션에서 수정한다.
- `deleteTeamUsers`: `TEAM_USER_DELETE_POLICY_REQUIRED`로 차단. 기존 구현은 물리 삭제지만 공개 규칙은 이를 금지하며 현재 TeamUser에는 소프트 삭제 필드가 없다. 필드나 삭제 의미를 임의로 도입하지 않았다.

정규화 이메일 중복은 기존 `DuplicateTeamUserEmailError`의 instanceof/name 계약을 유지하는 subclass다. 예외 message와 `existingNames`에는 입력 이메일이나 기존 사람 이름을 넣지 않는다. 따라서 연결 시 UI의 중복 이름 안내는 일반 중복 안내로 바뀐다. 예상하지 못한 Mongo/codec 오류는 `TEAM_USER_ACCESS_FAILED`로 감싼다.

## 동시 생성과 수정

기존 emailPiiIndex는 원문 정확 비교 HMAC이고 unique가 아니다. 전체 명단을 복호화해 중복을 확인하더라도 snapshot transaction만으로 두 신규 생성의 write skew를 막지는 못한다.

명시 준비 함수 `prepareMongoTeamUserStore`는 업무 필드를 바꾸지 않고 namespace별 내부 컬렉션 `<namespace>___teamUserWriteGuard`를 준비한다. strict validator가 고정 `_id: TeamUser`와 0 이상의 BSON Long `version`만 허용한다. PII나 암호화 키를 저장하지 않는다.

각 등록·수정 트랜잭션은 첫 write로 guard version을 증가시킨 후 대상 행을 읽는다. 동시 요청은 같은 문서에서 충돌하므로 Mongo driver가 transaction 전체를 다시 실행해 최신 내용을 읽는다. 등록은 그 안에서 정규화 이메일 중복을 검사하고 저장한다. 수정은 인증된 전체 문서에 요청 필드만 합쳐 암호화 저장하므로 역할과 팀의 동시 수정도 서로를 덮어쓰지 않는다. snapshot read concern, majority+journal write concern, primary read preference, 30초 transaction timeout을 사용한다.

guard가 사라지거나 Long 최대값에 도달하면 write를 차단한다. open은 guard/업무 validator·index 및 replica/session 준비 상태를 읽기 전용으로 확인한다. 준비는 open에서 자동 실행하지 않는다. mutation은 `allowShadowWrites: true`가 없으면 시작되지 않는다.

## 전환 전 필수 조건

- **모든 TeamUser writer가 이 guard 계약을 따라야 한다.** 원천 importer, 수동 Mongo 수정, 기존 별도 writer가 guard 밖에서 쓰면 정규화 중복 방지는 보장되지 않는다. 실제 데이터 이관 단계와 앱 쓰기를 겹치지 않고 검증 후 단일 쓰기 경로로 전환해야 한다.
- 전체 스캔은 기존 공통 제한인 2만 행/32MiB를 넘으면 차단한다. 제한 이상의 명단이 필요하면 정규화 unique 계약을 별도로 설계해야 한다.
- 기존 중복 데이터를 임의로 합치거나 삭제하지 않는다. 조회는 모든 중복을 보여주고 같은 이메일 신규 등록은 막는다.
- 등록 요청 자체의 멱등성 키 계약은 기존에 없으며 추가하지 않았다. 응답 유실 뒤 재시도하면 중복 이메일 오류를 받을 수 있다.
- 물리 삭제와 공개 보관 규칙의 충돌 해결, 실제 라우트 연결/권한 검증, 운영 데이터 대조 및 대상 Mongo 버전 검증이 남아 있다.

## 검증

2026-09-22 Node 24.19.0: 새 단위 테스트 6개 통과, 실제 Mongo용 테스트 1개는 명시 URI가 없어서 로컬에서 생략. 단위 테스트는 메모리 Mongo 대역이며 실제 transaction 엔진 검증과 구분한다.

실제 엔진 테스트는 `MONGODB_TEAM_USER_TEST_URI`에 인증 없는 loopback replica URI만 허용한다. 임의 이름의 합성 DB와 새 합성 암호화 키를 만들고 종료 시 DB를 삭제하고 환경을 복구한다. 운영 `MONGODB_URI`/env 파일을 읽지 않는다. 검사 항목은 빈 명단에서 정규화 이메일 동시 등록, 다른 필드 동시 수정, 서버 validator 오류로 인한 전체 rollback, 암호문 저장, 구표기 중복, guard 소실/고갈, 쓰기 gate, 삭제 차단이다.

이 문서의 로컬 검증 수치는 실제 Mongo 실행 성공을 뜻하지 않는다. 통합 보고서에 별도 실제 엔진 결과가 있을 때만 해당 결과를 적용한다.

## 총괄 실제 엔진 검증 (2026-09-22)
MongoDB 7.0.43 격리 replica set에서 이 native suite를 실행해 통과했다(신규3suite 전체3pass/0fail/0skip). 실행근거는 `.claude/plans/mongodb-write-repositories/execution-manifest.md`. 대상8.0/실제데이터/생산API 연결 검증은 별도다.

## 요청 단위 연결과 감사 기록 보완 (2026-09-22)

기존 `teamUserRepository.ts`의 함수6개는 유지했다. `getDataRepositoryOverride("teamUsers")`가 있으면 해당 구현을 호출하고, context 자체가 없을 때만 `legacyTeamUserRepository.ts`를 지연 로딩한다. 기존 local/Prisma 선택과 DTO·쿼리는 legacy adapter로 이동해 보존했다. 부분 context에 TeamUser가 빠지거나 주입 구현이 실패하면 PostgreSQL로 우회하지 않는다.

기존 admin users·팀·역할·삭제 API, lookup, OM 요청 배정 권한 확인 등이 같은 공개 함수를 호출하므로 요청 context의 같은 명단을 읽는다. 기존 라우트의 관리자·lookup 토큰 검사와 OM 권한 로직은 바꾸지 않았다. context 주입은 별도 호출자가 수행해야 하며 모든 앱 기능의 Mongo 전환 완료를 의미하지 않는다.

`TeamUserRepository` interface와 `teamUserErrors.ts`로 계약·오류를 분리했다. 기존 오류 export는 facade에서 재수출한다. Mongo 구현은 오류 파일만 가져오므로 PG/local adapter를 가져오지 않는다.

Mongo 준비 대상에는 `ActivityChange`를 추가했다. create/team/role 변경 후 `operationAuditRow`로 만든 감사행을 같은 session에 암호화 삽입한다. 이름·이메일·Slack ID 같은 개인정보 값은 redacted이고 팀·역할은 기존 감사 계약에 따라 before/after로 남는다. actor 식별 정보와 감사 changes 저장값은 암호화된다. audit 삽입 실패 시 업무 변경과 guard 증가가 함께 rollback된다. 기존 helper와 동일하게 활동 context가 없는 직접 호출은 감사행을 만들지 않으므로 실제 요청 경로에서 context 전달을 반드시 검증한다.

추가 검증: TeamUsers 전체 및 기존 OM 배정 권한 테스트 **26개 통과, native 1개 생략**, 전체 `tsc --noEmit` 통과. 새 tests는 façade 모든 함수 전달, 동시 요청 격리, partial/실패 context의 fallback 차단, no-context Prisma 선택, 기존 OM 권한 helper까지의 주입 전달, 기존 admin/lookup 핸들러의 인증 선행을 확인한다. 라우트 검사는 실제 핸들러 원문을 실행하되 activity wrapper와 인증 응답을 대역으로 주입한 검사이며 브라우저 실사용·실제 인증 서버·Mongo 엔진 검증과 구분한다. native 검사에 감사행 암호화와 감사 삽입 실패 rollback을 추가했으며 이번 로컬 실행에서는 URI가 없어 실행하지 않았다.
