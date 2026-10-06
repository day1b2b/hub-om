# 코치 데이터 검증 CLI 실행 리뷰

legacy raw pg `db:verify:coach-data`를 기본 암호화 PostgreSQL/명시 prepared Mongo shadow repository로 교체했다. 두 target은 한 snapshot에서 건수·최근 import·최근 아카이브를 읽으며 PostgreSQL target과 선택적 coach-db source를 read-only로 강제한다. Mongo는 준비 상태만 확인하고 부분 namespace를 생성·수리하지 않는다. 출력은 건수·상태·완료 시각으로 제한하고 식별자·개인정보·오류 원문을 제거했다.

일반 회귀 1,131 pass/121 opt-in skip/0 fail, 실제 MongoDB 8.0.30 1 pass, 실제 합성 PostgreSQL 17 target/source 1 pass, 동일 fixture의 PostgreSQL↔Mongo 전체 보고서 parity 1 pass, focused 2 pass, typecheck/build 통과, lint 오류 0·기존 경고 7이다. parity와 PG 검증을 서로 다른 전용 DB에서 동시에 실행해 2 pass/0 fail을 확인했다. 독립 리뷰에서 발견한 전용 DB 안전성, 최신 시각 동률, 아카이브 부재 표시, source 연결 제한, 실제 parity·CLI 실패·독립 정리 검증 공백을 모두 보완했으며 최종 재검토에서 잔여 P0–P3 없음으로 수락됐다. 운영 데이터·실제 원천·운영 키·설정은 검증하지 않았다.
