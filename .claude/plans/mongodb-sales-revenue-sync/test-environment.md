# 격리 검증 환경

2026-09-29 신규 root `/private/tmp/hub-om-sales-revenue-20260929`, Node24.19.0/PG17.9/Mongo8.0.30. env-i로이전환경/운영키·원천값 미상속. PG loopback56699 db sales_revenue_parity role synthetic, Mongo loopback27799 replSet salesrevenue20260929. 기존 root DB 경로 재사용없음, 시작전리스너없음, setup exit0. run.sh/logs 보존, cleanup은cmdLineOpts/replSet/dbprefix/정상종료 확인후소유dbpath만제거한다.

numeric probe: 실제45migration+Prisma기본wrapper 실행. 초기probe는PII_ACTIVE_KEY_ID누락으로exit1(운영키안읽음). 합성random키를코드내생성해보완후numeric-probe-fixed.log exit0. NaN/±Infinity는실SQL `revenue IS NULL`로확인, Decimal반올림/range는decision-rules. 제품코드 실행검증과구분하는 조사증거다.

Course/Company에는현재privacy정책의암호화대상필드가없다. 이업무의개인정보는SalesRevenueSyncLog.triggeredBy/detail, ActivityChange/ActivityRequest의actor/changes이다. 공개업무행/빈DB로올바른암호화키라고증명하지않는다. 읽지않는이전synclog의키손상을업무차단계약으로새로추가하지않음. 실행시필수키누락및읽는암호문인증실패/원문비노출은실제경계에맞춰시험한다.
