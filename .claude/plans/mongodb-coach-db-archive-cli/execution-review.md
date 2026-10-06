# 코치 DB 아카이브 CLI 실행 리뷰

legacy raw pg 아카이브를 read-only source와 기본 encrypted PostgreSQL/명시 prepared Mongo target 경계로 교체했다. rowKey/rowData 평문 저장과 연결 URL·원문 오류 노출을 제거하고 source snapshot, target 원자성, 중복 키 실패, 반복 apply를 검증한다.

합성 실제 PostgreSQL과 Mongo 검증은 각각 1 pass, command/CLI는 3 pass다. 일반 회귀는 1,134 pass/123 opt-in skip/0 fail이며 typecheck/build 통과, lint 오류 0·기존 경고 7이다. 독립 리뷰의 환경 로딩 순서, 대형 배열 전개, PG 연결 종료, 후반 배치 rollback 증거, cleanup 실패 은폐 지적을 모두 보완했고 최종 잔여 P0–P3 없음으로 수락됐다. 운영 source·Atlas·키·설정은 검증하지 않았다.
