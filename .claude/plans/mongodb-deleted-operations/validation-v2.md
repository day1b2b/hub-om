# 독립 검증 기준 v2

Anscombe critic의 Gibbs 메타 보완 반영 최종수락. 실행은 별도 판정.

- V1 API/admin/JSON/문자열 검사 및 응답 유지. operationId exact 문자열, UUID변환/trim/case변경/빈값거부 금지. missing 예외.
- V2 삭제목록 8필드·UTC날짜·삭제시각desc, Course/Company 동일snapshot, 관계손상고정오류. 동률순서완전일치불요.
- V3 삭제/활성/반복복원 모두 deletedAt/deletedBy/HMAC null 및updatedAt갱신. 시간간격후반복확인, 동일밀리초엄격증가불요.
- V4 다른raw/관계보존, deleted→live원자적restore감사. updatedAt만/replay 및deletedBy-only활성정리의감사제외는실PG대조.
- V5 실제세션쓰기후감사실패시전체raw원복, 재시도중복감사없음. 승인응답복호화와저장/감사/오류평문비노출구분.
- V6 실제writer의개별삭제/과정bulk/update/동일복원 양쪽선행barrier와충돌재시도증거. 실제적용된직렬순서에따른결과, 수정유실/감사중복없음. 삭제무조건우선정책금지.
- V7 100초과/BSON짧은batch 누락없음, 한도/timeout부분목록금지. 전체retrydeadline, 오류주입과deadline증거구분.
- V8 기본PG·scoped누락/Mongo실패fallback금지, 실제guard/withActivity, requestscope누락선행실패/후행로그실패업무성공유지.
- V9 원본PGquery독립oracle, 실제PG/Mongo DTO/state/updatedAt/audit 및empty/space/case/missing/deleted/live/deletedBy-only/replay 대조.
- V10 일반/test/type/lint/build/Mongo회귀·독립리뷰, skip별도, 문서/정리/push/SHA/통합별도판정.

메타보완: malformedJSON400와JSONnull예외유지. empty/space/case실제존재ID 구분. 경합은실제동일행쓰기겹침에서충돌/retry증거, bulk대상제외무변경성공과active조건실패를분리. 모든순서충돌강제불요.
