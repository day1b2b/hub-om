# MongoDB 내부 운영 runtime scope

health, 관리자 코치 JSON export, 요청·개인정보 접근 감사, 활동 보존 정리를 하나의 명시 Mongo shadow runtime으로 조립한다. 이 scope는 개별 저장소 검증 다음 단계의 내부 운영 수직 단위이며 생산 backend selector가 아니다.

## 포함 포트

- `databaseHealth`
- `adminBackup`
- `requestActivity`
- `coachPrivateAccessLog` — `requestActivity`와 같은 audit repository 객체
- `activityPrune`

모든 포트는 호출자가 빌려준 같은 `MongoClient`, database, namespace를 사용한다. runtime은 client를 닫지 않는다. 관리자 backup은 기존 코치 JSON 다운로드 계약이며 35개 모델 복구 백업이 아니다.

## 준비와 재실행

`prepareMongoOperationalRuntime`은 해당 prefix의 collection이 하나도 없는 새 shadow namespace에서만 validator·index·guard를 준비한다.

- namespace가 비어 있으면 기존 request audit → admin backup → activity prune 준비 함수를 순서대로 실행한다.
- namespace가 비어 있지 않으면 어떤 준비·수리·삭제도 하지 않고 `openMongoOperationalRuntime`의 전체 readiness만 실행한다.
- 부분 준비, 오래된 정책, 잘못된 validator/index/guard는 고정 오류로 실패한다. 같은 namespace를 자동 복구하지 않는다.
- 합성 검증에서는 새 run ID/namespace로 다시 준비한다. 기존 namespace 삭제는 소유한 합성 DB 전체 정리에서만 수행한다.

`openMongoOperationalRuntime`은 준비 작업을 하지 않는다. 완전히 준비된 scope만 열며, client lifecycle은 호출자 책임이다.

## scope 안전성

`runtime.run`은 전체 작업 동안 repository scope를 잠근다. 작업 안에서 다른 runtime으로 중첩 전환하면 기존 `CALENDAR_SCOPE_MISMATCH`로 실패한다. 서로 독립된 최상위 비동기 작업은 각자 명시한 namespace에서 병렬 실행할 수 있다.

scope는 저장소 선택만 바꾸며 인증·권한을 부여하지 않는다. 실제 API의 기존 관리자/PII 권한 검사는 계속 호출부 책임이다.

## 확인한 범위

MongoDB 8.0.30 단일 replica set과 합성 키·데이터에서 다음을 확인했다.

- 빈 namespace 준비 후 다섯 포트 open
- 요청 감사 암호화와 health·backup·prune 실행
- 준비된 namespace 재실행 시 create/index/collMod/insert/update/delete 0
- 부분 namespace 실패 시 자동 수리·삭제·쓰기 0
- 두 namespace 병렬 감사 격리와 중첩 전환 차단
- 저장 문서에 합성 이메일·이름 평문 비노출과 조립 오류의 고정 코드 처리
- borrowed client를 runtime이 닫지 않음

실제 운영 namespace·권한·부하, Next 전체 요청 조립, 활성 CLI/예약 작업, production selector·배포, A/B 백업·복원은 확인하지 않았다.
