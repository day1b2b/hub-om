# 검증 v2
S1~S3 구조조건pass후결과판정, 실행근거없으면pending.
1. 실제CoachPOST/GET/PUT/PATCH/DELETE는repository경계를사용하고DTO/HTTP400·404/입력정규화유지.
2. Team기존exports/local/PG기본선택유지, override에서Mongo의실제조회·쓰기호출.
3. Instructor save실제route가주입저장소사용, 누락필드보존및redaction유지.
4. 무권한Coach/PII요청은업무쓰기·개인정보조회전에거부.
5. 실제privateAccess서비스와scope밖export/token/schedule라우트미전환을구분.
6. ALS 병렬/중첩/예외종료시context분리·복원. caller actor로권한우회없음.
7. scope missing서비스는명확실패, cachedPrisma도getter에서차단하며fallbackPG0회.
8. request로그는DATABASE_URL없어도주입Mongo에저장,기록실패는best-effort+PGfallback0회. missingrecorder는handler전실패.
9. PII읽기는권한→암호화된접근감사→읽기순서,감사실패시반환금지.
10. Coach/Team/Instructor변경감사가업무write와원자적이며PII는redacted/암호화; 태그삭제/생성·프로필PK/EDIT_HISTORY중복제외.
11. 실제Mongo8.0합성native검증, 대상운영cluster/전체부하검증과구분.
12. 전체테스트/type/lint/build실행,생략/기존warning기록.
13. 운영데이터/키/환경/의존성미변경,노출가능backend선택없음.
14. 미전환PG/Calendar/외부동기화·Team삭제·실제복사/복구gap명시.
15. 독립review/manifest/alignment/handoff및검증된코드featurebranch보관;mainmerge/deploy로오인하지않음.
