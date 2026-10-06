# OM 전체 배정 Plan v2
핵심은확인한정확한생성집합의업무의미와역의존경합보호. 기준74e1970. 원본계약source-findings/validation-v1,독립근거meta-evaluation.

1. [Core] 대상/서명조건: readAssignmentState의exact metadata필터·1request·UUID·count·대표·비삭제조건하나라도위배하면원본OmAssignmentConflict409,쓰기없음. 서명request8/operation7필드·TTL600000·정렬/canonical·actor/nextOm·AUTH_SECRET우선그대로. batch자체서명추가금지. status변환needed↔planned만,manualname/id전체교체,DONE유지. 필드판정이같으면업무쓰기안함.
2. [Shell] 원본fixture bytefreeze+SHA e589d9cce20ba14c1b1d5340fe65b23863b55fd3f7022e0684420a502944e5f5. 공통순수계약/IOport/PGadapter로추출,PGSerializable와기존API이름유지. 신규context omAssignment와calendar/notifier명시port. 기존확인없는legacyhelper2개계속차단.
3. [Core] Mongo confirm순서: 기존CourseNameRestoreGuard restore문서새nonce실쓰기→그시도모든판정읽기→token검증→변경회차/요청/ActivityChange동일tx→commit. 같은nonce재사용금지,첫upsert중복은새tx전체재시도. restore는기존guard참여유지,다른writer불필요일괄변경안함(meta writer표). preview는readonly로guard/업무쓰기0(HTTPlog/기존retention별도). 완전noop도guard만변경,업무raw/timestamp/audit/외부0. 새로운schema/collectioncontract/의존성/키/업무정책없음. 준비기존guard/readstore명시,openready검사,자동수리금지.
4. [Core] driver재시도/실패: snapshot+primary+majority+j,guard대기·callback재시도·commit확인모두30초공유deadline(시작밖계산). 11000 firstguard경합만최초포함최대5attempt이며남은deadlinetimeout전달. 112/transient는driver가callback전체재수행;unknowncommit은drivercommit확인만,외부호출tx안금지. OmAssignmentConflict만409유지,기타오류원문제거후고정safe500;commit불명은rollback완료표시금지. raw연결metadata는projection만,changes actor PII읽지않음. 업무코덱/HMAC인증읽기/부분쓰기,감사fail전체abort.
5. [Core] 실제route: 기존순서auth/body/get/권한유지,preview는assignment서비스확인. confirm은mutation전에필요operations/calendar/notifier포트존재확인. 외부후속기존변경회차만calendar,prev!=next이고next있을때Slack. raw예외로그고정. requestlog는별도best-effort. sameOMrequest지만회차수동값다르면회차변경/calendar,Slack0. UI변경없음.
6. [Check] V01~V18 검증기준에실PG원본/NewPG/Mongo·실native·실route·UI단위증거연결. 문서존재/mock만PASS금지. 전체변경baseline공백검사·일반/fullMongo/type/lint/build. 새실패만영향재실행.
7. [Check] 독립결과수락/정리/manifest/alignment/handoff/featurecommitpush/총괄통합/remoteSHA. 자동화변경안함. 전체운영/devmain완료아님.

## 대안 결정
무보호changed-row는실enginecycle로거부. request notes/sessions재암호화는동일요청cycle만막고restorecycle남아거부. 신규guard또는다른8writer전면연결은추가구조/경합비용,현재역의존근거없어거부. 기존restoreguard공유는2cycle모두보호하고업무rawnoop를보존하는최소대안. namespace전역직렬화성능은운영미검증한계.

## 경쟁 판정
A snapshot뒤일반writer가배정noop행/별도metadata변경하면A→writer유효순서허용. writer가A의변경행을먼저수정하면native112후재읽기및기존token상태검사. 같은assignment/restore의역의존은공유guard가승자순서강제;변경뒤패자서명무효409,순수guardnonce만다르면유효noop둘다성공가능. raw중복metadata순수insert/retention삭제는일방향일때허용,다음preview는연결조건실제불일치일때409,유효하면성공. 무관한같은과정회차추가대상확대금지. 권한pre-read/DBtx분리는기존한계이며신규원자권한정책보장금지.

준비된guard collection의최초문서upsert는허용한다. collection/validator/index readiness 누락은거부. V09의기존guard native112와V13최초guardupsert경쟁은별도증거. 필수writer/PG/native검증미실행또는skip은최종수락보류이며browserE2E별도한계와구분.
