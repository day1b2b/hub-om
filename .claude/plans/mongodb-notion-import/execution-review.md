# 실행 검토 — Notion 가져오기

2026-09-30. 기준093f585b444197c6b0442a3880469fd0d6a0502b. 명시 Notion source→기존 staging의 개발·합성 검증을 수락한다. 전체 앱/운영 데이터 이전 수락이 아니다. 총괄 원격 통합은 integration-review.md의 후속 증거를 따른다.

## 구현

제품 변경은 source 계약/selector/error helper, context의 타입 슬롯, 기존 actual POST 3파일이다. 원본 reader/parser/writer/codec/스키마/의존성/권한/Calendar 구현은 변경하지 않았다. 명시 scope의 필수 port를 원천 호출 전에 확인하고, 허용한 고정 오류2개 외 원문 예외 공개를 막았다. 운영 기본PG 및 서버 공용 token/env 선택은 유지했다.

## 실행 결과

Node24.19.0, env-i, PostgreSQL17.9 C locale, MongoDB8.0.30 새 replica/dbpath·합성 데이터·임시 키만 사용했다.

| 검사 | 결과 | 로그 |
| --- | --- | --- |
| 원본 PG 관찰 gate | root1 PASS/0skip/0fail, 내부22관찰 | pg-gate.log |
| 실제 HTTP reader | 46 PASS/0skip/0fail | source-http.log |
| 최종 originalPG/currentPG/native whole parity | root1 PASS/0skip/0fail, 각47ledger 전체 동등 | parity-fixed.log |
| 실제 handler/auth/env/isolation/error | 15 PASS/0skip/0fail | handlers-fixed.log |
| native transaction/abort/retry/ACK/audit | 17 PASS/0skip/0fail | transactions.log |
| 일반 전체 | 1017 PASS/89 opt-in skip/0fail | general.log |
| 최종 타입 검사 | exit0 | typecheck-final.log |
| 최종 lint | exit0, error0/기존warning7 | lint-final.log |
| build | exit0 | build.log |

모든 표의 명령 종료코드는0이다. 내부 ledger, 일반 검사에 포함된 HTTP, DB 묶음의 중복 건수는 합산하지 않는다. 전체 일반 검사와 이번 영향 DB 검사를 실행했으며, 전체 Mongo 과거 묶음을 재실행한 것은 아니다. 일반 opt-in skip을 DB 검증 성공으로 세지 않는다. 일반 검사 후 변경은 테스트 강화뿐이다. 최종 handler/parity와 타입/lint를 재실행했고 제품3파일 hash는 그대로였다. 단일 최종 SHA에서 모든 명령을 다시 실행했다고 표현하지 않는다.

## 독립성·완전성

기준 commit의 동결77파일 bytes와 실제 실행closure28을 검사했다. loader/query factory/repository/presenter 변조와 current 탈출 음성대조를 실행했다. 기대 업무/DTO는 제품 parser/presenter로 생성하지 않았다. 최종 parity는 원본/현재PG/Mongo 각 run37/source438/audit42 전집합과 음성대조8개를 확인했다. 별도 native A/B는 A2/4/2, B2/4/3 전집합과 각 음성대조8개다. 경합은 동일 Notion2행/2page의 commit 전 양쪽조회·첫commit 후 둘째조회 두 일정이다.

시각은 실제 호출 구간을 검증하고 ID/FK와 함께 정규화한다. PG startedAt이 app finishedAt보다 뒤일 수 있는 관찰을 새 순서 규칙으로 바꾸지 않았다. summary의 UUID 동점 업무순서를 backend간 동일하다고 주장하지 않는다.

## 실패와 독립 리뷰

첫 handler는 PRIVATE 표식을 기존 비암호화 업무 sentinel에 사용한 fixture 오류로 실패했다. Carver의 두 P2(표식 분리, fetch 검증 오류 삼킴)는 Sagan 수정→handler15 재실행→Carver 독립재수락으로 닫았다. raw 누출·업무모델 전체 불변은 유지했다.

첫 parity는 통과했지만 Parfit이 참조되지 않은 추가 audit/orphan row 공백을 지적했다. Volta가 요청에서 검증한 ID 누적·마지막 recovery 후 전집합 대조·동일 비교기 음성대조를 추가했고, 최종47ledger 재실행 후 Parfit이 수락했다. Confucius는 제품/transaction17 및 초기whole parity를 독립 검토했다. 자세한 지적은 gap-review.md, 최종 정합은 alignment-review.md를 따른다.

## 재사용과 한계

Sheets 통합093f585의 source-final1050파일을 다시 대조했다. 이번 기존파일 차이는 route/context2개뿐이며 공통 store/codec/정책/명단/parser/조회/스키마/의존성/loader는 동일하다. 이전 증거45파일 hash도 일치했다. 재사용 대상은 staging의 HMAC/key/companion/cipher/readiness/scan20k·32MiB/저장60초 하위 행렬이다. 새 notion sourceType HMAC, 실제HTTP→POST→native 연결·pagination1회·실패/권한/격리는 이번에 새로 실행했다. Calendar runtime 불변으로 일반 scope3 회귀를 사용했고 전체24를 반복하지 않았다.

실 Notion/Google/OAuth/UI, 실제 네트워크 ACK 손실, 운영 collation, 운영 데이터/백업/복원은 미검증이다. ACK 테스트는 실제 native commit에 주입한 응답 오류이며 실제 네트워크 장애 재현이 아니다. 전체 snapshot의 회사/과정 개인정보 분류도 별도 필수 검토다. 승인된 조회 복호화 값과 저장 상태의 비노출을 구별한다.

## 자원 정리

소유PG35표 데이터0/다른client0, Mongo system DB만/소유작업0을 확인했다. 해당 소유 프로세스2개 종료·포트56752/27852 닫힘·소유pg/mongo dbpath 제거 완료. borrowed Mongo binary는 보존했다. 운영/원본 workspace/main/dev/자동화 변경0. durable 증거30파일 및 source1063파일 hash는 execution-manifest.md에 연결한다.
