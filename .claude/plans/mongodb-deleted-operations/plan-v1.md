# 삭제 운영 목록·복원 계획 v1

기준 b401626aed20ca685d4d2c4d45074c94af7fbf67, feature/20260929-mongodb-deleted-operations, 격리 clone 시작 clean. 직전 과정 관리자 기능은 완료됐으므로 반복 구현하지 않는다.

## 범위와 선택

api/admin/deleted-operations GET/PUT만 저장소 경계로 전환한다. 기존 CourseAdminRepository 확장과 별도 DeletedOperationRepository를 비교해 후자를 선택한다. 과정ID 조회/일괄 삭제 계약과 운영 차수ID 목록/복원 계약을 분리하고 기존 검증된 코드는 유지한다. UI·권한·물리삭제·새 정책·스키마·의존성·운영selector 변경 없음. 기본 PG, 명시 deletedOperations context만 Mongo다.

## Core 단계

1. listDeletedOperations(): DeletedOperationRow[]와 restoreOperation(operationId): {operationId} 정의. 목록DTO는 operationId/companyName/courseName/roundNo/startDate/endDate/deletedAt/deletedBy. 삭제시각 내림차순, 동률은 기존 계약처럼 순서 무보장. dateOnly는 ISO slice(0,10), deletedAt ISO/null. PG adapter는 원본 쿼리·DTO 유지. API의 admin/JSON·문자열 검사·응답 유지. 원본 operationId는 UUID가 아닌 exact 문자열이다. 빈 문자열을 임의 거절하거나 trim/lowercase하지 않는다. 없는 ID는 원본처럼 예외다.
2. Company/Course/OperationSession/ActivityChange 기존 계약·codec·readiness 재사용. Mongo 목록은 같은 snapshot에서 필수 관계를 조회하고 손상은 고정오류로 실패. 복원은 삭제/활성 여부와 무관하게 deletedAt/deletedBy/HMAC null 및 updatedAt을 부분갱신한다. 기존 PG는 재복원도 updatedAt을 갱신하므로 no-op으로 바꾸지 않는다. 그 외 raw필드·관계 불변. 변경감사는 같은transaction, 논리차이 없는 replay는 감사없음. driver의 실제writeconflict 재시도 후 snapshot 재평가, 전체deadline 유지.
3. 실제격리PG45migration+원본query oracle/Mongo DTO·state·감사·암호화·관계보존/빈ID·공백·case·missing비교. 실제admin guard/withActivity/context/fallback차단. 100초과/BSON짧은batch/scan한도/시간제한. 일반writer·과정bulk삭제와 복원 양쪽선행 barrier경합 및동일복원경쟁. 후행감사실패 전체raw원복.

## 검증·완료

일반test/typecheck/lint/build, 기존Mongo회귀, 독립review. skip/실행불가/의도오류와PASS구분. 신규dbpath PG56629/Mongo27729·임시키·합성자료/env-i만사용. 문서·macro/coverage갱신, 소유자원정리, featurecommit/push와원격SHA, 승인된총괄feature통합. 전체 이전 미완료이므로 dev→main과 운영 적용은 하지 않는다.

## 반례·경계

- 재복원updatedAt과 deletedBy만남은활성행의복원 동작을 임의로 바꾸지 않는다. 감사의 deletedBy 제외 계약도 실제PG대조한다.
- 복원과삭제가경합하면 마지막직렬화동작이최종상태다. 복원후active는정상동작이며 무조건삭제우선이라는새정책을추가하지 않는다.
- 목록의동률정렬·동시변경노출과실운영부하를과장하지 않는다. 페이지단위조회가전체snapshot/자료량한도와함께작동하는지검증한다.
- 목록응답의승인된deletedBy복호화와저장데이터·감사·에러의평문비노출을구별한다. frontend복원루프에새일괄원자성을추가하지 않는다.

역할: main(interface/PG/factory/context/routes/handler/runtime/docs), Schrodinger(Mongo), Kepler(native), Gauss(PG), Anscombe(critic), Gibbs(meta/독립결과검토). 쓰기범위분리, 모든실DB는main실행.
