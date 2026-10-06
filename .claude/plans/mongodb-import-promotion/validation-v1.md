# 독립 Validation v1 — Carver

작성자가 제시한 plan-v1과 현재 구현을 읽기 전용으로 대조했다. 구현 시작 전 다음 6개 필수 gap을 닫는다. 이는 구현 PASS가 아니다.

1. Guard: 일반 writer의 삭제와 source-only link는 같은 Mongo 문서를 쓰지 않아 conflict를 보장할 수 없다. guard 참여자·보호하는 관계와 허용 경쟁 결과 집합을 명시한다. 원본 PG가 허용하는 결과를 임의 새 정책으로 막지 않는다.
2. 감사: PG INSERT의 부재/null 구분과 기존 Mongo audit helper의 생략을 대조한다. 모델별 exact 감사 비교와 보완 범위를 명시한다.
3. 금액: 일반 Mongo operation의 소수 셋째 자리 거부와 원본 Number→PG numeric 반올림은 다르다. numericMoney 등 원본을 보존하는 변환/overflow 기준이 필요하다.
4. sequence: 일반 생성/과정명복원의 공유 counter 경합, rollback과 PG 번호소비 차이, high-water/고갈을 검증한다.
5. Calendar: 빈 승격 결과에도 기존 dryRun:false 호출, 기본옵션, commit ACK 확정 후 한 번 실행. revalidate 실패는 commit 이전 오류와 구분한다.
6. port/예산: 정확한 transaction/effect/scope 계약과 roster/retry 포함 60초 범위를 고정한다.

## 최소 수락 기준

- C1 원본PG/currentPG/nativeMongo 독립 대조: 차단순서/문구, summary, 모델전필드, source link, softdelete복원/기존연결, 201행, JSON/숫자/날짜/UUID, nullable/default, 명단/환경.
- C2 저장보호: 실제 쓰기 이후 중간 오류·unique·codec·감사 실패에서 raw 전체 rollback, 암호화·HMAC·오류민감값0. HMAC lookup만 miss되는 키문제를 분리한다.
- C3 경쟁: 제어한 barrier로 동일/별도run, source-only link와 일반삭제, 복원/수정, 과정명복원, sequence 공유writer의 허용 결과를 증명한다. 일괄 once-only를 가정하지 않는다.
- C4 재시도/효과: callback 재실행과 commit ACK 재시도를 분리하고 Calendar가 transaction callback 밖에서 확정commit후한번만실행되는지 확인한다. unknowncommit/반영후 revalidation실패를미반영으로표시하지않는다.
- C5 실제POST: 권한/누락scope 선행차단/PG·외부fallback0/요청감사/Calendar기본옵션과실패격리/고정오류exact·민감suffix검증.
- C6 준비/한계: validator/index/공유counter/guard 미준비·자동수리0, sequence고갈/기한/scan상한, 재시도예산비초기화. 전체회귀/독립수락/소유정리/총괄원격SHA를완료근거로남긴다.

HTTP400 또는 최종행수만으로 통과시키지 않는다. 독립 원본은 신규 core를 공유하지 않으며 UUID/시각 정규화는 참조/실호출구간 확인 후에만 허용한다. 실제 장애와 주입·로컬 합성과 실제 운영을 구분한다.
