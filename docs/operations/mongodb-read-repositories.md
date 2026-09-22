# MongoDB 팀·코치 조회 repository 병렬 검증

`MongoTeamMemberRepository`, `MongoCoachRepository`, `MongoCoachPrivateRepository`를 별도 shadow DB/namespace에서 직접 열어 검증하는 단계다. **운영 factory의 PostgreSQL/Prisma 선택은 유지한다.** 이번 구현은 조회 10개이며, 앱 전체의 MongoDB 전환이나 운영 배포 완료가 아니다.

## 구현 범위와 준비 조건

| 저장소 | 조회 메서드 | 주요 호환 동작 |
|---|---|---|
| TeamMember: 2개 | `listResourceOwners`, `listRoleRosters` | Member 활성·역할 필터, TeamUser 역할 목록, 미분류 팀, 빈 목록·OM 부재의 서로 다른 기본 명단 |
| Coach: 6개 | `listCoaches`, `getCoachById`, `listEngagements`, `listSchedules`, `listEngagementSchedules`, `getScheduleDashboard` | 목록·상세의 삭제 필터 차이, 분야·커리큘럼, 평가·근무일, 기간·취소 상태, 예약·일정 중첩, 완료된 archive 상세 fallback |
| CoachPrivate: 2개 | `getPrivateProfile`, `getEngagementFeedback` | 개인정보 날짜·null, 피드백 DTO·순서 |

공통 `MongoOperationStore`에 허용 모델 집합을 명시한다. `TEAM_READ_MODELS`는 `Member`, `TeamUser`이며 `COACH_READ_MODELS`는 아래 12개다.

```text
Coach, CoachField, CoachFieldMaster, CoachCurriculum, CoachCurriculumMaster,
CoachEngagement, CoachEngagementSchedule, CoachSchedule, CoachDayReservation,
CoachdbArchiveRow, CoachdbArchiveSnapshot, CoachPrivateProfile
```

기존 Operation 도메인의 7개 모델·채번 준비 조건은 유지한다. 팀·코치 조회를 위해 Operation 컬렉션이나 counter를 추가로 준비할 필요는 없다.

준비는 승인된 합성 shadow에서 `prepareMongoReadStore({ ...options, allowShadowWrites: true }, models)`를 명시적으로 호출한다. 이 함수는 validator·index 설치/점검을 하므로 읽기 전용 함수가 아니다. 반면 repository의 `open(options)`는 준비 상태를 검사하며, 조회 메서드와 함께 DDL·수정·감사 쓰기를 수행하지 않는다. `options`의 client·databaseName·namespace를 명시하고, 환경변수 또는 PostgreSQL fallback으로 연결 대상을 추측하지 않는다.

준비되지 않은 컬렉션, 잘못된 validator/index/collation은 실패한다. 준비 검사는 외부 관리자가 이후 제약을 제거하는 상황까지 방지하는 권한 경계는 아니다. 실제 사용자 권한 판단은 기존 호출부 책임이며, 이번 직접 호출 검증으로 운영 권한 검증이 완료된 것은 아니다.

## 암호화와 조회 의미

- 기존 runtime codec과 필드별 AAD/HMAC 계약을 사용한다. 전체 문서의 암호문·companion을 인증한 뒤 필요한 DTO만 반환한다. 평문·잘못된 키·변조·누락된 HMAC을 기본 명단이나 빈 결과로 바꾸지 않는다.
- 개인정보 이름은 복호화 후 한국어 비교를 적용한다. 역할·팀 enum 순서와 null 정렬은 기존 Prisma 개인정보 정렬 계약을 따른다. TeamUser의 팀 값은 정확히 `1팀`/`2팀`인 경우만 해당 팀이며, 파트명·빈 문자열·null은 미분류다.
- TeamMember 기본값은 조회 행이 전혀 없는 경우와 분류할 팀이 없는 경우를 구별한다. 역할 목록에 LD만 있으면 OM 기본 명단을 보완하고, OM만 있으면 LD는 빈 목록으로 유지한다. 중복 이름은 임의 제거하지 않는다.
- 공통 후보 조회는 **한 번에 20,000문서·32MiB BSON**을 넘으면 실패한다. 일부만 잘라 성공으로 보고하지 않는다. 여러 조회를 합한 전체 요청 메모리나 복호화 후 크기의 합계 제한은 아니다.
- Coach의 관계·archive 조회는 여러 읽기로 구성된다. **여러 조회가 같은 시점의 snapshot이라는 보장은 추가하지 않았다.** Team의 두 메서드 사이에도 동일 시점 보장이 없다. 동시 수정 중 일관성이 필요한 운영 전환은 별도 검토 대상이다.
- 알려진 안전한 오류는 유지하고 예상하지 못한 driver 오류는 고정 코드로 감싼다. DB URL·키·문서 값·원래 오류 메시지를 사용자 응답으로 내보내지 않는다.

## 검증 결과와 실행 방법

총괄이 확인한 현재 전체 검사 결과는 **789개 통과·7개 미실행**, 타입 검사·빌드 통과, ESLint 오류 0개·기존 경고 7개다. 기준은 이 문서 작성 시점의 통합 작업 상태이며 후속 수정 후 다시 검증해야 한다.

