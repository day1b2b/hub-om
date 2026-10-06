# 원본 PG 숫자 경계 실측

Node24.19/PG17.9/Prisma7.10, 원본oracle와mapper해시확인,45 migrations. numeric-probe-main.log exit0. dry-empty/apply-empty/reapply/apply-legacy4상태x15입력.

|입력|조회/저장|집계|
|---|---|---|
|0,-1,2147483647,-2147483648|그대로|preview/create/reapply/update/legacy update|
|0.5,-0.5,1.5,-1.5,2147483647.5,-2147483648.5|0쪽절단한Int32|같음|
|2147483648,-2147483649,NaN,±Infinity|findUnique실패/쓰기0|errors1,skip0|

mapper는모두number로수용. NaN/Infinity는직접객체주입경계이며JSON의유효숫자가아니다. Mongo는명시adapter에서동일변환. 기본PG는원래query값전달하여DB기존처리유지. 신규skip정책추가없음.
