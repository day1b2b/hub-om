# Plan v1 — 엑셀 임시 저장·검토

1. [Core] 기존 계약 보존: parser는 수정하지 않는다. 팀/파일명/sourceName/sourceType 기본값·5MiB·빈행 제한은 기존upload를 유지한다. 검증오류행도 저장하고 기존 중복은 sourceTeam + importRun.sourceName/sourceType + fingerprint로 판정한다. 같은 업로드의 처음 지문만 보존한다. 중복은 새run의errorCount에 포함하고 기존문구의validationLogs에 기록, 새sourceRows는없다. 원문은 모두 기존policy/codec로 암호화한다. 동시중복은 PG에run간unique가 없으므로 글로벌once-only를 추가하지 않고 실제PG의허용결과·재실행을대조한다.
2. [Shell] imports 명시context와 factory를 만든다. ImportRepository에storeParsedImport를포함하고 기본PG는원래workflow를보존한다. 페이지두개는factory로대체. storeParsedImport facade는override를먼저검사하고기본PG로진행. 타입/순수검증·summary/상세presenter를공유추출하되원본query/출력은PG oracle로보존. 원본PG writer의직접명단/강사조회는유지하고Mongo가필요한경우teamMembers/instructorNote명시scope로읽어PG/local/Notion fallback이없도록한다.
3. [Core] Mongo 저장: DataImportRun/OperationSourceRecord 기존validator/HMAC unique만사용, 새schema/guard없음. 명단/강사검증→후보run을sourceNameHMAC+sourceType으로조회→복호화원문확인→sourceTeam/fingerprint대조→run과행을단일snapshot transaction으로기록. requestActivity는실제withActivity로별도요청감사, 두원천모델은table-exclusions의변경감사제외를유지한다. 전체실패/재시도에부분run/행이남으면FAIL. transaction기한/scan15s20k32MiB 기존안전한계를적용하고 초과시부분성공/자동수리금지. native label retry는driver에위임하고error는고정코드로sanitize한다.
4. [Core] Mongo 조회: 목록startedAt desc/UUID desc, 모든sourceRecordCount, 상세최대200행. PG암호화wrapper는sourceSheet복호화값 localeCompare ko→sourceRowNumber asc로정렬하므로암호문정렬금지. 동률의원본미정순서에는새업무정책을만들지않고동순위집합대조. sourceRecords200행을고른뒤연결된operation/course/company를기존포함규칙으로조회. null·JSON키/배열·8/12preview·필수값누락표시·timezone/enum·삭제행연결을기존presenter와대조. 미존재run은null. 잘못된암호문/키/index나관계누락은부분DTO없이안전실패.
5. [Core] 범위경계: 명시Mongo staging을기존PG승격으로넘기지않는다. 현재승격은assertDefaultDatabaseAccess에서명시거부됨을테스트, 새후처리/Calendar를호출하지않는다. Sheets/Notion은기본동작보존하며 실제원천전환은후속. 권한가드/body/parser에업무변경없음. 기존허용복호화응답과저장평문비노출을구분한다.
6. [Check] byte-frozen원본PG reader/writer를현재PG와Mongo에대조: 합성xlsx/csv/json,valid/invalid/mixed/duplicate/replay/crosssource,순서/200/preview/linked/null,실제PGmigration/encryption/unique. UUID/시간은사전정한유일성·호출구간/참조대조후에만정규화한다. PG전체schema/합성Mongo에실자료없음. 원문/검증오류/개인필드가raw문서·감사·오류에없음을검사한다.
7. [Check] 실제upload withActivity/권한가드 및 두page를nativeMongo로검증. auth공급/외부감지만mock. 허용/거부·5MiB/빈파일/빈행/파싱실패·파일이름추론·unknownteam·requestActivity·승격거부·외부0/PG0. 추가native경합·키불일치·rollback·준비안됨·큰scan거부/transactionretry를검증한다. 일반/type/lint/build+전체Mongo회귀,독립수락후소유자원정리.
8. [Shell] 실행/실패/미검증/digest/independent/alignment/handoff/coverage/macro갱신. 최신dev/총괄fetch·겹침검사후기능commit/push·총괄FF·원격SHA확인. 단계완료로중지하지않고다음승격등필수단위로진행.

대안: Mongo用Prisma호환프록시는짧지만원문정렬/transaction/암호화정확성을숨기므로거절. workflow/DTO공유+명시Mongo query를선택한다. 기본PG의의미를우선하며고정한원본oracle를현재공유함수로바꿔동일버그를숨기지않는다.


추가 코드 근거: upload catch의 비정형 JSON/XLSX/driver 오류는 원문조각을 포함할 수 있다. 파싱/400상태를 유지하면서 알려진 고정 사용자 문구만 허용하고 나머지는 고정 공개 오류로 가리는 최소 개인정보 수정을 포함한다. auth redirect 등 제어 흐름은 기존 catch 밖 위치를 유지한다. 이 변경은 원문 에러 본문을 숨기며 정상업무/파싱성공 결과를 바꾸지 않는다.

interface 정리: 기존 ImportRepository는 읽기계약으로 유지하고 추가 ImportStagingRepository와 imports context의 교차타입으로 묶는다. 기본 PG reader 타입과 동결 oracle의 참조가 새 write 메서드를 강제하지 않게 한다. 두 모델의 변경감사 제외는 table-exclusions에 명시돼 있으며 새 ActivityChange를 만들지 않는다.
