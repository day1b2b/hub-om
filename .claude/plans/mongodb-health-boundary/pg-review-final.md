**PG 원본/current 증거를 독립 수락합니다. 이전 socket 종료 관찰 문제도 종결 가능합니다.**

[pg-fixed.log](/private/tmp/hub-om-health-20260930/logs/pg-fixed.log)의 12개 관찰을 확인했습니다.

- 성공 양쪽: 연결 1회·실제 `SELECT 1` 1회·200 전체 응답 일치.
- 연결 불가 양쪽: 연결 시도 1회·query0·503 고정 응답.
- 키/scope 8사례: 연결·query0. development 원본 오류와 current 고정 오류의 의도적 차이 일치.
- 모든 관찰에서 위반0·실제 NextResponse·headers·dynamic 일치.
- 연결을 시도한 4사례 모두 `tracked/end/streamClose=1/1/1`. worker는 실제 close 이벤트를 최대 3초 기다리며, timeout을 성공으로 처리하지 않습니다.
- 원본 9개와 지원 파일 4개의 기록 hash를 기준 Git 객체와 대조해 불일치0을 확인했습니다.

root **1 PASS / 0 fail / 0 skip**입니다. 현재 fixture에는 `this` 타입 보완도 보이지만 typecheck 최종 exit0은 별도 확정이 필요합니다. 이번 수락은 PG 경계에 한정하며 파일 변경·DB·테스트 실행은 하지 않았습니다.
