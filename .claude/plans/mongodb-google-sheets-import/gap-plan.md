# 검증 공백 보완 — V6

Carver 독립 실행증거 검토에서 제품 결함은 발견하지 않았다. V2 및 V3/V4 native범위는 수락했고 V6 테스트 공백2개는 필수보완이다.

1. inspect(depth:null)만으로는 긴 문자열/100개 초과 배열이 생략된다. raw/decoded/log 검색에 maxArrayLength:null/maxStringLength:null을 고정하고101번째항목·긴문자열끝 canary 검출반례를 추가한다.
2. exactallowlist 변형에 Google→google 대소문자 반례와 MongoServerError의 비허용변형을 추가한다.

소유 테스트 작성자가 해당2파일만 수정하고 freeze한 뒤 부모가 handler를 다시 실행한다. 제품/source helper/native기반/원본closure는변경하지않는다. 이전15pass 로그를 삭제하거나 최종수락으로전용하지않는다. 최종코드기준sourcehash/로그/exit와독립재수락을연결한다.

## V1/V5 첫 parity 실행·독립 리뷰

첫 parity 원본worker에서 감사 status가 '200' 문자열로잘못변환되어200과다르게나왔다. fixture의PGraw→logical 변환이모든status에enum문자열변환을적용한결함이다. ActivityRequest.status는Int이므로타입보존하도록수정한다. 제품/원본변경없음,cleanupremaining0후workerexit1로중단했고current/native는시작하지않았다.

Parfit P2 3개도같이보완한다: 알려진/미등록강사·안내/중간빈행·부분중복·한국어팀alias/sourceName trim의3backendwhole결과, 실패시Run뿐아니라SourceRecord전체raw불변, 실제201detail의누락/추가/경계교체를정상독립wholeDTOoracle로거부. 이후parity재실행·독립수락이필수다.

추가도구검사: 초기typecheck의HTTPtest제네릭union3오류는Promise<unknown> 주석타입으로해결후typecheckexit0. lint는handlercleanup변수module 금지1건으로실패하여변수명만수정후재검증한다. 기존7warning과구분한다.

## V7 PG↔Mongo 경합 tuple 공백

Confucius 최종 리뷰: PG parity는 OM/LD 누락1행, 별도 native transaction은 유효2행 경합이므로 두 결과를 합쳐 frozenPG 전 tuple 대조라고 할 수 없다. 기존 native16은 그대로 유효하나 parity의 Mongo pg-* 제외를 제거하고 동일 PG fixture/독립literal/두 일정으로 실제 Mongo를 실행해야 한다. DB 종료·최종 수락·통합을 보류하고 작성자가 parity파일만 보완한다. 기존44/44/39 로그를 폐기하거나 새 검증으로 대체 기록하지 않는다.
