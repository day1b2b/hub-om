# OM 전체 배정 실행 검토

새 실행: 2026-09-30, 기준74e1970. env-i/Node24.19.0/PostgreSQL17.9/Mongo8.0.30 replica set/임시 random PII 키. clone에 dotenv 파일 없음. 운영 DB/실 원천 접근 없음.
완료 로그 사본: `/Users/ga/.cache/hub-om-verification/20260930-om-assignment`.

|검사|결과·로그|
|--|--|
|일반 테스트|917 pass /64 skip /0 fail, unit.log. DB opt-in suite는 아래 별도 실행|
|전체 Mongo 회귀|684 pass /0 skip /0 fail, mongo-bundle-fixed.log. 기존 mock4 포함, 아래 보완 검사와 중복 합산 금지|
|원본PG/신규PG/Mongo 대조|56 pass /0 skip /0 fail, pg-parity-final.log. 45migration, 동일 초기서명, 업무/감사/암호화/원복, 실제 PG 배정↔복원 경합4개 포함|
|추가 native 검증 보완|25 pass /0 skip /0 fail, native-review.log. full 묶음의 기본17개를 포함하며 추가8개는 재시도/시간상한/준비거부|
|추가 실제 API 검증 보완|20 pass /0 skip /0 fail, handlers-review-fixed.log. full의 기본17개를 포함하며 추가3개는 callback/commit 재시도·미확정 결과의 후속 호출|
|실제 다른 writer/복원/metadata 경합|41 pass, 전체684에 포함. 8개 writer 양방향·noop·phantom/retention 의미 검증|
|UI 단위|5 pass /0 skip /0 fail, ui.log. 대괄호 경로는 직접 실행하여 누락 방지|
|typecheck/build|async 제품 보완 후 전체 PASS. 후속 oracle/test 보완도 추가 typecheck PASS|
|lint|전체0 error/기존7 warning. 이후 변경한 검증 파일의 별도 lint도0|

## 수락 기준 연결
- V01–08: 원본 SHA 고정, 동일 DTO/서명/순서/null·undefined, 정확한 생성근거/상태 전이, PG 실제 trigger 및 Mongo 변경감사, 저장 평문 비노출/독립 HMAC, 실제 DB 제약 실패 원복.
- V09–12: 실제 replica session 경합, 두 배정과 과정명 복원 역의존, 8종 writer의 중첩/단방향 직렬 순서, snapshot 전후 metadata 변화, 실제 HTTP retention, 102회차의 preview/confirm getMore0와 마지막 페이지 중복 거부.
- V13: native guard 최초 경쟁과 반복 충돌. 실제684 로그의112=3/11000=0. 연속11000 상한5회/누적16s+16s deadline/업무11000 비재시도는 명시적 주입. 실제 validator/index/guard 변조 및 DDL·데이터 불변. 비복제셋 hello는 응답 주입이며 실제 standalone 연결 검증이 아니다.
- V14–16: 실제 route/auth guard/Activity wrapper, 명단 유일성/override/재권한검사, 필수 port 선행 거부/PG·파일·fetch fallback0, 커밋 후에만 Calendar/Slack, 실패 로그 민감값0. 실제 commit 뒤 ACK 주입으로 HTTP500에도 이미 커밋됐을 수 있음을 확인한다.
- V17: 기존 AssignForm 단위 계약 유지. browser E2E는 미검증.
- V18: 검증/실패보완/독립 판정/정리/전체 diff 검사/원격 상태는 이 문서와 independent-final-review/integration-review를 함께 따른다.

## 실패·수정과 한계
초기 PG39 pass/17 fail 및44 pass/12 fail은 oracle의 runtimeDMMF enum/list 정보 누락과 Mongo 입력의 동기 throw 차이였다. enum/list는 schema 독립 판독으로 보완했고 제품 public 두 메서드는 async 계약으로 맞췄다. 비교 항목이나 원복 조건을 삭제하지 않았다. 최초 fullMongo5 pass/44 skip는 검증 스크립트 PATH 오류였고 수락에서 제외했다. 새 handler 첫17 pass/3 fail은 같은 HTTP의 후속 읽기 transaction까지 주입기가 세던 문제이며, 배정 guard lsid/ClientSession만 관찰하도록 수정했다. 모든 해당 재검증은 위 최종 결과 기준이다.

full684 뒤의 추가 변경은 검증 코드/문서뿐이다. 보완 검사는 겹침을 합산하지 않으며 제품 코드의 새 변경 없이 전체 묶음을 불필요하게 반복하지 않는다. 생성 시각 정규화는 먼저 변경/불변·대상/중복·호출 시간 범위(±2초)를 검사한다. 엄밀한 밀리초 선후 보장으로 확대하지 않는다.

운영 처리량, 실제 네트워크 단절/로그인/Calendar·Slack 전송, 브라우저 E2E, 실제 데이터 복사·복원·최종전환은 미검증이다. 기본 생산 backend는 PostgreSQL이다. 최신 dev307f52f의 두 실질 변경 통합은 이번 제품의 수락 후 별도 후속 작업으로 검증한다.

## 합성 자원 정리
모든 DB 검사 종료 후 cleanup exit0. 현재 PG schema empty, Mongo 사용자 DB0을 확인하고 소유 서버 정상 종료, 두 dbpath 삭제, loopback56719/27819 닫힘 확인. 사용자 PG18 서비스는 건드리지 않았다. 마지막 handler lint는 의도적인 mock의 this identity 저장을 no-this-alias가 거절하여 사유를 명시한 한 줄 예외 주석을 추가했고 file lint0을 확인했다. 주석 외 실행 코드 변경 없음.
