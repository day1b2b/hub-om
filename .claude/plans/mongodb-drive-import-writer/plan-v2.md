# Drive CLI writer 계획 v2

핵심 난이도: 현재원본CLI는guard로encrypted schema를거부하고별도후속migration은DB UUIDdefault를제거했다. 원본전체를현PG에서실행한것처럼꾸미면거짓parity다. 원본legacy가실행가능한정당한migration시점의합성PG와현재원본차단gate를분리하고, 기존부분쓰기·원천issues·집계를encryptedPG/native에보존한다.

대안A: 기존orchestration을source/repository 계약으로추출, legacyguard는다른rawSQL도구에유지, CLI는안전한PGadapter기본/명시Mongo 사용. 기존업무흐름·암호화codec재사용에적합. 대안B: 기존SQL에Mongo조건분기/guard예외추가. 경계혼합·암호문검색/평문쓰기위험으로거절. 새기능정책없이A를선택한다.

## S1 [Shell] 기준·gate·환경

기준3c72e69의CLI+guard+실제scanner와호출의존을해시고정한다. 원본SQL실행가능migration prefix를근거로확정하고역사PG와현재PG는별도DB. UUIDdefault를테스트편의로현재schema에다시붙이거나guard를mock하지않는다. 현재원본은암호화schema차단과0source/0write를실행관찰, 원본legacy는정상/부분실패실행관찰. 구조/관찰gate실패·불명확은구현진행금지,계획수정후재수락.

새소유root /private/tmp/hub-om-drive-writer-20260930, PG56753, Mongo27853/drivewriter20260930 예정. 존재/포트/버전확인후생성. 실env를읽지않는childwhitelist. 원본CLI의env읽기는합성임시cwd에서만실행. scanner외부fetch차단/합성HTTP. 타인프로세스/borrowedbinary보존.

## S2 [Core] 실행워크플로우 계약

운영대상: Session→Course→Company innerjoin, Session.deletedAt null만제외. NOT NULL startDate ASC·operationId ASC 원본정렬을현PG/native에서일치시킨뒤limit. limit0은무제한계약을유지하되Mongo기존유한scan안전상한초과는조용한잘림없이명시실패. absentparent는SQLinnerjoin처럼대상에서제외, 삭제된parent추가필터없음. 개인정보필드는복호화후원천에전달한다.

parseArgs는기존환경concurrency기본3, 유한양수floor/기타fallback, limit0, mode임의문자열을그대로기록한다. driveLink.trim→lectureLink.trim→search 순서. --mode는실행모드전환기능아님.

pending run부터개별result commit, 끝에summary/status/finishedAt을기록. 전체transaction/rollback/exactlyonce/retry정책추가금지. workers index stride와최대min(concurrency,operations.length), 처리25배수/마지막에숫자progress를유지. 0건도run완료,source0.

scan: 전체candidateCount와지정6field의storedkeyCandidates구별. 각candidate의confidence/field/label/sourceTitle/value를그대로복사하고 evidence만 null/누락시빈문자열로보존한다. 검색:전체count와상위10 stored폴더후보구별. suspicious와각집계는INSERT전에증가,중복후보유지. scannerissues는errors증가조건아님. source/mapping/resultinsert failure catch에서errors++ 후errorresult쓰기, 이두번째쓰기실패시pending/부분results보존, summary최종UPDATE0가능. 다른worker진행과CLI종료를원본관찰로기록하며새all-or-nothing정책없음.

필요한 원천 예외 원문은 암호화된 error 필드에만 보존하고 console/외부 최종 오류는 고정 code로 보호한다. PG/Mongo 드라이버 오류는 repository 경계에서 고정 code로 제한한다. 기존 업무 snapshot(company/course 등)의 개인정보 분류는 전체 전환 gate로 남기며 이번에 임의 변경하지 않는다.

## S3 [Core] 저장·원천 경계

전용writerrepository loadOperations/createRun/appendResult/finishRun, source scan/search, 명시context슬롯을정의한다. default PG는앱getPrismaClient의암호화wrapper, native는기존runtimecodec/readiness/validator/unique정책. source기본은기존scanner함수동일,재구현하지않는다. scope에서writer/source누락이면source/DB/env IO전에fail-closed. CLI module import만으로env/DB/process.exit가발생하지않게main과import진입을구분,실행시기존env순서를유지한다. 저장소암호화키/readiness검증전에원천을읽지않는다. Google설정누락은기존scanner의HTTP0/issues결과이며전체실행실패로바꾸지않는다.

PG ID는Prisma생성/명시uuid, native도uuid. start/finished/created동적시각과정수/nullable/date/JSONnull의원본저장의미를고정한다. 각native 쓰기는단일원자작업/필요한부모확인과함께짧은transaction,원천IO는callback밖. parentrun/operationsession FK를검증하며기존soft-delete결과와snapshot을현재업무값으로덮어쓰지않는다. pending run의이름없는수정허용/새lock/동시unique정책추가없음. 기본Mongo준비는explicitshadow만,기존namespace자동수리/삭제금지.

완료후기존Drive이력reader로값을대조하되reader를expectedbuilder로쓰지않는다. 가져오기승격/imports/Calendar/업무writer호출0.

