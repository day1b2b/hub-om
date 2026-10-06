# 계획 v1
핵심: API분리중 권한/활동기록/PG선택이같은요청에서섞이지않게해야한다.
1. [Core] 기존코치조회/쓰기HTTP계약을interface·PGadapter로이동, Mongoadapter에서같은DTO반환. 입력정규화/404/권한시점유지.
2. [Core] 요청별ALS로준비된repository주입. scope없으면기존PG/local, scope있으면누락은실패. 일반활동기록은best-effort, 민감조회감사는권한→기록성공→조회 failclosed.
3. [Shell] TeamUser facade, Instructor/Private factory, 활동기록계층분리, PGgetter scope차단.
4. [Check] 실제route+합성Mongo에서인가거절/noPG/병렬격리/감사원자성/반환값확인. 전체회귀검사와독립리뷰.
대안: 환경변수로부분Mongo활성화는미전환경로혼합위험때문에제외. 전체구현후운영provider선택을도입한다.
