# 계획 v2
1. [Core] 코치관리두API의기존PG코드를adapter로추출. auth/activity는route유지, interface별Mongoquery/기존write위임. Team기존exports는context우선facade로,기본은지연legacy로직. Instructorfactory는기존계약그대로context우선.
2. [Core] dataRepositoryContext: 프로세스globalALS, scope값immutable shallowcopy, missingthrow/noPGfallback. getPrismaClient는cache접근전scope차단. auth는override에없으며세션검사유지.
3. [Core] withActivity preflight recorder확인→handler, 실패로그는best-effort/noPG. PII읽기는기존auth→접근감사→조회순서유지. privateAccess가실제export라우트에연결되지않은점미완료명시.
4. [Core] 현재업무모델의trigger계약을Mongo mutationaudit에적용: decrypted값diff,privacyredacted,targetPK,join삭제·생성,EDIT_HISTORY중복이벤트제외. 같은transaction에서감사실패시업무rollback.
5. [Shell] native request/audit 저장소와명시shadow준비추가. 생산자동선택·신규envselector미도입.
6. [Check] loopback합성Mongo8을별도실행하고native3영역+실제route/service권한/감사/격리검증. 독립review15항목,전체회귀/build/문서/push.
변경: v1에캐시PG차단/초기recorder검사/복합PK감사/기록실패계약/실제라우트vs서비스범위구분추가. 실제PGDB쿼리실행은이번검증범위가아님.
