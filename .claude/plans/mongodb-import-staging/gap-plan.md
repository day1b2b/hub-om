# 독립 실행 검토의 검증 공백 보완

Volta는 실제 PG14/native30/handler15와 일반921·68skip, lint/build 로그를 검토했다. 제품 P0–P2 결함은 발견하지 않았지만 V1/V3/V5의 두 P2 검증 공백 때문에 전체 수락은 보류했다. V2/V4/V6/V7/V8은 명시된 주입 범위 내 수락했다.

1. handler allowlist 부정 사례: 정확히 허용된 문구에 민감 suffix를 붙인 오류와 미등록 한국어 오류를 실제 POST catch까지 전달한다. 두 경우 모두 generic이고 응답/console/private marker 노출0이어야 한다. startsWith/한국어 판별로 대체하면 실패해야 한다.
2. scope 없는 기본 PG 명단·강사: 실제 PG 연결이 성공한 상태에서 local/notion 환경에도 PG roster/강사 데이터에 따라 검증되는지 확인한다. PG adapter 생성 실패만으로 검증하지 않는다. 원본/현재 동등성 및 외부 fallback0을 확인한다.

제품 변경 없이 해당 테스트만 보완하고 영향 suite·typecheck/lint를 다시 실행한다. 현재 전체Mongo 회귀는 별도 진행 중이며 보완 파일을 로드한 시점을 확인해 중복 수치/최종source 증거를 혼동하지 않는다. 미변경 product 전체회귀를 불필요 반복하지 않는다. 독립 reviewer가 최종 보완을 수락한 뒤 정리·문서·통합한다.
