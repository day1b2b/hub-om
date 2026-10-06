# 코치 DB 가져오기 CLI Mongo 경계

## 범위

`db:import:coach`는 별도 coach-db PostgreSQL의 9개 테이블을 읽어 코치, 비공개 프로필, 태그, 일정, 접속 기록, 투입, 투입 일정을 갱신한다. 대상 기본값은 암호화 PostgreSQL이며, exact `--backend=mongodb-shadow`만 이미 준비된 Mongo shadow namespace를 사용한다. 생산 기본 backend는 바뀌지 않는다.

```bash
npm run db:import:coach -- --dry-run
npm run db:import:coach -- --apply
npm run db:import:coach -- --backend=mongodb-shadow --dry-run
```

## 안전 계약

- source 연결은 session 기본값과 transaction 모두 `REPEATABLE READ READ ONLY`다. 연결 5초, statement/idle 120초 제한을 둔다.
- dry-run은 source snapshot과 대상 운영 후보를 읽어 예상 건수만 계산하며 import run이나 업무 행을 쓰지 않는다.
- apply는 대상 전체 쓰기와 `CoachImportRun`을 한 transaction으로 확정한다. 실패하면 일부 코치·태그·일정·run을 남기지 않는다.
- 코치는 암호화된 `sourceCoachId` HMAC 조회로 재사용한다. 투입과 투입 일정도 암호화 source ID 조회를 사용하므로 재실행 때 중복을 만들지 않는다.
- 기존 수동 관리값인 표시 순서, 사번, Notion 번호·페이지, 투입의 채용 담당 ID·리뷰 경고 시각은 덮어쓰지 않는다. 태그는 원본과 같이 추가만 하며 기존 태그를 제거하지 않는다.
- 부모 코치나 투입이 없는 일정·기록은 끊어진 참조를 만들지 않고 오류 건수로 집계한다. 매칭되지 않은 투입은 기존 operation 연결도 `null`로 갱신한다.
- Mongo apply는 catalog guard와 영향받는 기존·신규 코치 scheduling guard를 정렬해 잠근다. 고유 인덱스 경합은 transaction 전체를 재시도한다.
- 알 수 없는 인자와 `--dry-run`/`--apply` 혼용을 거부한다. 오류 원문, 연결 문자열, source ID, 개인정보는 CLI 출력에 포함하지 않는다.
- Mongo CLI는 collection·validator·index를 생성하거나 수리하지 않는다. 별도 준비 단계가 끝난 exact namespace만 열며 부분 준비 상태는 쓰기 전에 거부한다.

## 운영 적용·복구 순서

이 절차는 아직 실행하지 않았다. 실제 적용 전 별도 A/B 백업과 각 복원 성공, 운영 PostgreSQL runtime preflight, 대상 Mongo 용량·transaction 시간 측정이 선행돼야 한다.

1. import와 관련 동기화 작업을 점검 모드로 전환하고 신규 쓰기를 정지한다.
2. source와 현재 target의 독립 백업을 만들고 각각 격리 환경에 복원해 무결성을 확인한다.
3. 새 shadow namespace를 준비하고 validator·index·guard readiness를 확인한다. 기존 namespace를 자동 삭제·수리하지 않는다.
4. dry-run 건수와 검증 CLI 결과를 기록한 뒤 apply를 한 번 실행한다.
5. 재실행 결과, PG/Mongo parity, 암호문·HMAC, 고유성, operation 매칭, import run을 대조한다.
6. 실패 또는 commit 응답 불명확 시 성공으로 간주하지 않는다. 기존 생산 PostgreSQL을 유지하고 검증 CLI로 target 상태를 확인한다. 새 namespace는 격리 보존하며 삭제하지 않는다.

## 검증과 한계

합성 PostgreSQL 17 source/target과 MongoDB 8.0.30 replica set에서 source 9개 테이블 읽기, dry-run 무쓰기, apply·재실행, 기존 수동 필드와 추가 태그 보존, operation 매칭, 누락 부모 오류 집계, 암호문/HMAC, 중복 access token 후반 실패 전체 rollback을 확인했다. 일반 회귀는 1,138 pass/126 opt-in skip/0 fail이며 typecheck와 build를 통과했다.

실제 운영 source, Atlas, 운영 키, 실제 이름·식별자, 외부 동기화에는 접근하지 않았다. 현재 구현은 기존 스크립트처럼 source 결과를 메모리에 고정한 뒤 대상 transaction에 전달한다. Mongo apply 전 HMAC 키 불일치 차단을 위해 기존 Coach, CoachEngagement, CoachEngagementSchedule을 각각 전체 인증하며, 모델별 20,000행·32MiB·15초 한도를 넘으면 쓰기 없이 실패한다. 실제 데이터 규모의 source 메모리와 이 인증 한도, Mongo transaction 용량·시간은 이전 리허설에서 측정해야 한다. 이 단위는 가져오기 저장 경계이며 실제 데이터 복사·복원·최종 전환이나 `dev → main` 완료를 뜻하지 않는다.

두 동시 import의 실제 완료와 중복 방지는 확인했지만 테스트가 직렬화 충돌 발생 자체를 강제하지는 않는다. source의 read-only/repeatable 설정은 실제 연결에서 확인했지만 조회 사이 외부 변경 barrier는 두지 않았다. 실제 script entry의 환경 로딩·프로세스 종료는 합성 runtime/command 테스트로만 확인했다. 이 세 항목은 운영 리허설 전 추가 검증 대상이며 현재 PASS 범위로 계산하지 않는다.
