# Mongo snapshot 경쟁 사전 확인
2026-09-29 Node24.19/Mongo8.0.30 별도 loopback27819 replica omassignment20260929, 임시 합성 전용.
엔진 수준 3문서 모형, 실제 앱 함수 수락 검증은 아님.
초기 request=X,S1=Y,S2=X. A→X와B→Y가동일snapshot읽음. B가request+S2를Y로commit한뒤A가S1만X로commit. 모두성공해서requestY/S1X/S2Y.
A→B직렬이면전체Y,B→A직렬이면전체X이므로어떤직렬순서에도해당하지않음. 조건에따라변경행만쓰는snapshot구현은안전하지않음.
실스크립트/log: /private/tmp/hub-om-om-assignment-20260929/snapshot-spike.cjs, logs/snapshot-spike.log. exit0. 자체DBdrop완료. 실제앱계약/PG충돌/서명재시도검증을대신하지않는다.
신규업무schema없이요청공통쓰기 또는 내부coordination방식의필요성검토근거. 독립architect가writer/cycle범위분석중.

동일 3행 모형을 실제 PostgreSQL17.9 Serializable에서 양쪽독립connection으로실행. Bcommit후Aupdate가 SQLSTATE40001으로거부됨(exit0). 자체table삭제확인. pg-snapshot-spike.cjs 및logs/pg-snapshot-spike.log. 앱전체동등성수락검증은여전히별도.
