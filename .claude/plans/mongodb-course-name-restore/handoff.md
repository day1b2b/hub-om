# 과정명 복원 인계

기준 `95cdb6fb71e49b7e3f230571d867bca357a114fe`, 작업 `feature/20260929-mongodb-course-name-restore`. 격리 clone `/Users/ga/workspace/hub-om-mongodb-coach-content`. 원본 workspace는 수정하지 않았다.

## 구현한 범위

과정명 복원 미리보기·선택 적용을 기본 PG adapter와 명시 Mongo repository/context로 분리했다. 원본 query/hash와 직접 DB 주입을 보존하고 명시 scope에서는 PG 우회를 차단한다. PG COMMIT에서 직접 노출되는 adapter-pg40001/40P01만 기존 재조회 오류로 변환하는 보완을 추가했다.

Mongo는 정규화·기업·활성 회차·최신 두 원천·차단 사유·전체 계획 메타데이터·제출 지문 재검증을 구현한다. 기존 대상 재사용/신규 과정 한 개 생성·과정 번호·회차 부분 갱신·감사는 같은 transaction이다. 내부 singleton guard를 매 시도 읽기 전에 갱신하여 서로 다른 회차를 고른 복원끼리의 경합을 처리한다. 일반 조회는 guard를 바꾸지 않는다. 업무 모델/PG schema/35개 codec 계약은 그대로다.

## 검증과 현재 상태

일반893pass/42skip/0fail, 실제 PG 대조/SSI 및 단위 묶음8pass/0skip/0fail, 실제 handler/factory8pass/0skip/0fail, typecheck/build PASS, lint0error/기존7warning. 전체 Mongo360pass/0skip/0fail(mock4포함). 모두 최종 코드의 직접 프로세스 exit0를 확인했다. Gibbs 독립 V1–V9 기능·실행 수락 PASS, 남은 P0–P3 없음. 소유 자원 정리와 원격 SHA는 execution-review/integration-review에서 추적한다. 묶음은 겹치므로 합산하지 않는다. 초기 PG/native 실패와 수정은 execution-review에 보존한다.

runtime `/private/tmp/hub-om-course-name-restore-20260929`, PG56649/course_name_restore_parity, Mongo27749/courserestore20260929. 소유 합성 DB0 확인 후 정상 종료했고 두 dbpath 제거/부재 및 cleanup exit0를 확인했다. 로그·실행스크립트만 남아 있으며 기존 경로를 가동 중인 DB로 재사용하지 않는다. 최종 검증 코드와 통합 코드가 같으면 동일 검사 반복은 불필요하다.

## 남은 범위

다음 작은 후보는 `/admin/database` 호스트 및 셀 편집 경계다. 실제 호출부와 권한·허용 필드·감사 계약을 확인하고 별도 계획으로 시작한다. OM 접수·배정, 가져오기, Calendar, 공지 등 전체 목록은 runtime coverage가 기준이다.

운영 backend는 여전히 PG이다. 이번 작업은 실제 운영 복원을 실행한 것이 아니다. 실제 개인정보/브라우저 초안/실데이터 이전·복원 리허설·최종 전환은 완료하지 않았다. 실 OAuth/브라우저/운영 부하·2만행 경계·모든 미참여 writer의 SSI 동등성은 보장하지 않는다. dev→main 조건은 아직 충족되지 않았으며 자동화도 재개하지 않는다.