## S4 [Check] 검증

독립frozen legacyPG 의미, currentoriginal guard, currentencryptedPG/native whole tuple를분리. 정상scan/search, 우선순위·공백link, 후보필터/건수, issues-only completed, source 비Error/예외, insert 전/후fault, error기록failure, finishfailure, pending부분이력, 빈operations, 재실행별도run, 동시범위A/B, keymismatch/HMAC/plaintext비노출, parent/FK, 업무raw불변. 각 전체run/result ID집합으로 추가/누락/중복수를 검사하고 독립literal과 같은 비교기의 음성대조를 요구한다.

actual scanner를 합성HTTP에 연결해 반환 issues/후보와 writer input을 확인한다. 기존 scanner 직접 unit은 찾지못했으므로 재사용 증거로 계산하지 않는다. schema/codec/hash 증거 재사용은 새 CLI 연결 검증을 대체하지 않는다. CLI child는 합성cwd/token/key만 사용하고 실제env/Network tripwire, exit code/console 고정/cleanup을 검사한다. 후보추출·새UI 개선은 비대상이다.

Node24 env-i, 실제PG17/Mongo8replica, 일반test/type/lint/build, 독립리뷰를 수행한다. 실패는 원인 수정 후 영향 범위만 재실행한다. 전체Mongo를 무조건 반복하지 않고 재사용 의존 hash 근거를 남긴다. 실Google/운영collation/실backup은 NOT_RUN이다.

## S5 [Check] 정리·통합

필수검증/독립수락 후 PG표/접속0, Mongo소유DB/작업0, process/port/dbpath 정리. 실행manifest/review/gap/alignment/handoff와 coverage/macro 갱신. 검증feature→총괄FF/atomicpush/원격SHA확인, main/dev/운영은 변경하지 않는다. 전체앱/health/backup/남은CLI/개인정보분류/collation/실A/B복원복사전환의 별도gate를 유지한다.

## 필수 보완과 관찰 기준

- 정상화는evidence에만기본빈문자열, confidence그대로. concurrency0.5→0workers/source0/results0/completed,limit0.5→0무제한. try밖pickScanInput오류는해당errors/result/progress0. source/가공/INSERT의try내오류와분리한다.
- 첫append실제commit성공확인후1회fault,catchappend성공이면성공+오류정확히2행/source1/errors1/기존집계유지. create/finish commit후fault도독립조회와주입도달횟수를검사. Promise.all비취소 유지: service에서는잔여worker를관찰용으로settle후확인, CLI는실제childexit후확정한저장상태로구분. 구현에새allSettled대기정책을넣지않는다.
- 소유PG에서prefix17 기능oracle, prefix18 실제guard통과후createRun SQLSTATE23502/source0/run-result0, current45 실제guard차단/운영조회0/source0/DML시도0의세gate를분리한다. 원문연속migration hash·catalog/default/FK를검사한다. 어느gate든미확정/예상불일치면구현중단후원인/계획재수락.
- DATE원값→driver반환타입/값→dateOnly→source입력→result저장날짜를 UTC/AsiaSeoul 별도worker에서관찰하고같은TZ끼리대조한다. 날짜하루차이를동적timestamp정규화로숨기지않고원본동작을보존한다. Session날짜NOTNULL과nullable result날짜구분. rawSQL status소문자/Prisma-native enum대문자는검증된enum필드만명시logical대응,다른원문정규화없음.
- load의join/정렬/limit은한snapshot. run없음/session없음/softdeleted존재를구분. load후softdelete와append동시에도기존snapshot업무값그대로보존. 물리삭제와동시CASCADE/SETNULL보장은이번범위외이며후속전체삭제경로gate에남긴다. 새guard/물리삭제정책추가없음. activitycontext없는CLI의ActivityRequest/ActivityChange 추가쓰기0을검사.
- prepare는5모델기존metadata·historicalinvalid문서까지모두선검증후누락모델만생성. 누락+invalid기존이공존하면실패전collection/index/validator변경0. crypto/HMAC오류는별도. existingnamespace자동수리0.
- transport/DB관찰계약위반은워크플로우catch와독립수집하고외부에서위반0검사. 의도적fault와검증실패를분리하고추가요청/잘못된SQL관찰음성대조를같은검사기에적용.
- 원본scanner의공유설정/cache유지. A/B합성credential불변,env행렬별도worker. cold동시OAuth1회보장주장금지. 설정없음/issues-only·ID보존실패scan·부분검색성공·본문HTTP빈값/rejection차이를actualHTTP에서고정.
- 기존scanner에는이미하드코딩된실명이있다. 원본동결목적으로그값을새공개파일에복제하지않는다. 기준git commit/blob과전체SHA·전이closure manifest를고정하고loader가git object의원본bytes를검증해읽는다. 현재파일resolve탈출금지,객체없음fail-closed. 실제이름/token/env를새fixture/문서/로그에넣지않는다. 필요한비민감원본만파일동결할수있고모든원본은동일baseline/hash검사를받는다.

구조수락은validation-v2독립critic 판정 후. 이문서작성만으로구현승인/gate실행PASS가아니다. 구현자/검증자파일소유분리,DB실행부모만.
