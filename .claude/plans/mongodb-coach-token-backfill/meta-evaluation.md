# 메타검토

Gibbs read-only: 조건부 적합, 제품 미결정 없음.

보완: 정확 source는 archive row의 tableSchema/public·tableName/coaches·rowKey=sourceCoachId와 snapshot completed뿐이다. snapshot.sourceDatabase/sourceSchema 새필터는금지한다. dryrun은중복token도summary를반환하며apply가능보증이아니다. unique/쓰기/감사rollback은apply기준이다. timeout오류주입과실제deadline/retry전체120초증거를구별한다. CLI성공counts/실패fixed+exit1·소유PG연결정리를확인하며직접주입PG함수는호출자연결을종료하지않는다.
