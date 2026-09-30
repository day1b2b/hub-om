# 독립 리뷰와 검증 보완

2026-09-30, 기준093f585. 제품 3파일에는 현재 독립 코드 리뷰의 구체 결함이 없다. 아래 검증 공백의 수정·재실행·재수락 전에는 전체 수락하지 않는다.

## H1 — sentinel과 개인정보 검출 표식 충돌

Carver P2 및 handler 첫 실행으로 재현. Company/Course의 기존 operational sentinel 이름에 PRIVATE 표식을 넣고 전체 저장 데이터에서 그 표식의 부재를 요구하여 반드시 실패했다. 공개 합성 업무 기준값을 별도 표식으로 분리한다. 기존 전체 업무 raw 불변·개인정보 marker 검출·토큰/오류 canary 검사는 유지한다. 이는 실제 제품 노출을 수정한 것이 아니며 기존 개인정보 분류를 암호화 제외 승인으로 해석하지 않는다. snapshot 회사/과정 문자열의 전체 전환 전 개인정보 분류 검토는 별도 남는다.

## H2 — HTTP 검증 오류가 route catch에 삼켜짐

Carver P2. fetch mock이 URL/options/script 검사 후에만 호출을 기록하면 잘못된 추가 호출의 예외가 generic400으로 바뀌어 실패 테스트가 통과할 수 있다. 모든 진입 시도를 먼저 기록하고 계약 위반을 별도 보존하여 actual POST 종료·시나리오 종료 시 위반0을 확인한다. 의도적 transport failure는 계약 위반 수집과 분리한다. 같은 검증 경로에 options 오류·추가 호출 음성대조를 넣는다.

Sagan이 소유한 handler2파일 수정 완료, handlers-fixed.log의 handler15 통과 및 Carver 재수락 완료. 제품 코드 변경0.

## P1 — 전체 저장 ID 집합 대조

Parfit P2. whole tuple의 각 요청별 값은 대조했지만 참조하지 않은 추가 감사 행이나 native orphan source row를 전체 ledger만으로 잡지 못한다. 검증한 성공 run ID·각 run의 row ID·모든 요청 header의 audit ID를 누적하고 마지막 recovery 뒤 실제 전체 배열과 개수·유일성·양방향 일치를 검사한다. A/B도 DB별로 대조한다. 기대 ID를 마지막 전체 조회에서 만들지 않는다.

동일 비교 함수에 정상 복사본, 새 audit ID 추가, 없는 부모를 가진 source row 추가, 같은 개수 ID 교체 음성대조를 적용한다. Volta의 parity 파일만 보완하며 동결77파일은 변경하지 않는다. 제품 정책·실제 DB 오염·추가 장애 기능이 필요하지 않다.

첫 parity 실행 root1 PASS/각46 ledger 전체 동등은 보존하되 이 공백을 닫은 최종 실행을 수락 근거로 사용한다. 검증 강화 후 영향 받은 handler/parity 및 타입·정적 검사만 반복한다. 제품 및 다른 테스트에 변경이 없으면 이미 통과한 HTTP46/native17/일반1017·89skip/build는 그대로 근거로 연결한다.

## 최종 폐쇄

H1/H2: handler15 PASS/0skip/0fail exit0, Carver 실행 재수락. P1: 각47ledger·전집합37/438/42 및 음성대조8, A/B2/4/2·2/4/3 및 각8, root1 PASS/0skip/0fail exit0, Parfit 실행 재수락. 제품3파일 변경0, 최종typecheck/lint exit0·기존7warning. 세 지적은 해소했다.
