# 강사 Notion 동기화: Clarify

기준3dfa0253977bec35c48723b2c30d07475464368d, feature/20260929-mongodb-instructor-notion-sync. 격리clone 재사용, fetch후총괄동일/dev307f52f 확인, 시작clean. 사용자 계속개발·검증·feature총괄통합 승인 유지.

목표: GET미리보기/POST반영의 원천/저장 경계를분리하고 생산PG유지/명시Mongo 합성검증. NO우선, 없는경우 notionNo:null 이름exact legacy행만 연결; 이름변경,conditionalnotionId,recruitAvoid OR,OM수동displayName/notes/partnerId보존. 페이지순서/행별부분실패/집계/재실행보존. 오류는고정코드로정제하고인가된미리보기변경내역의개인값과구별.

성공: 원본PG oracle/newPG/Mongo 결과·저장값대조, 실제handler권한과누락scope 원천/PG0접근, dryrun업무/guard무쓰기, 실Mongo manualwriter/동기화 identity경합·감사rollback·암호화검증. 전체test/type/lint/build/실Mongo묶음/독립검토/소유자원정리/commitpush/통합SHA/coverage갱신.

금지: 운영/Atlas/실Notion/Google·실PII·운영키/env/권한/배포/main/dev/원본workspace변경; 새dependency/schema/businessfield/삭제정책. 실제복사/복원/전환은미완료. 자동화설정변경없음.

Sizing R1–R6 각1=6, Level3: 다중경계/원자성/legacy모호성/기존동작위험/oracle의미검증/인계. 열린사용자결정없음. 복수legacy같은이름의findFirst순서는원본에orderBy없어미정이며임의통합/삭제하지않음.
