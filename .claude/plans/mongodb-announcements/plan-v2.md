# 공지·첨부 실행계획 v2

핵심난이도: 승인된첨부5개각5MiB를개인정보codec로저장/다운로드하면서 기존PG의nestedwrite·softdelete·감사·반환·경합을보존한다.

1. [Core] 기존PGquery/select/orderBy를고정oracle로보존하고 AnnouncementRepository:list/get/detail-page/edit-page/getMutationState/create/update/softDelete/download 경계를설계한다. DTO에서Date→ISO기존API/페이지보존. PG는원본query그대로adapter로이동,권한/파서/formData/응답/UI는원위치유지. Mongo는동일UUIDalias/무효·부재구분; deleted필터/list createdAtdesc,attachment createdAtasc(동률_id허용). 한메서드관계읽기는단일snapshot,PG별도조회동시성강화는동일하다고주장안함.
2. [Core] Mongo writer는30s전체retry예산transaction;현재부모·선택첨부인증→부분쓰기→첨부삭제/생성→원자감사. create중간실패는모두원복,update는title/content/updatedAt만+추가/삭제첨부,기존작성자·남긴첨부cipher보존. delete는deletedAt/deletedBy/updatedAt부분갱신,첨부보존. 부모문서실갱신으로동일부모PUT/DELETE직렬화,삭제후stalePUT는원본처럼삭제상태유지하며content갱신가능(조회/download불가). preflight분리·removeIDs.length상한계산그대로,외부첨부ID실삭제불가,새businessrule/guard필드없음. 감사정책은PGtrigger비교:공지공개값없음,첨부announcement_id/mime_type/size만공개,파일명/본문/bytes/redacted. 같은값PII/HMAC감사skip·nullableINSERT/DELETE차이실PG확인. Bytes감사를거대object문자열화하지말고기존helper의해당모델최소보완필요성검토.
3. [Core] 모든저장은기존35모델runtimecodec/validator/index사용. title/content/actor/fileName/bytes평문비노출. 전체fullrow인증후logicalprojection,부분projectiondecode금지. 5MiB Bytes암호화약8.89MiB(9.32MB)/문서이므로분리컬렉션유지. 첨부조회는BSON-short때실제마지막_id부터이어읽고단건해독후metadata만보관,누적64MiB/20k행/15s한도와전체30s기한내완전결과또는안전실패(5개최대용량허용필수). 다운로드는부모활성확인+소속파일1개 fullcodec/원본byte정확복원. 공지목록기존전체조회는32MiB/20k행기존scan안전한도·부분결과금지. open은replica/명시shadow/validatorindex확인,자동수리금지.
4. [Shell] types/factory/dataRepositoryContext 및PGadapter,세APIroute·세page저장호출교체. UI와권한·sanitizer·요청감사로직유지. 새업무schema/의존성/환경없음.
5. [Check] 실제격리PG45migration의원본query/nestedwrite oracle vsnewPG vsnativeMongo:DTO/권한/파서/UUID/missing/deleted/attachments정렬·downloadheader와bytes·softdelete/외부ID중복삭제·상한경계·samevaluereplay/감사/redaction. Native실경합PUTPUT/PUTDELETE/다운로드삭제snapshot·중간첨부실패/후행감사실패원복·키/HMAC/bytes손상·5x5MiB/BSONshort/noGetMore·timeout/budget/open무수리. actualroute/page의auth/withActivity/context/noPGfallback/empty/notfound/loadingfailure검증. 전체test/type/lint/build·기존Mongo묶음·독립V기준수락→gap보완→정리→문서/commit/push/remoteSHA→총괄통합코드동일성. 브라우저/OAuth/운영리허설미검증명시.

역할:main contract/PG/facade/route/page/doc/실DB실행;독립critic/architect계획·실행리뷰;Mongo구현/native검사/PGoracle+handler검사분리위임. 운영접근금지. 단계재승인불필요.

## v2 변경과 수락 기준

- 첨부전용읽기만64MiB. 공통scan32MiB유지,실제BSONshort/5x5MiB필수. 모든32/64MiB·20k경계의거대fixture대신계측주입허용하되실행한계정확기록. 시간/RSS는관찰값만.
- mongoOperationAudit의Announcement/AnnouncementAttachment만nullable부재vsnull 보완;첨부allowlist announcementId/mimeType/size 추가. Bytes는해당모델data에한해부재/길이/Buffer.equals로비교하고Object.entries/JSON거대비교금지. 무관모델동작변경없음.
- 동시쓰기실충돌/retry증거와stalePUT/삭제snapshot계약을분리. 기존첨부상한/preflight허점은운영문서에기록하고새상한정책추가안함.
- 인터페이스는interface-notes.md. 최종V1–V11독립수락/증거·한계·정리·인계필수. 구현코드와검증별역할분리.
