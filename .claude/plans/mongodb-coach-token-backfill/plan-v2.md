# 실행 계획 v2

plan-v1의1–6단계를유지하고meta/validation-v2를수락기준으로적용한다.

- archive선택에snapshot.sourceDatabase/sourceSchema조건추가금지. 시작시각동률은snapshot ID가아닌archive ID전역내림차순.
- dryrun은읽기전용요약이며토큰충돌사전검사기능추가금지. applyunique충돌은전체취소하고임시token으로회피하지않음.
- 기존직접주입PG API 유지/호출자연결종료X. 새PG CLIadapter가소유한연결만finally종료. 명시MongoCLI경로는env/PG초기화·종료모두없음.
- timeout/retry는callback밖전체deadline과callback안새summary. 실제시계deadline검사와주입오류전파를별도증거로취급.
- shared firstBatch page기법은공개driverAPI만사용. BSON짧은batch후last실제row의복합key로계속. 전체토큰map대신250이하coachpage범위유지.
- 검증완료후featurepush→원격SHA확인→총괄feature통합. 운영전환/dev→main은전체조건미충족이므로미실행.