단위 검증에는 기존 Prisma repository에 합성 mock delegate 결과를 공급하고 Mongo adapter 결과와 비교하는 검사가 포함된다. **실제 PostgreSQL과 MongoDB 두 엔진의 대조 실행 결과는 아니다.** Team의 null/enum/정렬·기본값·오류 전파와 Coach/Private의 DTO·관계·기간 처리 등을 검사한다.

이번 조회 범위는 MongoDB 7.0.43 보조 엔진에서 실제 합성 데이터를 저장하고 조회 검증을 수행했다. 로컬에서는 포트 개설이 `EPERM`으로 차단됐다. Coolify의 격리 Docker 검증 이미지 빌드는 통과했지만, MongoDB 8.0.32가 호스트 커널 `7.0.0-28-generic`에서 TCMalloc startup guard로 종료 코드 1을 반환하여 DB 테스트를 시작하지 못했다. MongoDB 7.0.43에서 Operation·Team 24개 검사가 통과했고, Coach의 테스트 fixture 고유키/URL 설정을 보완한 후 공개 6개·private 2개 메서드를 포함한 native 및 mock 2개 검사도 통과했다. 동일 항목의 중복 실행 결과는 전체 테스트 수에 더하지 않는다. 이전 Operation repository·외부 shadow 검증 성공을 이번 새 조회 10개의 실제 엔진 검증으로 대신하지 않는다.

Node 24와 별도로 준비한 폐기 가능한 loopback replica set에서 다음 형식으로 실행한다. URI는 예시이며 운영 DB 주소를 넣지 않는다.

```sh
MONGODB_RUNTIME_TEST_URI='mongodb://127.0.0.1:27019/?replicaSet=rs0' \
  node --experimental-strip-types --experimental-test-module-mocks \
  --experimental-loader ./scripts/ts-loader.mjs --test \
  src/lib/data/mongoTeamMemberRepository.test.ts

MONGODB_COACH_TEST_URI='mongodb://127.0.0.1:27019/?replicaSet=rs0' \
  node --experimental-strip-types --experimental-test-module-mocks \
  --experimental-loader ./scripts/ts-loader.mjs --test \
  src/lib/data/mongoCoachRepository.integration.test.ts
```

두 환경변수가 없으면 해당 native suite는 미실행 처리한다. 테스트는 `.env`·`DATABASE_URL`·일반 `MONGODB_URI`를 자동 사용하지 않는다. 전용 loopback 주소·포트, 자격증명/기존 DB 경로 부재를 확인하고 무작위 합성 DB와 임시 암호화 키를 사용한다. setup·fixture 쓰기·정리는 그 합성 DB에 한정한다. 실제 자료나 실제 키를 테스트 fixture에 복사하지 않는다.

## 남은 전환 작업 지도

| 영역 | 이번 구현 이후 남은 일 |
|---|---|
| 새 조회 10개 | 7.0 보조 엔진 검증 결과와 별도로 운영 대상 버전·실제 데이터 규모·인증 호출부 연결 검증 |
| 업무 쓰기/API | 코치·개인정보 수정, 팀 사용자 CRUD, OM 요청·가용성, 공지·첨부, 강사 노트, import 등 남은 PostgreSQL 직접 접근의 전환 범위 확정·구현 |
| 공통 작업 | 감사 수집/조회, 캘린더 잠금·외부 동기화, 인증·권한 관련 저장 접근 등 잔여 경로 검증 |
| 운영 전환 | 운영 factory 연결, 최종 동기화·원본 변경 동결, sequence 재확인, 성능·백업 복원·rollback·배포 검증 |

이미 구현한 Operation 생성·수정·soft-delete·채번·감사 원자성은 [운영 repository 검증](mongodb-operation-runtime.md), 35모델 암호화 복사 도구는 [shadow 복사 계약](mongodb-shadow-transfer.md)을 따른다. 해당 구현의 존재만으로 나머지 API나 전체 앱이 MongoDB를 사용한다고 판단하지 않는다.

8.0.32 기동 실패는 [공식 커널 호환성 안내](https://www.mongodb.com/docs/manual/release-notes/8.0/)와 일치한다. 이를 피하려고 운영 서버 커널을 바꾸지 않았다. 7.0.43 보조 컨테이너의 초기 파일 개수 제한 실패는 해당 컨테이너에 `--ulimit nofile=65536:65536`을 지정하여 해결했다. 운영 앱/DB 설정 변경은 없다.

후속 보안 native 검사(7.0.43): 키 회전 후 구키 읽기, 구키 제거 시 실패, AAD/tag/HMAC 변조·companion 제거 시 실패와 복원, 동일 ID의 두 namespace 조회 격리, open 및 전체 8개 코치 조회의 쓰기/DDL 명령 0건을 확인했다. 준비 단계는 명시적인 setup으로 분리했으며 실제 키는 사용하지 않았다. `coach-security.log`: 1 pass / 0 fail / 0 skip.
