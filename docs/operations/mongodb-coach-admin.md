# 코치 태그 마스터·삭제 코치 관리의 Mongo 경계

## 범위

| API | 동작 | 저장소 |
| --- | --- | --- |
| `GET/POST /api/master/fields`, `/api/master/curriculums` | 분야·커리큘럼 태그 목록(이름순), 이름으로 추가(이미 있으면 기존 태그 반환) | `CoachAdminRepository.listMasters`/`ensureMaster` |
| `GET /api/admin/deleted-coaches` | 소프트 삭제된 코치 목록(삭제 시각 내림차순) | `listDeletedCoaches` |
| `PUT /api/admin/deleted-coaches` | 복원: 삭제 표시(`deletedAt`, `deletedBy`) 해제 | `restoreCoach` |
| `DELETE /api/admin/deleted-coaches` | 영구삭제: 소프트 삭제된 코치만, 연결 기록까지 물리 삭제 | `purgeDeletedCoach` |

route는 `getCoachAdminRepository()`를 쓴다. 명시 저장소 context가 없으면 기존 PostgreSQL 쿼리를 그대로 옮긴 `PrismaCoachAdminRepository`를 사용한다. 인증(`requireWorkspaceSession`, `assertAdminSession`), 응답 형식, 오류 문구는 바꾸지 않았다. 운영 기본 backend는 계속 PostgreSQL이다.

## 영구삭제 결정

일반 삭제는 소프트 삭제다. 관리자 "삭제된 코치" 패널의 영구삭제만 물리 삭제이며, 공개 규칙("실제 데이터는 물리 삭제하지 않는다")과 다른 기존 동작이다. 2026-09-23 결정권자(기술 책임자)가 "영구삭제가 아예 없는 건 어색하다"며 기존 동작을 Mongo에도 유지하기로 결정했다. 이 작업은 새 삭제 정책을 만들지 않고 기존 PostgreSQL 동작과 같게 옮긴다.

Mongo 영구삭제는 스키마의 FK 규칙을 한 트랜잭션에서 재현한다.

- 함께 삭제(Cascade): 개인정보 프로필, 분야·커리큘럼 연결, 메모, 개인정보 접근 기록, 월 일정, 일정 접근 기록, 예약, 투입, 투입 슬롯.
- 연결만 해제(SetNull): 다른 코치의 예약이 이 코치의 투입을 확정 링크로 가리키면 `confirmedEngagementId`만 비운다.
- 유지: 분야·커리큘럼 마스터 태그, 다른 코치의 기록, 과거 감사 기록.
- 감사: PostgreSQL 활동 trigger가 있는 테이블만 행마다 delete/update 기록을 남긴다. 접근 기록 두 테이블은 PG처럼 감사하지 않는다. 개인정보 값은 redacted로만 남는다.
- 동시성: catalog 잠금과 대상 코치 잠금을 먼저 잡는다. SetNull 대상 예약의 코치와, 이 코치의 투입을 가리키는 다른 코치 슬롯의 코치도 잠근다. 개인정보 접근 기록을 쓰는 두 경로(`recordAccess`, 코치 export)도 이제 같은 코치 잠금에 참여해, 영구삭제와 겹쳐도 지워진 코치를 가리키는 기록이 남지 않는다(PG FK와 같은 결과). 두 경로는 최초 잠금 생성 충돌(11000)을 다른 저장소처럼 재시도한다.
- 가용성: PG에서는 접근 기록 저장이 동기화 작업에 막히지 않았지만, Mongo에서는 시트·Notion 동기화가 같은 코치를 잡고 있는 동안 기다린다. 그래서 `recordAccess` 제한 시간을 10초에서 동기화와 같은 30초로 늘렸다. 30초를 넘는 동기화와 겹치면 개인정보 조회가 실패할 수 있다.
- 규모: 감사 대상 자식은 모델별로 최대 20,000행·32MiB까지 읽고 60초 트랜잭션 안에서 행마다 지운다. 감사하지 않는 접근 기록 두 모델은 한 번에 지운다. 이보다 큰 코치 이력은 Mongo 영구삭제가 실패(fail closed)하며 PG와 달리 지워지지 않는다.

## PostgreSQL 기준과의 차이

같은 합성 fixture를 실제 PostgreSQL 17과 Mongo 8.0.30에 넣고 같은 handler로 비교했다. 모델별 남은 행 수, SetNull, 목록 순서·필드, 복원 응답, 대문자 UUID 처리, 태그 이름순 정렬이 같았다. 감사는 "테이블별 delete 기록이 있고 접근 기록 테이블에는 없다"까지만 양쪽에서 확인했다. 행 수·변경 내용까지 같은지는 비교하지 않았다. 예를 들어 PG는 cascade 순서에 따라 삭제되는 코치 자신의 예약에 SetNull update 기록을 먼저 남길 수 있지만 Mongo는 delete 기록만 남긴다.

- 의도된 보완: 같은 새 태그를 동시에 3번 추가하면 PG는 1건 성공·2건 unique 충돌 실패, Mongo는 트랜잭션 재시도로 3건 모두 같은 태그를 반환한다. 중복은 양쪽 모두 생기지 않는다.
- 정렬: Mongo는 기존 코치 목록과 같은 `localeCompare(..., "ko")`를 쓴다. PG는 DB collation을 따르므로 운영 collation에 따라 대소문자·기호 섞인 이름의 순서가 다를 수 있다. 한글 태그만 쓴 fixture에서는 같았다(테스트 DB는 C collation).
- 없는 코치 복원은 양쪽 모두 예외(500)다. 기존 동작을 404로 바꾸지 않았다.
- ID 형식: PG는 하이픈 없는 UUID 등 다른 표기도 받지만, Mongo는 소문자 하이픈 형식만 처리하고 그 외는 500이다. 존재하지 않는 UUID로 복원·영구삭제를 시도하면 Mongo에는 빈 잠금 문서가 남는다(업무 데이터 아님).
- PG adapter의 기존 한계: 영구삭제의 "삭제 상태 확인"과 "삭제"가 한 트랜잭션이 아니어서, 그 사이 복원이 끼면 복원된 코치가 지워질 수 있다. 기본 동작을 바꾸지 않으려고 그대로 옮겼다. Mongo는 한 트랜잭션에서 확인하고 지운다.

## 운영 메모

- 이 변경 이전에 준비한 shadow namespace는 접근 기록 저장소(`MongoRequestAuditRepository`)·export 저장소를 열 때 코치 잠금 컬렉션이 없어 `COACH_SCHEDULING_GUARD_NOT_READY`로 실패한다. 해당 prepare 함수를 다시 실행하면 된다(기존 문서 변경 없음).

## 남은 범위

운영 전환, 운영 데이터 대조, UI 확인은 하지 않았다. 코치 메모·콘텐츠·관리 조회, manager coachMyPage, access token backfill 등 coverage 문서의 다른 코치 경로는 여전히 PG 직접 경로다.
