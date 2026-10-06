# 공지 repository 계약 초안

파일 src/lib/data/announcements/announcementRepository.ts. Date/Binary는내부typed row, 기존route가ISO/Uint8Array변환. Page/route는sanitize/parse/auth유지.

AnnouncementRecord: id,title,content,authorEmail:string; authorName:string|null; createdAt,updatedAt:Date.
AnnouncementListRow: Omit<AnnouncementRecord,"content">.
AnnouncementFileInput: fileName,mimeType:string;size:number;data:Uint8Array.
AnnouncementAttachmentRow: id,fileName,mimeType:string;size:number.
AnnouncementDetailRow: AnnouncementRecord & {attachments:AnnouncementAttachmentRow[]}.
AnnouncementDetailPageRow: Omit<AnnouncementRecord,"updatedAt"> & {attachments:Omit<AnnouncementAttachmentRow,"mimeType">[]}.
AnnouncementEditPageRow: Pick<AnnouncementRecord,"id"|"title"|"content"> & {attachments:Omit<AnnouncementAttachmentRow,"mimeType">[]}.
AnnouncementUpdateState: {id:string;deletedAt:Date|null;_count:{attachments:number}}.
AnnouncementDeleteState: {id:string;deletedAt:Date|null}.

AnnouncementRepository:
list():Promise<AnnouncementListRow[]>;
getDetail(id:string):Promise<AnnouncementDetailRow|null>;
getDetailPage(id:string):Promise<AnnouncementDetailPageRow|null>;
getEditPage(id:string):Promise<AnnouncementEditPageRow|null>;
getUpdateState(id:string):Promise<AnnouncementUpdateState|null>;
getDeleteState(id:string):Promise<AnnouncementDeleteState|null>;
create(input:{title:string;content:string;authorEmail:string;authorName:string|null;attachments:AnnouncementFileInput[]}):Promise<AnnouncementRecord>;
update(input:{id:string;title:string;content:string;removeAttachmentIds:string[];attachments:AnnouncementFileInput[]}):Promise<AnnouncementRecord>;
softDelete(id:string,deletedBy:string|null):Promise<void>;
download(id:string,attachmentId:string):Promise<{fileName:string;mimeType:string;data:Uint8Array}|null>;

Factory src/lib/data/announcements/announcementRepositoryFactory.ts getAnnouncementRepository():scope announcements우선/default PrismaAnnouncementRepository. PG class같은 디렉터리 prismaAnnouncementRepository.ts. Mongo root src/lib/data/mongoAnnouncementRepository.ts: class MongoAnnouncementRepository, prepareMongoAnnouncementStore, ANNOUNCEMENT_MODELS=['Announcement','AnnouncementAttachment','ActivityChange']; options MongoOperationOptions&{allowShadowWrites:true}. Safeerror MongoAnnouncementError code(P2025/INVALID_UUID/etc) noinput/no cause. Existing route has no own500catch; errors propagate safe. 하위 input은이미sanitized/validated,route단preflight/limit계산유지. prepare/openbusiness기존 패턴 유지.
