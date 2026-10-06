# 원본 PG 선행 관찰

부모가 Node24.19.0, env-i, 신규 PG17.9의 소유 주소56751/sheets_import_test에서 baseline8b4d954의 frozen 실제 POST를 실행했다. original closure80파일/runtime29. gate root1pass/0skip/0fail/exit0, 내부18관찰, worker cleanup remaining0. 테스트 작성자는 실행하지 않았다.

- tabs는 응답순서를 보존하며 sheetId0/빈title도 유효하다. selectedGid0 유지.
- sourceName123은 정상 parsed 뒤 trim TypeError400, header-only는 빈행400, values[]는 헤더400. 모두 원천1회 뒤이며 선행검증으로 옮기지 않는다.
- header0/-1은1로 선택,1.5는빈행400,99는헤더400, 문자열2는빈행400이라는 입력별 관찰이다. 모든 특수값에 대한 일반적 정상화 보장으로 확대하지 않는다.
- scalar cell123/false는 문자열로 staging 보존됐고 오류행도 저장됐다.
- 정상합성행은 OM/LD가 없어 validationErrors2개를 가지지만 errorCount는 오류행1개다.
- PG finishedAt이 startedAt보다1ms 빠른 실제관찰이 있다. 앱clock과DBdefault를 별개로 사용하므로 시작≤종료를 새계약으로 강제하지 않는다.
- year1999는defaultYear범위밖이라 '2/3' 원문을보존. 이후year케이스는같은지문으로중복저장0이므로2000/2100의저장변환은 이 gate만으로확인한것이아니다. 후속parity에서는각year고유sourceName으로원래변환을실제저장해확인한다.

원시로그: /private/tmp/hub-om-google-sheets-import-20260930/logs/pg-gate.log. 구조화관찰: 같은root/pg-gate-observations.json. 이는 합성원본 관찰이며 현재PG/native정상·실패·wholeDTO검증을대신하지않는다. gate원본파일을고쳐기대값에맞추지않는다.

독립 Parfit 확인:80파일 전부 baseline Git 원문/manifest SHA 일치, runtime29의 local target 누락0, frozen resolver 및 실제 guard/조회 보존 확인. gate 성공·관찰 범위 수락, whole parity는 미수락. tabs gate는 response/index 순서가 같은 방향이므로 재정렬 반례는 후속parity에서 반대순서 fixture로 보강한다. gate 자체를 수정해 이미 실행한 증거를 바꾸지 않는다.
