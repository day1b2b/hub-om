# 팀원 파일 가져오기 CLI 실행 리뷰

legacy raw pg `db:import:team-members`를 기본 encrypted PostgreSQL/명시 prepared Mongo repository command로 교체했다. 암호화 로컬 원천, 기존 역할·팀·이름 정규화와 그룹별 비활성화, counts-only dry-run, apply 확인 gate와 전체 transaction을 구현했다. PostgreSQL은 nullable 팀의 기존 중복을 모두 갱신하고 직렬화 재시도를 사용한다. Mongo는 HMAC 자연키 unique와 전용 import guard로 동시 import를 직렬화하며 정상 CLI는 namespace를 준비·수리하지 않는다.

첫 독립 리뷰가 기존 비로컬 PostgreSQL 대상 gate 누락을 P1으로 지적해, loopback 기본 허용과 exact 명시 override를 command 연결 전에 복원하고 단위 검증을 추가했다. 재리뷰는 Mongo partial unique가 제외하는 `sourceTeam=null` legacy 중복 거부를 P2로 찾아, 자연키별 모든 기존 행을 PostgreSQL과 같이 갱신하고 실제 Mongo fixture를 추가했다. 마지막 독립 재리뷰는 잔여 P0~P3 없이 통과했다.

최종 변경 기준 일반 회귀는 1,143 pass/128 opt-in skip/0 fail이다. 실제 PostgreSQL·Mongo 각 1 root pass, focused 5와 동결 원본 60 pass, PostgreSQL·Mongo CLI 및 package launcher, typecheck/build를 통과했다. lint는 오류 0·기존 경고 7이다. 강제 PostgreSQL P2034와 관리자 셀 수정 대 import의 실제 barrier 경합은 별도 미검증이다. 운영 데이터·실제 원천·키·설정은 사용하지 않았다.
