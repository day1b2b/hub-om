# PostgreSQL 운영 정렬·시간대 사전 점검

MongoDB 전환 전에 현재 PostgreSQL 연결의 문자열 정렬과 날짜 해석 전제를 읽기 전용으로 확인한다. 이 점검은 운영 데이터나 업무 테이블을 읽지 않고, 시스템 카탈로그와 고정 합성 문자열만 조회한다. 실행 자체가 MongoDB 전환 승인이나 운영 데이터 검증을 뜻하지 않는다.

## 실행

점검 대상 `DATABASE_URL`을 가진 환경에서 다음을 실행한다.

```bash
node --experimental-strip-types --experimental-loader ./scripts/ts-loader.mjs \
  scripts/check-postgres-runtime-contract.ts
```

연결은 앱과 같이 세션 시간대를 UTC로 강제하며, 연결 시작부터 `default_transaction_read_only=on`을 적용한다. 이후 명시적인 읽기 전용 transaction 안에서 5초 statement timeout으로 아래만 확인한다.

- 실제 세션 시간대가 UTC인지
- 데이터베이스 encoding이 UTF8인지
- 고정 합성 probe가 UTF-8 byte 순서와 같고 locale provider·collate·ctype이 검증된 `C`/`POSIX` 조합인지
- 기록된 collation version과 현재 운영체제의 실제 version이 같은지

연결 문자열, 데이터베이스 이름, 합성 정렬 문자열, 드라이버 오류 본문은 결과에 출력하지 않는다.

## 결과 판정

종료 코드와 JSON `status`를 함께 판정한다.

| 종료 코드 | 상태 | 의미 |
| --- | --- | --- |
| 0 | `compatible` | 위 네 전제가 모두 확인됨 |
| 2 | `blocked` | 하나 이상 불일치. 전환을 중단하고 해당 정렬/시간대 경로를 다시 대조해야 함 |
| 1 | 결과 없음 | 연결·권한·timeout·응답 형식 실패. 확인 불가이며 PASS가 아님 |

`compatible`은 검증된 `C`/`POSIX` byte collation과 정렬 probe·시간대 사전 조건만 통과한 결과다. 소수 probe만으로 임의 locale 전체의 byte 호환성을 추정하지 않는다. 전체 기능, 데이터 무결성, 개인정보 암호화, 백업·복원, MongoDB readiness도 대신하지 않는다. `blocked`일 때 운영 DB collation을 임의 변경하지 않는다. 별도 합성 DB에서 해당 운영 collation을 재현해 SQL의 `ORDER BY`/`LIMIT`과 Mongo 복호화 후 정렬을 기능별로 대조하고, 필요한 코드 변경을 검토한다.

## 전환 순서에서의 위치

1. 운영 DB 백업이나 migration 전에 이 읽기 전용 점검을 실행해 결과 JSON과 실행 시각을 저장한다.
2. `compatible`만 다음 합성 parity·복원 리허설의 입력으로 사용한다.
3. 실제 A/B 백업과 각각의 격리 복원, 키 복구, 최종 데이터 대조를 별도로 완료한다.
4. 최종 freeze 직전에 다시 실행한다. 두 결과가 다르면 전환을 중단한다.

복구 시 이 명령은 데이터를 되돌리지 않는다. 전환을 시작하지 않았으면 기존 PostgreSQL을 그대로 유지한다. 이미 전환 리허설 중이면 원본 PostgreSQL 보존본과 해당 단계의 복구 절차를 사용한다.
