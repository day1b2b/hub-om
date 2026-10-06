# Drive 선행 기술 gate

2026-09-30 부모 실행, Node24.19.0, PostgreSQL17.9. 기준73a137ac8b8fe16bf6128b81529ab35d6de01031 원본 closure76파일/reader+page26runtime. 원본 bytes 수정 없음.

## 실제 PG 관찰

- 초기15태그와 확장26태그 각각 exit0 /1pass/0skip/0fail. 같은 gate의 확장이며 합산하지 않음.
- 기본/undefined250, 0/-0과 ±0.5는0개. 1.5는1개, -1.5는마지막1개. -250/-250.9는 뒤250개를 정상 정렬 순서로 반환.
- 251은251개. 2147483648/MAX_SAFE_INTEGER는 존재하는253개 전체. NaN/±Infinity/MAX_SAFE+1/±1e18/1e20/MAX_VALUE는null.
- 명시 Mongo 인자 구현: 유한 number이고 절댓값이MAX_SAFE_INTEGER이하이면 Math.trunc; 나머지null. 더 넓은 런타임 비number 입력은 typed 계약 밖이며 임의 coercion하지 않음. 양수앞/음수뒤, 동률순서는기존허용집합. 원본PGadapter변경없음.
- DB provider c, datcollate/datctype C, encoding0(SQL_ASCII), versionnull. 정렬 두열provider d/default로DB상속. 기존 합성setup --no-locale 그대로이며 테스트에맞춘변경없음. C byte ordering에맞춰Mongo comparator Buffer.compare(UTF8)을사용. 실제원본SQL순서와일치, 악센트/대소문자/한글 fixture34행동률없음. 운영collation미확인, 다른locale재현수락아님.

## 실제 Mongo driver 선행 spike

- 수동snapshot+singleBatch+timeoutMS 개별읽기 가능. withTransaction 재시도없이로컬누적예산적용.
- 보강spike는active currentOp관찰후1500msCSOT timeout, cursorclosed/sessionended true, bounded후속currentOp0 확인. 약1503.7ms처리와6.1mscleanup.
- 제품경로검증/60초경계/누적예산/cleanup장애검증을대체하지않음.

## 증거

/private/tmp/hub-om-drive-import-history-20260930/logs/pg-gate.log
/private/tmp/hub-om-drive-import-history-20260930/logs/pg-gate-extended.log
/private/tmp/hub-om-drive-import-history-20260930/pg-gate-extended-observations.json
/private/tmp/hub-om-drive-import-history-20260930/deadline-pending-spike.mjs
/private/tmp/hub-om-drive-import-history-20260930/logs/deadline-pending-spike.log

plan-v2 C2의 actualoracle gate를구체화한기술결정이다. 제품/전체검증PASS는아님. 부모는관찰전체를읽고기존동작보존구현착수.
