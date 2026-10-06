# 실행 중 발견한 Gap 보완

1. HMAC 부재 오인(P2): 같은 snapshot에서 HMAC후보0일때 NO-null legacy boundedscan+fullauth. 잘못된indexkey/숨겨진HMAC변조의dryrun/apply raw불변검사. 구현·해당negative2개 PASS, Mongo추가scan한계문서화.
2. 음수0 소수변환: 실PG는-0.5를Int0으로저장,JS Math.trunc는-0이고BSONdouble형태라validator거부. Object.is(-0)일때0으로정규화. 15numeric*새행/legacy*3상태 원본/newPG/Mongo 대조 PASS. NaN을0으로바꾸는 ||0 대안은거절.
3. 감사PGparity(P2): 실PG audit-probe에서nullableINSERT/sameprofile재암호화difference확인. sync 전용notionSyncAudit로만보완,기존manual/helper정책유지. PG각123상황의audit exact대조및native독립기대PASS.

보완범위외schema/의존성/삭제정책/생산선택변경없음. 검사범위를줄이거나감사필드를비교에서제외하지않음. 논리row의저장companion분리는raw5필드HMAC독립검증과함께수행했다.
