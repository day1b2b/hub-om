# 독립 architect Tesla 메타 검토
기준74e1970 read-only. 엔진spike코드/로그검토,실앱검증미실행.

최소후보: 기존 CourseNameRestoreGuard를assignment confirm과restore공유. 새schema/guard/notes·sessions재암호화불필요. 기존restore는이미plan읽기전동일session/tx로guard쓴다.
보호순서: `${namespace}_CourseNameRestoreGuard`의_id restore nonce실쓰기→요청/metadata/회차읽기→서명→업무/감사→commit. preview는guard쓰기0. prepare기존함수재사용/openready,런타임자동생성수리금지.

확인cycle1: reqX/S1Y/S2X→A X는S1만,B Y는req/S2만;양방향read-write의존. 엔진실제반례확인(앱아님).
확인cycle2: assignment A가S1noop/S2변경;restore B는S1/S2전체plan검증뒤S1만기존목적과정이동. A가읽은S1updatedAt을B변경,Bplan이읽은S2updatedAt을A변경. 쓰기비중첩. 새과정/counter경합없도록기존목적과정fixture필요. actualmongoCourseNameRestoreRepository169/217/237/264,prismaCourseNameRestoreRepository122. 코드구성가능,실DB미확인.

## writer 대응
- 새assignment confirm: 기존guard연결필수.
- 기존restore apply: 이미연결,변경안함.
- OmRequestpatch/delete,Operationcreate/update/delete,DeletedOperationrestore,AdminDatabasecell,OperationBackfill,CourseAdminsoftdelete,retention: 현재추가guard연결필수근거없음. 실제문서경합또는단방향직렬허용. 전체동등성증명아니므로실경쟁검증필요.
이전8개writer일괄연결후보철회. 신규연결1곳만.

phantom:guard가ActivityChange전체predicate잠금은아님. snapshot전잘못된metadata거부,이후insert/delete는A→writer가능하면허용. retention후새assignment는근거없음409. 실제역의존없이phantom만으로범위확대금지.

한계:namespace전역confirm/restore직렬화,무관요청경합/성능미측정. 기존잠금참여범위확대명시. 완전noop도guardnonce는write하지만업무/감사/후속0.
V1메타:request서명8필드정정,previewHTTP로그/retention과업무쓰기0구분,단방향경쟁일률409금지. 전략과실행수락분리. 이조건을Plan2에확정후S3재검토.
