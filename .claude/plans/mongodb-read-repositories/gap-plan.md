# 남은 gap
이번 조회코드 범위에서발견한fixture문제는UUID고유키와명시URLtemplate으로수정후실엔진재검증통과.
- external_blocker: Mongo8.0.32의현재Coolifyhostkernel startupguard. hostkernel수정/구버전강제우회하지않음; 운영목표Mongo환경에서새조회재검증필요. 7.0보조엔진완료와구분.
- implementation_gap(상위Wave): coach/team쓰기API,강사노트/OM요청/공지첨부/import/calendar/audit/auth등잔여PG직접접근. 운영factory여전히PG.
- validation_gap(운영이전): 실제원천평문/암호화상태확인,실제read-onlyexport/검증복사,최종동기화,백업복원/롤백,권한화면/규모성능.
- environment: localGitHub DNS/network불가; 로컬featurecommit은원격push/PR/merge/배포와구분.
