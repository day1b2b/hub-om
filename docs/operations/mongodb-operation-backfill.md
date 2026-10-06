# 운영 보정 API의 Mongo 경계

`onsite-required-backfill` 및 `om-assignment-status-backfill` GET/POST의 기존 관리자 인증·응답과 버튼 실행 방식을 유지한다. 기본 backend는 PostgreSQL adapter이며, 명시 `operationBackfill` context로만 Mongo를 선택한다. HTTP 입력이나 운영 환경변수로 Mongo를 선택하지 않는다. context 자체가 없으면 PG 기본, 명시 context에 서비스가 없거나 Mongo가 실패하면 PG로 우회하지 않는다.

## 기존 보정 계약

- 현장 투입: 소프트 삭제되지 않은 N/PARTIAL/UNKNOWN을 Y로 바꾼다. 완료·아카이빙 여부로 제외하지 않는다. onsiteText는 변경하지 않는다.
- OM 배정 상태: 소프트 삭제되지 않고 ASSIGNMENT_NEEDED인 행 중 omName이 null/빈문자열/정확한 `★배정필요`/`배정필요`가 아닌 행을 ASSIGNMENT_PLANNED로 바꾼다. 공백과 앞뒤 공백이 붙은 placeholder는 기존대로 대상이며 trim이나 상태 재계산을 하지 않는다.
- 각 적용은 해당 업무 필드와 updatedAt만 바꾼다. 담당자·메모·관계·삭제 정보·비관련 암호문은 보존한다. 대상이 없거나 중간 변경 없이 재실행하면 0건이고 시각·변경 감사도 추가하지 않는다.
- GET 건수는 이후 POST 대상을 예약하지 않는다. 각각 새로운 snapshot을 사용하므로 그 사이 변경으로 건수가 달라질 수 있다. POST body는 기존대로 읽지 않는다.

## 저장·원자성·한계

기존 OperationSession/ActivityChange 모델·validator·index·codec를 사용한다. OM 후보 검색은 필드별 HMAC의 명시적 null 제외와 notIn으로 수행한 뒤 후보를 복호화하여 원문 조건·HMAC 무결성을 검증한다. 인덱스 조건에서 이미 제외된 손상행까지 전수 탐지하는 도구는 아니다.

Mongo 적용과 변경 감사는 같은 transaction이며 후행 쓰기·감사 실패 시 앞선 변경도 원복한다. 기존 writer와 같은 행을 쓰다 충돌하면 새 snapshot에서 조건을 다시 판단한다. 전체 재시도 제한 30초와 공통 scan 제한 15초/2만 행/32MiB가 적용된다. 100행 keyset의 짧은 BSON batch도 끝으로 간주하지 않는다. 한도 초과를 부분 성공으로 반환하지 않는다. PG count와 달리 Mongo count는 후보 codec 검증을 포함하므로 비용과 한도가 있으며 운영 부하 검증을 대신하지 않는다.

일반 실행은 저장소 준비나 자동 수리를 하지 않는다. prepare는 명시된 검증용 shadow에서만 수행하며 기존 정책 불일치는 실패한다. 콘솔에는 고정 도구 이름과 건수만 남기고 실행자 이메일·이름·드라이버 오류 본문은 남기지 않는다. 변경 감사의 실행자는 기존처럼 암호화하여 유지한다. activity context 없는 내부 호출은 기존 helper의 무감사 계약을 따른다.

## 범위와 실행 상태

이번 작업은 코드와 새 로컬 합성 PG/Mongo 검증이다. 운영에서 실제 보정을 실행하거나 schema/migration/의존성/키/권한/배포 설정을 바꾸지 않는다. 운영 보정은 기존 DB 안전 규칙의 백업·대상 범위 확인 절차가 별도로 필요하다.

`/admin/database` 호스트 페이지 전체와 기존 `scripts/backfill-onsite-required-y.ts` legacy PG CLI는 이번 API 경계에 포함하지 않는다. 실제 OAuth·브라우저 E2E·운영 부하·실복사·복구 리허설·생산 backend 전환도 미검증이다. 최신 검사·독립 리뷰·통합 상태는 `.claude/plans/mongodb-operation-backfill/`의 실행 및 인계 기록을 따른다.
