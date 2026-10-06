# 검증 기준 v2

Anscombe critic의 메타반영 최종기준. 설계적합, 실행은별도판정.

| ID | 필수결과 |
| --- | --- |
| B1 | 기존CLI/PG호환, 기본dryrun·인자선검증·apply확인, counts성공/fixed실패exit1, CLI소유PG정리/직접주입연결유지 |
| B2 | 기본PG·명시scope누락/Mongo오류fallback금지·shadowgate·open무DDL |
| B3 | archive tableSchema public/tableName coaches/rowKey정확/snapshot completed. snapshot sourceDatabase/sourceSchema추가필터금지. startedAt desc/archive iddesc. 최신nonnullstring/빈string유효, rowData null/scalar/array제외. 필요한nonstring실패/이미선택한키과거nonstring무시 |
| B4 | 250초과·동률·연속null·BSON짧은batch누락없음. 복합paging·현재coachpage내tokenmap |
| B5 | dryrun데이터/시각/암호문/감사/guard불변, 중복token도요약. archived/missing/changed유지updated0 |
| B6 | apply삭제/비활성포함, 달라진token만암호문/HMAC/updatedAt갱신·다른필드보존. 재실행changed/updated0·추가감사없음 |
| B7 | applyunique/쓰기/감사실패전체rollback. retry집계초기화/중복감사없음. timeout주입과실deadline/retry전체120초증거구분 |
| B8 | HMAC후원문확인. context있으면redacted감사동일tx/없으면무감사. 키/변조오류비은폐·원문비노출 |
| B9 | 실제PG/Mongo고정fixture·독립기대값·summary/token/불변/rollback. CLI출력/exit/수명·직접PG연결재사용·Mongo무PG |
| B10 | 전체일반/type/lint/build·영향Mongo·독립리뷰. 문서/push/SHA/합성정리는별도판정 |

PASS/FAIL/NOTRUN·skip구별. maintenance는외부사전조건이며자동확인/모든writer직렬화아님. 운영적용/schema/dependency변경제외.
