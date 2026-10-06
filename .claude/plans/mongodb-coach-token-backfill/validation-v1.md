# 독립 critic 기준 v1

Anscombe read-only 판정: 계획 적합, 중대한 제품 미결정 없음.

- B1 기존직접PG API/CLI 인자유지. 기본dryrun, unknown/conflicting 인자는env/DB전거부. apply는backup/maintenance플래그필요하나실제점검수행을뜻하지않음.
- B2 context없음PG, 명시누락/Mongo오류fallback금지. shadow/gate, open무DDL/prepare분리.
- B3 public/coaches·completed·정확source/rowKey. startedAt desc/archive iddesc. 최신null건너뛰고빈string유효. scalar/array/null 제외. 필요한nonstring은고정오류, 이미선택한키의오래된nonstring은실패아님.
- B4 coach/archive250경계·startedAt동률페이지·다수최신null·BSON짧은batch/noEOF오인. 전체토큰map금지.
- B5 dryrun업무/시각/암호문/감사/guard무변경. archived=선택값있는코치수, missing=그중기존null, changed=원문차이, updated=적용수.
- B6 삭제/비활성포함, 관련없는필드보존, 달라진token만암호문/HMAC/updatedAt갱신. 재실행changed/updated0·추가감사/재암호화없음.
- B7 후행page쓰기/감사/unique/키/변조/timeout전체rollback. transientretry집계초기화·중복감사없음·retry포함120초전체한도. 충돌은임시token/재생성/순서변경으로회피하지않음(빈token도unique).
- B8 activitycontext있으면redacted감사동일tx, 없으면감사없음. stdout/stderr/오류/감사에원문없음. HMAC후원문확인.
- B9 실제격리PG/Mongo 고정fixture summary·선택token·불변·rollback, 독립기대값. CLI→service·noPG.
- B10 필수suite실행·일반/type/lint/build·영향Mongo회귀·독립리뷰. 문서/commit/push/SHA/자원정리별도.

maintenance는외부사전조건. snapshot이모든writer를직렬화한다고과장하지않는다. 실제운영/Atlas/키/schema/dependency변경없음. 과거mock결과는이번실DB검증을대체하지않음.
